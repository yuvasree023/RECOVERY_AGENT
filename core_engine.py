"""Core Revenue Recovery Engine.

Provides:
- RevenueDetector: Filters inbound webhook events for FAILED/DROPPED states.
- DiagnosisEngine: Maps decline codes to root causes and mitigation strategies.
- RecoverEngine: Orchestrates the ReAct Agent Loop and compliance guardrails.
"""

from typing import Dict, Any, Tuple, Optional, List
from datetime import datetime
import uuid

from models import RecoveryCase, CaseState, EventRecord, Customer, OutcomeRecord, AuditLog
from guardrails import evaluate_guardrails, GuardrailContext
from ml_model import predict_recovery_probability
from agent_loop import AgentRunner, MockLLM
import tools


class RevenueDetector:
    """Detects and filters revenue-at-risk events."""

    RECOVERABLE_TYPES = {"UPI_PAYMENT_FAIL", "CART_ABANDON", "SUBSCRIPTION_FAIL"}
    RECOVERABLE_STATUSES = {"FAILED", "DROPPED"}

    @classmethod
    def should_recover(cls, event_type: str, status: str) -> bool:
        return event_type in cls.RECOVERABLE_TYPES and status in cls.RECOVERABLE_STATUSES


class DiagnosisEngine:
    """Deterministic decline code diagnosis and strategy recommendation."""

    DECLINE_MAP = {
        "NETWORK_TIMEOUT": {
            "root_cause": "TECHNICAL_GLITCH",
            "retry_strategy": "COOLDOWN_RETRY",
            "description": "Network timeout or bank gateway downtime. Auto-retry after cooldown.",
        },
        "INSUFFICIENT_FUNDS": {
            "root_cause": "CASH_FLOW_ISSUE",
            "retry_strategy": "SCHEDULED_RETRY",
            "description": "Insufficient funds in customer account. Schedule retry with alert.",
        },
        "CARD_EXPIRED": {
            "root_cause": "OUTDATED_PAYMENT_METHOD",
            "retry_strategy": "UPDATE_INSTRUMENT",
            "description": "Payment card expired. Prompt customer to update payment details.",
        },
        "HIGH_SHIPPING_COST": {
            "root_cause": "CHECKOUT_FRICTION",
            "retry_strategy": "INCENTIVE_DISCOUNT",
            "description": "Checkout abandoned due to shipping cost. Offer incentive discount.",
        },
    }

    @classmethod
    def diagnose(cls, decline_code: str) -> Dict[str, str]:
        return cls.DECLINE_MAP.get(decline_code, {
            "root_cause": "UNKNOWN_ERROR",
            "retry_strategy": "MANUAL_REVIEW",
            "description": f"Unrecognized decline code: {decline_code}",
        })
