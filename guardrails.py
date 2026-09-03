"""Deterministic compliance guardrails for Recover AI Agent.

7 Hard-Coded Fail-Closed Compliance Rules:
1. Customer Opt-Out Check: If customer has opted out, terminate immediately.
2. Fraud Score Threshold: If fraud score > 0.8, terminate and flag manual review.
3. Max Contact Attempts: If attempts >= 3, terminate.
4. Agent Loop Circuit Breaker: If loop iterations >= 4, escalate.
5. Cooldown Interval: No contact within retry_cooldown_hours of last action.
6. DND Window: No WhatsApp / SMS between 21:00 and 08:00.
7. Control Group Isolation: If is_control_group, block active execution.
"""

from dataclasses import dataclass
from datetime import datetime, time
from typing import Optional, Dict, Any


@dataclass
class GuardrailContext:
    opt_out_status: bool
    fraud_score: float
    retry_cooldown_hours: int
    current_attempt: int
    max_attempts: int = 3
    loop_iterations: int = 0
    max_loop_iterations: int = 4
    is_control_group: bool = False
    last_act_timestamp: Optional[datetime] = None
    channel: Optional[str] = None
    proposed_action_time: Optional[datetime] = None
    whatsapp_consent: bool = True
    discount_pct: float = 0.0


@dataclass
class GuardrailDecision:
    passed: bool
    status: str  # 'PROCEED', 'TERMINATE', 'ESCALATE', 'BLOCK_ACT'
    violated_rule: Optional[int]
    reason: str
    flag_manual_review: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "status": self.status,
            "violated_rule": self.violated_rule,
            "reason": self.reason,
            "flag_manual_review": self.flag_manual_review,
        }


def check_dnd_window(dt: datetime, dnd_start_hour: int = 21, dnd_end_hour: int = 8) -> bool:
    """Returns True if the given datetime falls inside the DND window (21:00 to 08:00)."""
    t = dt.time()
    # 21:00:00 to 23:59:59 OR 00:00:00 to 07:59:59
    if t >= time(dnd_start_hour, 0) or t < time(dnd_end_hour, 0):
        return True
    return False


def evaluate_guardrails(ctx: GuardrailContext) -> GuardrailDecision:
    """Evaluate all 7 fail-closed compliance guardrails in priority order."""
    
    # Rule 1: Customer Opt-Out Check
    if ctx.opt_out_status:
        return GuardrailDecision(
            passed=False,
            status="TERMINATE",
            violated_rule=1,
            reason="Customer has opted out of communications (opt_out_status=True)."
        )

    # Rule 2: Fraud Score Check
    if ctx.fraud_score > 0.8:
        return GuardrailDecision(
            passed=False,
            status="TERMINATE",
            violated_rule=2,
            reason=f"Fraud score ({ctx.fraud_score:.2f}) exceeds compliance threshold 0.80.",
            flag_manual_review=True
        )

    # Rule 3: Contact Attempts Exhaustion
    if ctx.current_attempt >= ctx.max_attempts:
        return GuardrailDecision(
            passed=False,
            status="TERMINATE",
            violated_rule=3,
            reason=f"Maximum contact attempts reached ({ctx.current_attempt}/{ctx.max_attempts})."
        )

    # Rule 4: Reasoning Loop Iteration Circuit Breaker
    if ctx.loop_iterations >= ctx.max_loop_iterations:
        return GuardrailDecision(
            passed=False,
            status="ESCALATE",
            violated_rule=4,
            reason=f"Agent loop iteration limit exceeded ({ctx.loop_iterations}/{ctx.max_loop_iterations}). Circuit breaker tripped."
        )

    # Rule 5: Contact Cooldown Violation
    if ctx.last_act_timestamp is not None and ctx.proposed_action_time is not None:
        elapsed_seconds = (ctx.proposed_action_time - ctx.last_act_timestamp).total_seconds()
        required_seconds = ctx.retry_cooldown_hours * 3600
        if elapsed_seconds < required_seconds:
            return GuardrailDecision(
                passed=False,
                status="BLOCK_ACT",
                violated_rule=5,
                reason=f"Contact cooldown active. Elapsed: {elapsed_seconds / 3600:.1f}h, Required: {ctx.retry_cooldown_hours}h."
            )

    # Rule 6: DND Window Check (WhatsApp / SMS)
    if ctx.channel in ("WhatsApp", "SMS") and ctx.proposed_action_time is not None:
        if check_dnd_window(ctx.proposed_action_time):
            return GuardrailDecision(
                passed=False,
                status="BLOCK_ACT",
                violated_rule=6,
                reason=f"Proposed send time ({ctx.proposed_action_time.strftime('%H:%M')}) falls inside DND window (21:00-08:00) for {ctx.channel}."
            )

    # Rule 7: Control Group Isolation
    if ctx.is_control_group:
        return GuardrailDecision(
            passed=False,
            status="BLOCK_ACT",
            violated_rule=7,
            reason="Case is assigned to control group. Active interventions blocked for A/B holdout."
        )

    # Rule 8: Unsolicited WhatsApp Consent Check
    if ctx.channel == "WhatsApp" and ctx.whatsapp_consent is False:
        return GuardrailDecision(
            passed=False,
            status="BLOCK_ACT",
            violated_rule=8,
            reason="WhatsApp outreach prohibited without verified customer opt-in consent."
        )

    # Rule 9: Margin Protection Discount Cap
    if ctx.discount_pct > 20.0:
        return GuardrailDecision(
            passed=False,
            status="BLOCK_ACT",
            violated_rule=9,
            reason=f"Proposed discount ({ctx.discount_pct}%) exceeds approved margin cap of 20.0%."
        )

    # Passed all compliance guardrails
    return GuardrailDecision(
        passed=True,
        status="PROCEED",
        violated_rule=None,
        reason="All compliance guardrails passed."
    )
