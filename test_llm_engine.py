"""Unit tests for LLMEngine and schema validation in Recover AI Agent."""

import json
import unittest
from unittest.mock import patch, MagicMock

from llm_engine import (
    LLMEngine,
    MockLLM,
    validate_plan_schema,
    ALLOWED_TOOLS,
    ALLOWED_CHANNELS,
    ALLOWED_TEMPLATES,
    ALLOWED_ACTIONS,
    ALLOWED_DISCOUNTS,
)


class TestLLMEngine(unittest.TestCase):

    def setUp(self):
        self.sample_observation = {
            "event_id": "EVT_TEST_001",
            "event_type": "UPI_PAYMENT_FAIL",
            "decline_code": "NETWORK_TIMEOUT",
            "amount": 1500.0,
            "segment": "High",
            "ltv": 25000.0,
            "whatsapp_consent": True,
            "opt_out_status": False,
            "fraud_score": 0.05,
            "current_attempt": 0,
            "max_attempts": 3,
            "recovery_probability": 0.82,
            "previous_attempts": [],
        }

    def test_schema_validation_valid(self):
        """Test (a): Valid structured responses parse cleanly matching the schema."""
        valid_response = {
            "tool": "schedule_retry",
            "channel": "WhatsApp",
            "template_key": "PAYMENT_RETRY",
            "discount_pct": 0.0,
            "action_type": "SCHEDULE_RETRY",
            "reasoning": "Transient network timeout detected with 82% ML recovery likelihood. Proposing WhatsApp retry schedule.",
        }
        is_valid, err, clean_plan = validate_plan_schema(valid_response)
        self.assertTrue(is_valid)
        self.assertIsNone(err)
        self.assertEqual(clean_plan["tool"], "schedule_retry")
        self.assertEqual(clean_plan["channel"], "WhatsApp")
        self.assertEqual(clean_plan["template_key"], "PAYMENT_RETRY")
        self.assertEqual(clean_plan["discount_pct"], 0.0)
        self.assertEqual(clean_plan["action_type"], "SCHEDULE_RETRY")

    def test_gemini_api_call_success(self):
        """Test (a): Real engine successfully parses mocked valid Gemini response."""
        engine = LLMEngine(api_key="mock_test_key")
        mock_raw_json = json.dumps({
            "tool": "schedule_retry",
            "channel": "WhatsApp",
            "template_key": "PAYMENT_RETRY",
            "discount_pct": 0,
            "action_type": "SCHEDULE_RETRY",
            "reasoning": "High LTV customer with network glitch. Scheduling fast automated retry via consented WhatsApp channel.",
        })

        with patch.object(engine, "_call_gemini_api", return_value=mock_raw_json):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "llm")
            self.assertEqual(plan["tool"], "schedule_retry")
            self.assertEqual(plan["channel"], "WhatsApp")
            self.assertEqual(plan["template_key"], "PAYMENT_RETRY")
            self.assertEqual(plan["discount_pct"], 0.0)
            self.assertIn("WhatsApp channel", cot_reasoning)

    def test_invalid_json_triggers_mock_fallback(self):
        """Test (b): Invalid/malformed JSON string triggers MockLLM fallback path."""
        engine = LLMEngine(api_key="mock_test_key")
        malformed_json = "I think we should call the user on WhatsApp right now!"

        with patch.object(engine, "_call_gemini_api", return_value=malformed_json):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "fallback")
            # Should have fallen back to MockLLM's safe deterministic plan
            self.assertIn(plan["tool"], ALLOWED_TOOLS)
            self.assertIn(plan["channel"], ALLOWED_CHANNELS)
            self.assertIn(plan["template_key"], ALLOWED_TEMPLATES)
            self.assertIn(plan["action_type"], ALLOWED_ACTIONS)
            self.assertIn(plan["discount_pct"], ALLOWED_DISCOUNTS)

    def test_api_error_or_timeout_triggers_fallback(self):
        """Test (b): API timeout / network failure triggers MockLLM fallback path."""
        engine = LLMEngine(api_key="mock_test_key")

        with patch.object(engine, "_call_gemini_api", return_value=None):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "fallback")
            self.assertIsNotNone(cot_reasoning)
            self.assertEqual(plan["tool"], "schedule_retry")

    def test_manipulated_unbounded_enum_triggers_fallback(self):
        """Test (c): Plan fields never violate bounded enums even under manipulated LLM output."""
        engine = LLMEngine(api_key="mock_test_key")

        # Attack scenario 1: Illegal unapproved discount
        bad_discount_response = json.dumps({
            "tool": "offer_discount",
            "channel": "WhatsApp",
            "template_key": "CART_DISCOUNT",
            "discount_pct": 90.0,  # Unauthorized 90% discount!
            "action_type": "OFFER_DISCOUNT",
            "reasoning": "Giving 90% off to force checkout conversion.",
        })
        with patch.object(engine, "_call_gemini_api", return_value=bad_discount_response):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "fallback")
            # Fallback must be bounded to 0 or 10
            self.assertIn(plan["discount_pct"], ALLOWED_DISCOUNTS)
            self.assertNotEqual(plan["discount_pct"], 90.0)

        # Attack scenario 2: Illegal unapproved channel
        bad_channel_response = json.dumps({
            "tool": "send_message",
            "channel": "Telegram",  # Unauthorized channel!
            "template_key": "PAYMENT_RETRY",
            "discount_pct": 0,
            "action_type": "SEND_MESSAGE",
            "reasoning": "Sending message via Telegram messenger.",
        })
        with patch.object(engine, "_call_gemini_api", return_value=bad_channel_response):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "fallback")
            self.assertIn(plan["channel"], ALLOWED_CHANNELS)
            self.assertNotEqual(plan["channel"], "Telegram")

        # Attack scenario 3: Missing required keys
        missing_keys_response = json.dumps({
            "tool": "send_message",
            "channel": "Email",
            # missing template_key, action_type, discount_pct
        })
        with patch.object(engine, "_call_gemini_api", return_value=missing_keys_response):
            cot_reasoning, plan = engine.reason_and_plan(self.sample_observation)
            self.assertEqual(plan["_engine_mode"], "fallback")

    def test_mock_llm_replan_on_guardrail_rejection(self):
        """Test (d): MockLLM handles re-planning on DND/cooldown guardrail rejection."""
        mock_llm = MockLLM()
        rejection_reason = "Rule 6: WhatsApp communication attempted inside DND curfew window (21:00-08:00)"
        cot, plan = mock_llm.reason_and_plan(self.sample_observation, previous_rejections=rejection_reason)

        # Should adapt to Email
        self.assertEqual(plan["channel"], "Email")
        self.assertEqual(plan["tool"], "send_message")
        self.assertIn("GUARDRAIL INTERCEPTION", cot)
        self.assertIn("Email", cot)


if __name__ == "__main__":
    unittest.main()
