"""Autonomous ReAct (Reasoning + Acting) Agent Loop for Revenue Recovery.

Architecture:
1. OBSERVE: Gather case context, customer attributes, outcome history, ML recovery score, and previous attempts.
2. REASON (LLM / MockLLM): Generate structured Chain-of-Thought analysis and plan bounded by schema.
3. PLAN (LLM Tool Calling): Select tool & generate execution parameters in JSON.
4. GUARDRAIL_CHECK (Deterministic): Intercept plan through 7 fail-closed compliance rules.
5. REPLAN (Adaptive Loop): If guardrail returns BLOCK_ACT, feed feedback to LLM for one replan before escalation.
6. ACT: Execute approved tool against mock gateway/messaging APIs.
7. OBSERVE OUTCOME: Record telemetry, update state, and loop or close case.
"""

import json
import os
from datetime import datetime, timedelta, time
from typing import Dict, Any, Optional, List, Tuple

from models import RecoveryCase, CaseState, AuditStep, Customer, EventRecord, OutcomeRecord, AuditLog
from guardrails import GuardrailContext, GuardrailDecision, evaluate_guardrails, check_dnd_window
from ml_model import predict_recovery_probability
from llm_engine import MockLLM, LLMEngine
import tools

# Re-export MockLLM and LLMEngine for drop-in compatibility
__all__ = ["AgentRunner", "MockLLM", "LLMEngine", "calculate_action_time", "render_message_body", "TEMPLATES"]

TEMPLATES: Dict[str, Dict[str, str]] = {
    "PAYMENT_RETRY": {
        "template_id": "TPL_PAY_RETRY_01",
        "text": "Hi {customer_name}, your payment of INR {amount} was not completed due to {reason}. We have scheduled a retry at {retry_time}. Complete it instantly here: https://rzp.io/i/{event_id}",
    },
    "CARD_EXPIRED": {
        "template_id": "TPL_CARD_EXP_01",
        "text": "Hi {customer_name}, your payment method for INR {amount} has expired. Please update your card details securely: https://rzp.io/pay/{event_id}",
    },
    "INSUFFICIENT_FUNDS": {
        "template_id": "TPL_FUNDS_RETRY_01",
        "text": "Hi {customer_name}, your transaction of INR {amount} could not be processed. We will retry on {retry_time}. Pay now directly: https://rzp.io/i/{event_id}",
    },
    "CART_DISCOUNT": {
        "template_id": "TPL_CART_DISC_01",
        "text": "Hi {customer_name}, complete your purchase of INR {amount} with an exclusive {discount_pct}% discount! Use code {coupon_code}: https://rzp.io/cart/{event_id}",
    },
    "CART_REMINDER": {
        "template_id": "TPL_CART_REM_01",
        "text": "Hi {customer_name}, your items worth INR {amount} are waiting in your cart. Finish your checkout here: https://rzp.io/cart/{event_id}",
    },
}


def calculate_action_time(current_time: datetime, cooldown_hours: int, channel: str) -> datetime:
    """Calculates next valid execution time, advancing outside of DND windows if needed."""
    next_time = current_time + timedelta(hours=cooldown_hours)
    if channel in ("WhatsApp", "SMS"):
        if check_dnd_window(next_time):
            if next_time.hour >= 21:
                # Push to 08:00 AM next day
                next_day = next_time.date() + timedelta(days=1)
                return datetime.combine(next_day, time(8, 0))
            elif next_time.hour < 8:
                # Push to 08:00 AM same day
                return datetime.combine(next_day := next_time.date(), time(8, 0))
    return next_time


def render_message_body(template_key: str, variables: Dict[str, Any]) -> str:
    tpl_info = TEMPLATES.get(template_key, TEMPLATES["PAYMENT_RETRY"])
    text = tpl_info["text"]
    defaults = {
        "customer_name": "Customer",
        "amount": f"{float(variables.get('amount', 0.0)):.2f}",
        "reason": "transaction decline",
        "retry_time": "shortly",
        "event_id": variables.get("event_id", ""),
        "discount_pct": 10,
        "coupon_code": "RECOVER10",
    }
    merged = {**defaults, **variables}
    for k, v in merged.items():
        text = text.replace(f"{{{k}}}", str(v))
    return text


class AgentRunner:
    """Orchestrates case recovery through the bounded ReAct Agent Loop."""

    def __init__(
        self,
        data_dir: str = "data",
        llm_mode: Optional[str] = None,
        llm: Optional[Any] = None,
        llm_engine: Optional[Any] = None
    ):
        self.data_dir = data_dir
        engine = llm_engine if llm_engine is not None else llm
        if engine is not None:
            self.llm = engine
        else:
            mode = (llm_mode or os.getenv("LLM_MODE", "mock")).lower().strip()
            if mode == "live":
                self.llm = LLMEngine()
            else:
                self.llm = MockLLM()

    def run_case(
        self,
        case: RecoveryCase,
        event: EventRecord,
        customer: Customer,
        outcome: Optional[OutcomeRecord] = None,
        audit_sink: Optional[List[AuditLog]] = None
    ) -> RecoveryCase:
        def log_step(step: AuditStep, detail: Any, ts: datetime):
            log = AuditLog(
                log_id=f"LOG_{ts.strftime('%Y%m%d%H%M%S')}_{step.value}",
                case_id=case.case_id,
                timestamp=ts,
                step=step,
                detail=detail
            )
            if audit_sink is not None:
                audit_sink.append(log)

        sim_time = event.timestamp
        last_act_time: Optional[datetime] = None

        # Pre-flight check: Already resolved before agent start
        if outcome and outcome.resolved and outcome.resolution_timestamp and outcome.resolution_timestamp <= event.timestamp:
            case.current_state = CaseState.RESOLVED
            case.total_recovered_amount = outcome.resolved_amount
            log_step(
                AuditStep.OBSERVE,
                {"status": "ALREADY_RESOLVED", "message": "Transaction resolved prior to agent intervention."},
                sim_time
            )
            return case

        # Main ReAct Loop: "LLM Proposes, Guardrail Disposes"
        while case.current_state not in (CaseState.RESOLVED, CaseState.TERMINATED, CaseState.ESCALATED):
            # Circuit breaker check on loop iterations
            if case.loop_iterations >= case.max_loop_iterations:
                case.current_state = CaseState.ESCALATED
                tools.escalate_to_human(case.case_id, "Loop iteration limit reached (circuit breaker).")
                log_step(AuditStep.ESCALATE, {"reason": "Max loop iterations exceeded (circuit breaker)."}, sim_time)
                break

            # ---------------------------------------------------------
            # STEP 1: OBSERVE
            # ---------------------------------------------------------
            rec_prob = predict_recovery_probability({
                "segment": customer.segment,
                "ltv": customer.ltv,
                "decline_code": event.decline_code,
                "attempt_number": case.current_attempt + 1,
                "event_type": event.event_type,
            }, data_dir=self.data_dir)
            case.recovery_probability = rec_prob

            obs_context = {
                "case_id": case.case_id,
                "event_id": event.event_id,
                "event_type": event.event_type,
                "decline_code": event.decline_code,
                "amount": event.amount,
                "segment": customer.segment,
                "ltv": customer.ltv,
                "whatsapp_consent": customer.whatsapp_consent,
                "opt_out_status": customer.opt_out_status,
                "fraud_score": event.fraud_score,
                "current_attempt": case.current_attempt,
                "max_attempts": case.max_attempts,
                "loop_iterations": case.loop_iterations,
                "recovery_probability": rec_prob,
                "is_control_group": case.is_control_group,
                "previous_attempts": list(case.previous_attempts),
            }

            log_step(AuditStep.OBSERVE, obs_context, sim_time)

            # ---------------------------------------------------------
            # STEP 2 & 3: REASON & PLAN (LLM Autonomous Agent ReAct)
            # ---------------------------------------------------------
            cot_reasoning, plan = self.llm.reason_and_plan(obs_context)

            tool = plan.get("tool", "send_message")
            channel = plan.get("channel", "Email")
            template_key = plan.get("template_key", "PAYMENT_RETRY")
            action_type = plan.get("action_type", "SEND_MESSAGE")
            discount_pct = float(plan.get("discount_pct", 0.0))
            template_id = TEMPLATES.get(template_key, {}).get("template_id", "TPL_PAY_RETRY_01")

            action_time = calculate_action_time(sim_time, event.retry_cooldown_hours, channel)
            case.next_action_time = action_time
            case.current_state = CaseState.SCHEDULED

            # Log Chain of Thought & Tool Proposal with raw LLM outputs
            log_step(AuditStep.REASON, {
                "llm_thought": cot_reasoning,
                "reasoning": cot_reasoning,
                "recovery_probability": rec_prob,
                "engine_mode": plan.get("_engine_mode", "mock"),
                "raw_llm_response": plan.get("_raw_response", None),
                "structured_plan": {
                    "tool": tool,
                    "channel": channel,
                    "template_key": template_key,
                    "discount_pct": discount_pct,
                    "action_type": action_type
                }
            }, sim_time)

            log_step(AuditStep.PLAN, {
                "llm_thought": cot_reasoning,
                "proposed_tool": tool,
                "tool_args": {
                    "channel": channel,
                    "template_key": template_key,
                    "action_type": action_type,
                    "discount_pct": discount_pct
                },
                "channel": channel,
                "scheduled_time": action_time.isoformat(),
                "template_key": template_key,
                "discount_pct": discount_pct,
                "engine_mode": plan.get("_engine_mode", "mock")
            }, sim_time)

            # ---------------------------------------------------------
            # STEP 4: GUARDRAIL_CHECK (LLM Proposes, Guardrail Disposes)
            # ---------------------------------------------------------
            g_ctx = GuardrailContext(
                opt_out_status=customer.opt_out_status,
                fraud_score=event.fraud_score,
                retry_cooldown_hours=event.retry_cooldown_hours,
                current_attempt=case.current_attempt,
                max_attempts=case.max_attempts,
                loop_iterations=case.loop_iterations,
                max_loop_iterations=case.max_loop_iterations,
                is_control_group=case.is_control_group,
                last_act_timestamp=last_act_time,
                channel=channel,
                proposed_action_time=action_time,
            )
            decision = evaluate_guardrails(g_ctx)
            log_step(AuditStep.GUARDRAIL_CHECK, decision.to_dict(), sim_time)

            # --- ADAPTIVE REPLAN PATH ---
            # If guardrail returns BLOCK_ACT (not TERMINATE/ESCALATE), allow ONE re-plan attempt
            if not decision.passed:
                if decision.status == "TERMINATE":
                    case.current_state = CaseState.TERMINATED
                    tools.close_case(case.case_id, "TERMINATED", 0.0)
                    log_step(AuditStep.CLOSE, {"outcome": "TERMINATED", "reason": decision.reason}, sim_time)
                    break

                if decision.status == "ESCALATE":
                    case.current_state = CaseState.ESCALATED
                    tools.escalate_to_human(case.case_id, decision.reason)
                    log_step(AuditStep.ESCALATE, {"reason": decision.reason}, sim_time)
                    break

                # Status is BLOCK_ACT
                if case.is_control_group:
                    # Control group stays isolated without active intervention
                    pass
                else:
                    # Record rejected attempt in previous_attempts
                    case.previous_attempts.append({
                        "attempt": case.current_attempt + 1,
                        "tool": tool,
                        "channel": channel,
                        "template_key": template_key,
                        "action_type": action_type,
                        "discount_pct": discount_pct,
                        "rejected": True,
                        "rejection_reason": decision.reason
                    })

                    log_step(AuditStep.GUARDRAIL_FAIL, {
                        "rejected_plan": tool,
                        "rejected_channel": channel,
                        "rejection_reason": decision.reason,
                        "action": "Invoking LLM Replan Loop with guardrail rejection feedback"
                    }, sim_time)

                    # ONE Re-plan attempt
                    replan_obs = {
                        **obs_context,
                        "previous_attempts": list(case.previous_attempts)
                    }
                    replan_thought, replan_plan = self.llm.reason_and_plan(replan_obs, previous_rejections=decision.reason)
                    replan_tool = replan_plan.get("tool", "send_message")
                    replan_channel = replan_plan.get("channel", "Email")
                    replan_template_key = replan_plan.get("template_key", "PAYMENT_RETRY")
                    replan_action_type = replan_plan.get("action_type", "SEND_MESSAGE")
                    replan_discount_pct = float(replan_plan.get("discount_pct", 0.0))
                    replan_template_id = TEMPLATES.get(replan_template_key, {}).get("template_id", "TPL_PAY_RETRY_01")
                    replan_action_time = calculate_action_time(sim_time, event.retry_cooldown_hours, replan_channel)

                    log_step(AuditStep.REPLAN, {
                        "llm_thought": replan_thought,
                        "reasoning": replan_thought,
                        "proposed_tool": replan_tool,
                        "engine_mode": replan_plan.get("_engine_mode", "mock"),
                        "raw_llm_response": replan_plan.get("_raw_response", None),
                        "replan_args": {
                            "channel": replan_channel,
                            "template_key": replan_template_key,
                            "action_type": replan_action_type,
                            "discount_pct": replan_discount_pct
                        },
                        "channel": replan_channel,
                        "scheduled_time": replan_action_time.isoformat()
                    }, sim_time)

                    # Re-validate with Guardrails
                    replan_g_ctx = GuardrailContext(
                        opt_out_status=customer.opt_out_status,
                        fraud_score=event.fraud_score,
                        retry_cooldown_hours=event.retry_cooldown_hours,
                        current_attempt=case.current_attempt,
                        max_attempts=case.max_attempts,
                        loop_iterations=case.loop_iterations,
                        max_loop_iterations=case.max_loop_iterations,
                        is_control_group=case.is_control_group,
                        last_act_timestamp=last_act_time,
                        channel=replan_channel,
                        proposed_action_time=replan_action_time,
                    )
                    replan_decision = evaluate_guardrails(replan_g_ctx)
                    log_step(AuditStep.GUARDRAIL_CHECK, {
                        **replan_decision.to_dict(),
                        "attempt": "REPLAN_VALIDATION"
                    }, sim_time)

                    if replan_decision.passed:
                        # Adopt the approved replanned action
                        tool = replan_tool
                        channel = replan_channel
                        template_key = replan_template_key
                        action_type = replan_action_type
                        discount_pct = replan_discount_pct
                        template_id = replan_template_id
                        action_time = replan_action_time
                        case.next_action_time = replan_action_time
                    else:
                        case.previous_attempts.append({
                            "attempt": case.current_attempt + 1,
                            "tool": replan_tool,
                            "channel": replan_channel,
                            "template_key": replan_template_key,
                            "action_type": replan_action_type,
                            "discount_pct": replan_discount_pct,
                            "rejected": True,
                            "rejection_reason": replan_decision.reason
                        })
                        if replan_decision.status == "TERMINATE":
                            case.current_state = CaseState.TERMINATED
                            tools.close_case(case.case_id, "TERMINATED", 0.0)
                            log_step(AuditStep.CLOSE, {"outcome": "TERMINATED", "reason": replan_decision.reason}, sim_time)
                            break
                        else:
                            case.current_state = CaseState.ESCALATED
                            tools.escalate_to_human(case.case_id, f"Replan failed guardrail: {replan_decision.reason}")
                            log_step(AuditStep.ESCALATE, {"reason": replan_decision.reason}, sim_time)
                            break

            # ---------------------------------------------------------
            # STEP 5: ACT (Execution of Guardrail-Approved Tool)
            # ---------------------------------------------------------
            if not case.is_control_group:
                cust_name = f"Customer {customer.customer_id.split('_')[-1]}"
                msg_vars = {
                    "customer_name": cust_name,
                    "amount": f"{event.amount:.2f}",
                    "reason": event.decline_code.replace("_", " ").lower(),
                    "retry_time": action_time.strftime("%d %b %H:%M"),
                    "event_id": case.event_id,
                    "discount_pct": int(discount_pct),
                    "coupon_code": f"RECOVER{int(discount_pct)}" if discount_pct > 0 else "",
                }
                rendered = render_message_body(template_key, msg_vars)
                cost_per_send = tools.CHANNEL_COSTS.get(channel, 0.05)

                tool_exec_res = {}
                if action_type == "OFFER_DISCOUNT":
                    tool_exec_res["discount"] = tools.offer_discount(case.case_id, discount_pct)
                    tool_exec_res["message"] = tools.send_message(case.case_id, channel, template_id, msg_vars, cost_per_send)
                elif action_type == "SCHEDULE_RETRY":
                    tool_exec_res["retry"] = tools.schedule_retry(case.case_id, action_time, event.retry_cooldown_hours)
                    tool_exec_res["message"] = tools.send_message(case.case_id, channel, template_id, msg_vars, cost_per_send)
                else:
                    tool_exec_res["message"] = tools.send_message(case.case_id, channel, template_id, msg_vars, cost_per_send)

                # Record successful act in previous_attempts
                case.previous_attempts.append({
                    "attempt": case.current_attempt + 1,
                    "tool": tool,
                    "channel": channel,
                    "template_key": template_key,
                    "action_type": action_type,
                    "discount_pct": discount_pct,
                    "rejected": False,
                    "rejection_reason": None
                })

                case.current_attempt += 1
                case.loop_iterations += 1
                case.total_cost_incurred += cost_per_send
                case.current_state = CaseState.EXECUTED
                last_act_time = action_time
                sim_time = action_time + timedelta(hours=2)

                log_step(AuditStep.ACT, {
                    "approved_tool": tool,
                    "channel": channel,
                    "cost_incurred": cost_per_send,
                    "rendered_message": rendered,
                    "tool_execution": tool_exec_res,
                }, action_time)
            else:
                case.loop_iterations += 1
                sim_time = sim_time + timedelta(hours=2)

            # ---------------------------------------------------------
            # STEP 6: OBSERVE OUTCOME
            # ---------------------------------------------------------
            is_resolved = outcome.resolved if outcome else False

            if is_resolved:
                case.current_state = CaseState.RESOLVED
                case.total_recovered_amount = outcome.resolved_amount if outcome else event.amount
                tools.close_case(case.case_id, "RESOLVED", case.total_recovered_amount)
                log_step(AuditStep.OBSERVE_OUTCOME, {
                    "outcome": "RESOLVED",
                    "recovered_amount": case.total_recovered_amount,
                    "resolution_channel": outcome.resolution_channel if outcome else channel,
                }, sim_time)
                log_step(AuditStep.CLOSE, {"status": "RESOLVED", "amount": case.total_recovered_amount}, sim_time)
                break
            else:
                if case.current_attempt >= case.max_attempts or case.is_control_group:
                    case.current_state = CaseState.TERMINATED
                    tools.close_case(case.case_id, "TERMINATED", 0.0)
                    log_step(AuditStep.OBSERVE_OUTCOME, {
                        "outcome": "UNRESOLVED",
                        "status": "Max attempts exhausted or control group baseline recorded.",
                    }, sim_time)
                    log_step(AuditStep.CLOSE, {"status": "TERMINATED", "recovered": 0.0}, sim_time)
                    break
                else:
                    log_step(AuditStep.OBSERVE_OUTCOME, {
                        "outcome": "UNRESOLVED",
                        "attempts_used": case.current_attempt,
                        "action": "Proceeding to next retry iteration in bounded loop.",
                    }, sim_time)

        return case
