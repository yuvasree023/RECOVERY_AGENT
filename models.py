"""Data structures and storage models for Recover AI Revenue Recovery Agent."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum
import uuid


class CaseState(str, Enum):
    INIT = "INIT"
    DIAGNOSED = "DIAGNOSED"
    SCHEDULED = "SCHEDULED"
    EXECUTED = "EXECUTED"
    RESOLVED = "RESOLVED"
    TERMINATED = "TERMINATED"
    ESCALATED = "ESCALATED"


class AuditStep(str, Enum):
    OBSERVE = "OBSERVE"
    REASON = "REASON"
    PLAN = "PLAN"
    GUARDRAIL_CHECK = "GUARDRAIL_CHECK"
    GUARDRAIL_FAIL = "GUARDRAIL_FAIL"
    REPLAN = "REPLAN"
    ACT = "ACT"
    OBSERVE_OUTCOME = "OBSERVE_OUTCOME"
    ESCALATE = "ESCALATE"
    CLOSE = "CLOSE"


@dataclass
class Customer:
    customer_id: str
    segment: str  # 'High', 'Medium', 'Low'
    ltv: float
    whatsapp_consent: bool
    opt_out_status: bool


@dataclass
class EventRecord:
    event_id: str
    customer_id: str
    event_type: str  # 'UPI_PAYMENT_FAIL', 'CART_ABANDON', 'SUBSCRIPTION_FAIL'
    amount: float
    status: str  # 'FAILED', 'DROPPED'
    timestamp: datetime
    decline_code: str  # 'NETWORK_TIMEOUT', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'HIGH_SHIPPING_COST'
    attempt_number: int
    fraud_score: float
    retry_cooldown_hours: int
    ptp_date: Optional[str] = None
    customer_reply: Optional[str] = None


@dataclass
class OutcomeRecord:
    event_id: str
    resolved: bool
    resolution_channel: Optional[str]
    resolved_amount: float
    resolution_timestamp: Optional[datetime] = None


@dataclass
class ChannelCostRecord:
    channel: str
    cost_per_send: float
    avg_response_time_hours: int
    dnd_start: Optional[str] = "21:00"
    dnd_end: Optional[str] = "08:00"


@dataclass
class RecoveryCase:
    case_id: str
    event_id: str
    customer_id: str
    current_state: CaseState = CaseState.INIT
    current_attempt: int = 0
    max_attempts: int = 3
    loop_iterations: int = 0
    max_loop_iterations: int = 4
    next_action_time: Optional[datetime] = None
    recovery_probability: Optional[float] = None
    is_control_group: bool = False
    total_recovered_amount: float = 0.0
    total_cost_incurred: float = 0.0
    previous_attempts: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class AuditLog:
    log_id: str
    case_id: str
    timestamp: datetime
    step: AuditStep
    detail: Any
