"""Execution Tools for Recover AI Agent.

Defines the mock tool actions the Agent can execute during the ACT phase.
All external channel and gateway integrations are cleanly mocked with cost & audit tracking.
Includes outcome-awareness tools: checking customer replies and parsing Hinglish Promise-To-Pay (PTP) intent.
"""

import os
import re
import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

CHANNEL_COSTS: Dict[str, float] = {
    "WhatsApp": 0.35,
    "SMS": 0.15,
    "Email": 0.05,
}

MAX_DISCOUNT_PERCENT = 10.0

# In-memory registry for mock customer replies (can be seeded or dynamic)
_SIMULATED_REPLIES: Dict[str, str] = {}


def register_simulated_reply(case_id: str, reply_text: str) -> None:
    """Registers a mock customer reply for testing and simulation."""
    _SIMULATED_REPLIES[case_id] = reply_text


def clear_simulated_replies() -> None:
    """Clears all in-memory mock customer replies."""
    _SIMULATED_REPLIES.clear()


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


def schedule_ptp(case_id: str, ptp_date: str) -> Dict[str, Any]:
    """Schedules a Promise-to-Pay (PTP) hold, halting aggressive retries until the promised date."""
    ptp_id = f"PTP_{uuid.uuid4().hex[:8].upper()}"
    return {
        "status": "PTP_SCHEDULED",
        "case_id": case_id,
        "ptp_id": ptp_id,
        "ptp_date": ptp_date,
        "action": "HALT_ACTIVE_RETRIES",
        "scheduled_at": datetime.utcnow().isoformat(),
    }


def check_customer_reply(case_id: str, context: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """
    Checks if the customer has sent a message or reply following a notification.
    Returns the latest customer message (Hinglish/English) or None.
    """
    # 1. Direct simulation override registry check
    if case_id in _SIMULATED_REPLIES:
        return _SIMULATED_REPLIES[case_id]

    # 2. Check if context contains an explicit ptp_date or simulated reply
    if context:
        if context.get("customer_reply"):
            return str(context["customer_reply"])
        if context.get("ptp_date"):
            return f"Kal salary aayegi tab pay karunga ({context['ptp_date']})"

    return None


def extract_ptp_intent(reply: str) -> Dict[str, Any]:
    """
    Analyzes customer messages (supporting English and Hinglish) to detect Promise-To-Pay (PTP),
    disputes, opt-outs, or general inquiries.
    Returns structured intent payload:
    {"intent": "promise_to_pay" | "dispute" | "opt_out" | "general_query" | "none", "date": "YYYY-MM-DD", "summary": "..."}
    """
    if not reply or not reply.strip():
        return {
            "intent": "none",
            "date": None,
            "summary": "No reply text provided"
        }

    reply_lower = reply.lower().strip()

    # Opt-out detection
    if any(k in reply_lower for k in ["stop", "unsubscribe", "don't message", "dont message", "remove me"]):
        return {
            "intent": "opt_out",
            "date": None,
            "summary": "Customer requested opt-out from notifications."
        }

    # Dispute / rejection detection
    if any(k in reply_lower for k in ["dispute", "disputed", "cancel my order", "scam", "fraud", "not interested", "wrong charge", "expensive", "do not charge", "dont charge"]):
        return {
            "intent": "dispute",
            "date": None,
            "summary": "Customer raised dispute or declined transaction."
        }

    # Promise-to-Pay (PTP) detection in Hinglish and English
    ptp_keywords = [
        "pay", "salary", "kal", "parso", "friday", "monday", "tuesday", "wednesday", "thursday",
        "saturday", "sunday", "tomorrow", "evening", "shaam", "baad", "karenge", "karunga",
        "cleared", "arrange", "next week", "tarikh", "tareekh"
    ]
    is_ptp = any(k in reply_lower for k in ptp_keywords)

    if is_ptp:
        # Extract date from reply if formatted (e.g. YYYY-MM-DD)
        date_match = re.search(r"\b(202\d[-/]\d{1,2}[-/]\d{1,2})\b", reply)
        if date_match:
            extracted_date = date_match.group(1).replace("/", "-")
        else:
            # Derive relative date (default tomorrow / 3 days out)
            if "kal" in reply_lower or "tomorrow" in reply_lower:
                derived = datetime.utcnow().date() + timedelta(days=1)
            elif "parso" in reply_lower:
                derived = datetime.utcnow().date() + timedelta(days=2)
            elif "friday" in reply_lower:
                days_ahead = (4 - datetime.utcnow().weekday()) % 7 or 7
                derived = datetime.utcnow().date() + timedelta(days=days_ahead)
            elif "monday" in reply_lower:
                days_ahead = (0 - datetime.utcnow().weekday()) % 7 or 7
                derived = datetime.utcnow().date() + timedelta(days=days_ahead)
            elif "salary" in reply_lower or "next week" in reply_lower:
                derived = datetime.utcnow().date() + timedelta(days=5)
            else:
                derived = datetime.utcnow().date() + timedelta(days=1)
            extracted_date = derived.isoformat()

        return {
            "intent": "promise_to_pay",
            "date": extracted_date,
            "summary": f"Customer promised to pay on {extracted_date}: '{reply}'"
        }

    return {
        "intent": "general_query",
        "date": None,
        "summary": f"General inquiry: '{reply}'"
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

