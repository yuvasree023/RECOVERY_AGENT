"""Execution Tools for Recover AI Agent.

Defines the mock tool actions the Agent can execute during the ACT phase.
All external channel and gateway integrations are cleanly mocked with cost & audit tracking.
"""

import uuid
from datetime import datetime
from typing import Dict, Any, Optional

CHANNEL_COSTS: Dict[str, float] = {
    "WhatsApp": 0.35,
    "SMS": 0.15,
    "Email": 0.05,
}

MAX_DISCOUNT_PERCENT = 10.0


def schedule_retry(case_id: str, retry_time: datetime, cooldown_hours: int = 2) -> Dict[str, Any]:
    """Schedules an automated payment retry on the payment gateway."""
    ref_id = f"RETRY_{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "SCHEDULED",
        "case_id": case_id,
        "reference_id": ref_id,
        "scheduled_for": retry_time.isoformat() if isinstance(retry_time, datetime) else str(retry_time),
        "cooldown_hours": cooldown_hours,
    }


def send_message(
    case_id: str,
    channel: str,
    template_id: str,
    variables: Dict[str, Any],
    cost_override: Optional[float] = None
) -> Dict[str, Any]:
    """Sends a templated notification to the customer via WhatsApp, SMS, or Email."""
    msg_id = f"MSG_{uuid.uuid4().hex[:8].upper()}"
    cost = cost_override if cost_override is not None else CHANNEL_COSTS.get(channel, 0.05)
    return {
        "status": "SENT",
        "message_id": msg_id,
        "case_id": case_id,
        "channel": channel,
        "template_id": template_id,
        "cost_incurred": cost,
        "variables": variables,
        "timestamp": datetime.utcnow().isoformat(),
    }


def offer_discount(case_id: str, pct: float) -> Dict[str, Any]:
    """Generates an incentive discount coupon code, strictly capped at 10%."""
    effective_pct = min(float(pct), MAX_DISCOUNT_PERCENT)
    coupon_code = f"RECOVER{int(effective_pct)}"
    return {
        "status": "OFFERED",
        "case_id": case_id,
        "requested_pct": pct,
        "applied_pct": effective_pct,
        "coupon_code": coupon_code,
        "expires_in_hours": 24,
    }


def escalate_to_human(case_id: str, reason: str) -> Dict[str, Any]:
    """Escalates a complex or high-risk case to human support / ops desk."""
    ticket_id = f"TICK_{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "ESCALATED",
        "case_id": case_id,
        "ticket_id": ticket_id,
        "reason": reason,
        "timestamp": datetime.utcnow().isoformat(),
    }


def close_case(case_id: str, outcome: str, recovered_amount: float = 0.0) -> Dict[str, Any]:
    """Marks a case as closed (RESOLVED or TERMINATED)."""
    return {
        "status": "CLOSED",
        "case_id": case_id,
        "final_state": outcome,
        "recovered_amount": recovered_amount,
        "closed_at": datetime.utcnow().isoformat(),
    }
