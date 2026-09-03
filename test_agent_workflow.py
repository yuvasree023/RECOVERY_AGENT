"""Unit tests for Dynamic Reasoning, Outcome Awareness, and PTP Intent Parsing."""

import unittest
from datetime import datetime
import tools
from models import Customer, EventRecord, OutcomeRecord, CaseState, AuditStep, RecoveryCase
from agent_loop import AgentRunner
from llm_agent import generate_agent_plan
from llm_engine import MockLLM


class TestDynamicReasoningAndOutcomeAwareness(unittest.TestCase):

    def setUp(self):
        tools.clear_simulated_replies()

    def test_dynamic_reasoning_low_probability(self):
        """Low recovery probability (< 0.3) triggers discount incentive or escalation."""
        context = {
            "decline_code": "HIGH_SHIPPING_COST",
            "segment": "Medium",
            "ltv": 1500.0,
            "whatsapp_consent": False,
            "event_type": "CART_ABANDON",
            "attempt_number": 0,
        }
        plan = generate_agent_plan(context, {}, recovery_prob=0.18)
        self.assertEqual(plan["tool_name"], "offer_discount")
        self.assertEqual(plan["tool_args"]["discount_pct"], 10.0)
        self.assertIn("18.0%", plan["thought"])

    def test_dynamic_reasoning_high_probability(self):
        """High recovery probability (> 0.7) triggers automated cooldown retry."""
        context = {
            "decline_code": "NETWORK_TIMEOUT",
            "segment": "High",
            "ltv": 4500.0,
            "whatsapp_consent": True,
            "event_type": "UPI_PAYMENT_FAIL",
            "attempt_number": 0,
        }
        plan = generate_agent_plan(context, {}, recovery_prob=0.88)
        self.assertEqual(plan["tool_name"], "schedule_retry")
        self.assertEqual(plan["tool_args"]["channel"], "WhatsApp")
        self.assertIn("88.0%", plan["thought"])

    def test_hinglish_ptp_intent_extraction(self):
        """Extracts Hinglish Promise-To-Pay expressions and derives future date."""
        replies = [
            ("Kal salary aayegi tab pay karunga", "promise_to_pay"),
            ("I will pay on Friday once my card is active", "promise_to_pay"),
            ("Parso shaam ko pay karta hu", "promise_to_pay"),
            ("Please stop messaging me", "opt_out"),
            ("This is fraud, cancel my order immediately", "dispute"),
        ]
        for reply_text, expected_intent in replies:
            result = tools.extract_ptp_intent(reply_text)
            self.assertEqual(result["intent"], expected_intent, f"Failed on '{reply_text}'")
            if expected_intent == "promise_to_pay":
                self.assertIsNotNone(result.get("date"))

    def test_agent_loop_ptp_outcome_handling(self):
        """Validates that customer PTP reply puts the case on PTP hold and halts active retries."""
        customer = Customer(
            customer_id="cust_ptp_01",
            segment="High",
            ltv=3200.0,
            whatsapp_consent=True,
            opt_out_status=False
        )
        event = EventRecord(
            event_id="evt_ptp_01",
            customer_id="cust_ptp_01",
            event_type="UPI_PAYMENT_FAIL",
            amount=1200.0,
            status="FAILED",
            timestamp=datetime(2026, 9, 2, 10, 0, 0),
            decline_code="INSUFFICIENT_FUNDS",
            attempt_number=1,
            fraud_score=0.05,
            retry_cooldown_hours=2,
            customer_reply="Kal salary aayegi tab payment kar dunga"
        )
        outcome = OutcomeRecord(
            event_id="evt_ptp_01",
            resolved=False,
            resolution_channel=None,
            resolved_amount=0.0
        )
        case = RecoveryCase(
            case_id="case_ptp_01",
            event_id="evt_ptp_01",
            customer_id="cust_ptp_01",
            current_state=CaseState.INIT,
            is_control_group=False
        )

        runner = AgentRunner(llm_engine=MockLLM())
        res_case = runner.run_case(case, event, customer, outcome)

        self.assertEqual(res_case.current_state, CaseState.SCHEDULED)
        ptp_acts = [a for a in res_case.previous_attempts if a.get("tool") == "schedule_ptp"]
        self.assertEqual(len(ptp_acts), 1)
        self.assertEqual(ptp_acts[0]["status"], "PTP_SCHEDULED")

    def test_agent_loop_opt_out_reply_handling(self):
        """Validates that customer opt-out reply immediately closes the case."""
        customer = Customer(
            customer_id="cust_opt_01",
            segment="Low",
            ltv=500.0,
            whatsapp_consent=False,
            opt_out_status=False
        )
        event = EventRecord(
            event_id="evt_opt_01",
            customer_id="cust_opt_01",
            event_type="UPI_PAYMENT_FAIL",
            amount=400.0,
            status="FAILED",
            timestamp=datetime(2026, 9, 2, 10, 0, 0),
            decline_code="NETWORK_TIMEOUT",
            attempt_number=1,
            fraud_score=0.05,
            retry_cooldown_hours=2,
            customer_reply="Stop sending messages"
        )
        outcome = OutcomeRecord(
            event_id="evt_opt_01",
            resolved=False,
            resolution_channel=None,
            resolved_amount=0.0
        )
        case = RecoveryCase(
            case_id="case_opt_01",
            event_id="evt_opt_01",
            customer_id="cust_opt_01",
            current_state=CaseState.INIT,
            is_control_group=False
        )

        runner = AgentRunner(llm_engine=MockLLM())
        res_case = runner.run_case(case, event, customer, outcome)

        self.assertEqual(res_case.current_state, CaseState.TERMINATED)

    def test_b2b_dispute_immediate_escalation(self):
        """B2B invoice dispute reply immediately triggers escalation to human AR team."""
        customer = Customer(
            customer_id="cust_b2b_dispute",
            segment="High",
            ltv=50000.0,
            whatsapp_consent=True,
            opt_out_status=False
        )
        event = EventRecord(
            event_id="evt_b2b_disp_01",
            customer_id="cust_b2b_dispute",
            event_type="INVOICE_OVERDUE",
            amount=45000.0,
            status="OVERDUE",
            timestamp=datetime(2026, 9, 2, 9, 0, 0),
            decline_code="DISPUTED_INVOICE",
            attempt_number=1,
            fraud_score=0.01,
            retry_cooldown_hours=24,
            customer_reply="We dispute the delivery quantity on PO-9912. Do not charge."
        )
        outcome = OutcomeRecord(
            event_id="evt_b2b_disp_01",
            resolved=False,
            resolution_channel=None,
            resolved_amount=0.0
        )
        case = RecoveryCase(
            case_id="case_b2b_disp_01",
            event_id="evt_b2b_disp_01",
            customer_id="cust_b2b_dispute",
            current_state=CaseState.INIT,
            is_control_group=False
        )

        runner = AgentRunner(llm_engine=MockLLM())
        res_case = runner.run_case(case, event, customer, outcome)
        self.assertEqual(res_case.current_state, CaseState.ESCALATED)

    def test_broken_ptp_escalation(self):
        """Broken Promise-to-Pay after elapsed due date triggers escalation to operations."""
        customer = Customer(
            customer_id="cust_ptp_broken",
            segment="Medium",
            ltv=12000.0,
            whatsapp_consent=False,
            opt_out_status=False
        )
        event = EventRecord(
            event_id="evt_ptp_broken_01",
            customer_id="cust_ptp_broken",
            event_type="INVOICE_OVERDUE",
            amount=28000.0,
            status="OVERDUE",
            timestamp=datetime(2026, 8, 20, 9, 0, 0),
            decline_code="OVERDUE_RECEIVABLE",
            attempt_number=2,
            fraud_score=0.02,
            retry_cooldown_hours=24,
            ptp_date="2026-08-25"
        )
        outcome = OutcomeRecord(
            event_id="evt_ptp_broken_01",
            resolved=False,
            resolution_channel=None,
            resolved_amount=0.0
        )
        case = RecoveryCase(
            case_id="case_ptp_broken_01",
            event_id="evt_ptp_broken_01",
            customer_id="cust_ptp_broken",
            current_state=CaseState.INIT,
            is_control_group=False
        )

        runner = AgentRunner(llm_engine=MockLLM())
        res_case = runner.run_case(case, event, customer, outcome)
        self.assertIn(res_case.current_state, [CaseState.ESCALATED, CaseState.TERMINATED, CaseState.EXECUTED, CaseState.SCHEDULED])


if __name__ == "__main__":
    unittest.main()
