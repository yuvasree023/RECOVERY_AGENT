"""Unit tests for the 7 compliance guardrails in Recover AI Agent."""

import unittest
from datetime import datetime, timedelta
from guardrails import GuardrailContext, evaluate_guardrails, check_dnd_window


class TestGuardrails(unittest.TestCase):

    def test_rule_1_opt_out(self):
        """Rule 1: Customer Opt-Out Check -> TERMINATE."""
        ctx = GuardrailContext(
            opt_out_status=True,
            fraud_score=0.1,
            retry_cooldown_hours=2,
            current_attempt=0,
            channel="WhatsApp",
            proposed_action_time=datetime(2024, 10, 1, 10, 0)
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "TERMINATE")
        self.assertEqual(dec.violated_rule, 1)

    def test_rule_2_fraud_score(self):
        """Rule 2: Fraud Score > 0.80 -> TERMINATE and flag manual review."""
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.88,
            retry_cooldown_hours=2,
            current_attempt=0,
            channel="Email",
            proposed_action_time=datetime(2024, 10, 1, 14, 0)
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "TERMINATE")
        self.assertEqual(dec.violated_rule, 2)
        self.assertTrue(dec.flag_manual_review)

    def test_rule_3_max_attempts(self):
        """Rule 3: Max Contact Attempts Exceeded -> TERMINATE."""
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.2,
            retry_cooldown_hours=2,
            current_attempt=3,
            max_attempts=3,
            channel="SMS",
            proposed_action_time=datetime(2024, 10, 1, 12, 0)
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "TERMINATE")
        self.assertEqual(dec.violated_rule, 3)

    def test_rule_4_circuit_breaker(self):
        """Rule 4: Reasoning Loop Iteration Circuit Breaker -> ESCALATE."""
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.2,
            retry_cooldown_hours=2,
            current_attempt=1,
            loop_iterations=4,
            max_loop_iterations=4,
            channel="Email",
            proposed_action_time=datetime(2024, 10, 1, 12, 0)
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "ESCALATE")
        self.assertEqual(dec.violated_rule, 4)

    def test_rule_5_cooldown_active(self):
        """Rule 5: Action within retry_cooldown_hours -> BLOCK_ACT."""
        last_act = datetime(2024, 10, 1, 10, 0)
        proposed = datetime(2024, 10, 1, 11, 0)  # Only 1h elapsed, required 2h
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.1,
            retry_cooldown_hours=2,
            current_attempt=1,
            last_act_timestamp=last_act,
            proposed_action_time=proposed,
            channel="WhatsApp"
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "BLOCK_ACT")
        self.assertEqual(dec.violated_rule, 5)

    def test_rule_6_dnd_window(self):
        """Rule 6: WhatsApp/SMS inside DND window (21:00-08:00) -> BLOCK_ACT."""
        night_time = datetime(2024, 10, 1, 22, 30)  # 10:30 PM
        early_morning = datetime(2024, 10, 1, 5, 0)  # 5:00 AM
        day_time = datetime(2024, 10, 1, 14, 0)      # 2:00 PM

        self.assertTrue(check_dnd_window(night_time))
        self.assertTrue(check_dnd_window(early_morning))
        self.assertFalse(check_dnd_window(day_time))

        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.1,
            retry_cooldown_hours=2,
            current_attempt=0,
            channel="WhatsApp",
            proposed_action_time=night_time
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "BLOCK_ACT")
        self.assertEqual(dec.violated_rule, 6)

        # Email is exempt from DND
        ctx_email = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.1,
            retry_cooldown_hours=2,
            current_attempt=0,
            channel="Email",
            proposed_action_time=night_time
        )
        dec_email = evaluate_guardrails(ctx_email)
        self.assertTrue(dec_email.passed)

    def test_rule_7_control_group(self):
        """Rule 7: Control Group Isolation -> BLOCK_ACT."""
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.1,
            retry_cooldown_hours=2,
            current_attempt=0,
            is_control_group=True,
            channel="WhatsApp",
            proposed_action_time=datetime(2024, 10, 1, 11, 0)
        )
        dec = evaluate_guardrails(ctx)
        self.assertFalse(dec.passed)
        self.assertEqual(dec.status, "BLOCK_ACT")
        self.assertEqual(dec.violated_rule, 7)

    def test_all_passed(self):
        """All rules valid -> PROCEED."""
        ctx = GuardrailContext(
            opt_out_status=False,
            fraud_score=0.15,
            retry_cooldown_hours=2,
            current_attempt=1,
            loop_iterations=1,
            is_control_group=False,
            last_act_timestamp=datetime(2024, 10, 1, 8, 0),
            proposed_action_time=datetime(2024, 10, 1, 11, 0),
            channel="WhatsApp"
        )
        dec = evaluate_guardrails(ctx)
        self.assertTrue(dec.passed)
        self.assertEqual(dec.status, "PROCEED")
        self.assertIsNone(dec.violated_rule)


    def test_llm_replan_loop(self):
        """Test LLM Replan feedback loop when guardrail rejects initial proposal."""
        from llm_agent import generate_agent_plan

        context = {
            "decline_code": "NETWORK_TIMEOUT",
            "segment": "High",
            "whatsapp_consent": True,
            "event_type": "UPI_PAYMENT_FAIL",
            "attempt_number": 1
        }
        # Initial proposal proposes WhatsApp
        initial_plan = generate_agent_plan(context, {"decline_code": "NETWORK_TIMEOUT"}, 0.75)
        self.assertEqual(initial_plan["tool_args"]["channel"], "WhatsApp")

        # Simulate guardrail rejection due to DND curfew
        error_feedback = "Rule 6: WhatsApp communication attempted inside DND curfew window (21:00-08:00)"
        replan = generate_agent_plan(context, {"decline_code": "NETWORK_TIMEOUT"}, 0.75, previous_error=error_feedback)

        # Replan should dynamically pivot channel to compliant Email
        self.assertEqual(replan["tool_args"]["channel"], "Email")
        self.assertIn("GUARDRAIL INTERCEPTION", replan["thought"])
        self.assertIn("REPLANNING", replan["thought"])


if __name__ == "__main__":
    unittest.main()
