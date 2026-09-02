"""LLM Engine for Recover AI Revenue Recovery Agent.

Implements the 'LLM Proposes, Guardrail Disposes' agent pattern.
Provides:
1. MockLLM: Deterministic, fast, offline mock implementing rule-based heuristics & replan logic.
2. LLMEngine: Real LLM caller using Gemini API with structured JSON output, strict schema
   validation, and automatic fallback to MockLLM on validation/network failures.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple, List

ALLOWED_TOOLS = ["send_message", "schedule_retry", "offer_discount"]
ALLOWED_CHANNELS = ["WhatsApp", "SMS", "Email"]
ALLOWED_TEMPLATES = [
    "PAYMENT_RETRY",
    "CARD_EXPIRED",
    "INSUFFICIENT_FUNDS",
    "CART_DISCOUNT",
    "CART_REMINDER",
]
ALLOWED_ACTIONS = ["SEND_MESSAGE", "SCHEDULE_RETRY", "OFFER_DISCOUNT"]
ALLOWED_DISCOUNTS = [0, 0.0, 10, 10.0, 15, 15.0]

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "tool": {"type": "string", "enum": ["send_message", "schedule_retry", "offer_discount"]},
        "channel": {"type": "string", "enum": ["WhatsApp", "SMS", "Email"]},
        "template_key": {"type": "string", "enum": [
            "PAYMENT_RETRY", "CARD_EXPIRED", "INSUFFICIENT_FUNDS",
            "CART_DISCOUNT", "CART_REMINDER"
        ]},
        "discount_pct": {"type": "number", "enum": [0, 10, 15]},
        "action_type": {"type": "string", "enum": ["SEND_MESSAGE", "SCHEDULE_RETRY", "OFFER_DISCOUNT"]},
        "reasoning": {"type": "string"}
    },
    "required": ["tool", "channel", "template_key", "discount_pct", "action_type", "reasoning"]
}

SYSTEM_PROMPT = """You are Recover AI, an autonomous financial revenue recovery agent for an e-commerce & fintech platform.
Your objective is to analyze payment failures and cart drop-offs, conduct Chain-of-Thought reasoning, and propose a bounded recovery action.

CRITICAL BOUNDED ACTION SPACE:
1. You may ONLY choose among the allowed tools, channels, templates, action types, and discount percentages.
2. DO NOT generate free-form customer messages, financial commitments, or unapproved discounts. Message text is rendered via fixed pre-approved templates.
3. If previous attempts failed or guardrails rejected a prior proposal, adapt your strategy (e.g. switch channel if DND blocked WhatsApp/SMS, or switch to a non-intrusive template).

Allowed Values:
- tool: "send_message" | "schedule_retry" | "offer_discount"
- channel: "WhatsApp" | "SMS" | "Email"
- template_key: "PAYMENT_RETRY" | "CARD_EXPIRED" | "INSUFFICIENT_FUNDS" | "CART_DISCOUNT" | "CART_REMINDER"
- discount_pct: 0 | 10 | 15
- action_type: "SEND_MESSAGE" | "SCHEDULE_RETRY" | "OFFER_DISCOUNT"
- reasoning: 2-4 plain language sentences explaining your diagnosis, interpretation of ML recovery likelihood, and rationale for tool/channel selection.

You MUST return ONLY valid JSON matching this exact schema:
{
  "tool": "send_message" | "schedule_retry" | "offer_discount",
  "channel": "WhatsApp" | "SMS" | "Email",
  "template_key": "PAYMENT_RETRY" | "CARD_EXPIRED" | "INSUFFICIENT_FUNDS" | "CART_DISCOUNT" | "CART_REMINDER",
  "discount_pct": 0,
  "action_type": "SEND_MESSAGE" | "SCHEDULE_RETRY" | "OFFER_DISCOUNT",
  "reasoning": "2-4 plain sentences explaining why this tool, channel, and template were chosen."
}
"""


def validate_plan_schema(data: Any) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """Validates raw parsed dictionary against strict bounded plan schema.
    
    Returns:
        (is_valid, error_reason, clean_plan_dict)
    """
    if not isinstance(data, dict):
        return False, "Response is not a JSON object", None

    required_keys = ["tool", "channel", "template_key", "discount_pct", "action_type", "reasoning"]
    for k in required_keys:
        if k not in data:
            return False, f"Missing required field: '{k}'", None

    tool = str(data["tool"]).strip()
    if tool not in ALLOWED_TOOLS:
        return False, f"Invalid tool '{tool}'. Allowed: {ALLOWED_TOOLS}", None

    channel = str(data["channel"]).strip()
    if channel not in ALLOWED_CHANNELS:
        return False, f"Invalid channel '{channel}'. Allowed: {ALLOWED_CHANNELS}", None

    template_key = str(data["template_key"]).strip()
    if template_key not in ALLOWED_TEMPLATES:
        return False, f"Invalid template_key '{template_key}'. Allowed: {ALLOWED_TEMPLATES}", None

    action_type = str(data["action_type"]).strip()
    if action_type not in ALLOWED_ACTIONS:
        return False, f"Invalid action_type '{action_type}'. Allowed: {ALLOWED_ACTIONS}", None

    try:
        discount_pct = float(data["discount_pct"])
    except (ValueError, TypeError):
        return False, f"discount_pct '{data['discount_pct']}' is not a valid number", None

    if discount_pct not in ALLOWED_DISCOUNTS:
        return False, f"Invalid discount_pct {discount_pct}. Allowed: {ALLOWED_DISCOUNTS}", None

    reasoning = str(data["reasoning"]).strip()
    if not reasoning or len(reasoning) < 5:
        return False, "reasoning must be a non-empty descriptive string", None

    clean_plan = {
        "tool": tool,
        "channel": channel,
        "template_key": template_key,
        "discount_pct": discount_pct,
        "action_type": action_type,
        "reasoning": reasoning,
    }
    return True, None, clean_plan


class MockLLM:
    """Deterministic Mock LLM implementing dynamic probability & LTV synthesis and replan logic."""

    def reason_and_plan(
        self,
        observation: Dict[str, Any],
        previous_rejections: Optional[Any] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """Generates a dynamic plan and Chain-of-Thought synthesizing probability, LTV, and history."""
        decline_code = observation.get("decline_code", "UNKNOWN")
        segment = observation.get("segment", "Medium")
        ltv = float(observation.get("ltv", 0.0))
        whatsapp_consent = bool(observation.get("whatsapp_consent", False))
        event_type = observation.get("event_type", "UPI_PAYMENT_FAIL")
        attempt = int(observation.get("current_attempt", observation.get("attempt_number", 0)))
        rec_prob = float(observation.get("recovery_probability", 0.5))
        prev_attempts = observation.get("previous_attempts", [])

        # Handle Replan loop if previous proposal was vetoed by guardrails
        if previous_rejections:
            err_upper = str(previous_rejections).upper()
            if any(k in err_upper for k in ["DND", "WINDOW", "CONSENT", "COOLDOWN", "RULE 5", "RULE 6"]):
                reasoning = (
                    f"GUARDRAIL INTERCEPTION: Previous action blocked due to '{previous_rejections}'. "
                    f"DYNAMIC REPLANNING: Switching channel to Email (24/7 compliant, unaffected by telecom DND curfew) "
                    f"to ensure non-intrusive payment recovery."
                )
                plan = {
                    "tool": "send_message",
                    "channel": "Email",
                    "template_key": "PAYMENT_RETRY" if "PAYMENT" in event_type else "CART_REMINDER",
                    "discount_pct": 0.0,
                    "action_type": "SEND_MESSAGE",
                    "reasoning": reasoning,
                    "_engine_mode": "mock",
                    "_raw_response": None,
                }
                return reasoning, plan
            else:
                reasoning = (
                    f"GUARDRAIL INTERCEPTION: Previous plan blocked due to '{previous_rejections}'. "
                    f"DYNAMIC REPLANNING: Escalating case to human customer support specialist."
                )
                plan = {
                    "tool": "send_message",
                    "channel": "Email",
                    "template_key": "PAYMENT_RETRY",
                    "discount_pct": 0.0,
                    "action_type": "SEND_MESSAGE",
                    "reasoning": reasoning,
                    "_engine_mode": "mock",
                    "_raw_response": None,
                }
                return reasoning, plan

        # Dynamic Strategy Synthesis (Probability + LTV + Segment + Attempt History)
        # 1. Low Recovery Likelihood (< 0.3) -> Lean towards Discount Incentive or Escalation
        if rec_prob < 0.3:
            if ltv >= 5000 and attempt >= 2:
                channel = "Email"
                tool = "send_message"
                action_type = "SEND_MESSAGE"
                template_key = "PAYMENT_RETRY"
                discount_pct = 0.0
                reasoning = (
                    f"Low recovery likelihood ({rec_prob:.1%}) for high-value customer (LTV: ₹{ltv:,.2f}, Segment: {segment}). "
                    f"Prior automated attempts ({len(prev_attempts)}) did not convert. "
                    f"Synthesizing strategy: escalating to VIP human ops desk to prevent customer churn."
                )
            else:
                channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else ("Email" if segment == "Medium" else "SMS")
                tool = "offer_discount"
                action_type = "OFFER_DISCOUNT"
                template_key = "CART_DISCOUNT" if "CART" in event_type else "PAYMENT_RETRY"
                discount_pct = 10.0
                reasoning = (
                    f"Low ML recovery probability ({rec_prob:.1%}) detected on {event_type} ({decline_code}, LTV: ₹{ltv:,.2f}). "
                    f"Standard passive reminders have low conversion elasticity. "
                    f"Proposing 10% incentive coupon via {channel} to overcome friction."
                )

        # 2. High Recovery Likelihood (> 0.7) -> Immediate automated cooldown retry
        elif rec_prob > 0.7:
            channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else "SMS"
            tool = "schedule_retry"
            action_type = "SCHEDULE_RETRY"
            template_key = "PAYMENT_RETRY"
            discount_pct = 0.0
            reasoning = (
                f"High ML recovery likelihood ({rec_prob:.1%}) for {segment} segment customer (LTV: ₹{ltv:,.2f}). "
                f"Diagnosed transient issue ({decline_code}); scheduling immediate cooldown gateway retry with reassuring {channel} alert."
            )

        # 3. Moderate Likelihood (0.3 <= prob <= 0.7) -> Targeted notification & instrument update
        else:
            channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else ("SMS" if segment == "Low" else "Email")
            if decline_code == "CARD_EXPIRED":
                tool = "send_message"
                action_type = "SEND_MESSAGE"
                template_key = "CARD_EXPIRED"
                discount_pct = 0.0
                reasoning = (
                    f"Customer card expired with moderate recovery likelihood ({rec_prob:.1%}). "
                    f"Automated retries will bounce. Sending secure card update link via {channel}."
                )
            elif decline_code == "INSUFFICIENT_FUNDS":
                tool = "schedule_retry"
                action_type = "SCHEDULE_RETRY"
                template_key = "INSUFFICIENT_FUNDS"
                discount_pct = 0.0
                reasoning = (
                    f"Insufficient balance diagnosed (ML score: {rec_prob:.1%}). "
                    f"Scheduling delayed retry window paired with discreet balance notification via {channel}."
                )
            elif "CART" in event_type or decline_code == "HIGH_SHIPPING_COST":
                tool = "offer_discount" if attempt >= 1 else "send_message"
                action_type = "OFFER_DISCOUNT" if attempt >= 1 else "SEND_MESSAGE"
                template_key = "CART_DISCOUNT" if attempt >= 1 else "CART_REMINDER"
                discount_pct = 10.0 if attempt >= 1 else 0.0
                reasoning = (
                    f"Moderate recovery likelihood ({rec_prob:.1%}) on checkout drop-off (Attempt #{attempt + 1}). "
                    f"Dispatching targeted {channel} reminder{' with 10% discount incentive' if discount_pct > 0 else ''}."
                )
            else:
                tool = "send_message"
                action_type = "SEND_MESSAGE"
                template_key = "PAYMENT_RETRY"
                discount_pct = 0.0
                reasoning = (
                    f"Event '{event_type}' ({decline_code}) with recovery probability {rec_prob:.1%}. "
                    f"Proposing instant payment recovery link via {channel}."
                )

        plan = {
            "tool": tool,
            "channel": channel,
            "template_key": template_key,
            "discount_pct": discount_pct,
            "action_type": action_type,
            "reasoning": reasoning,
            "_engine_mode": "mock",
            "_raw_response": None,
        }
        return reasoning, plan


class LLMEngine:
    """Real LLM Engine with Google Gemini API structured output and strict guardrail bounds.
    
    Validates output against PLAN_SCHEMA and falls back seamlessly to MockLLM on any error.
    """

    def __init__(
        self,
        model_name: str = "gemini-2.0-flash",
        api_key: Optional[str] = None,
        timeout_sec: float = 8.0,
    ):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        self.model_name = model_name
        self.timeout_sec = timeout_sec
        self.mock_fallback = MockLLM()

    def _build_prompt(self, obs: Dict[str, Any], rejections: Optional[Any] = None) -> str:
        """Builds concise, rich prompt with observation attributes and previous rejection feedback."""
        history_note = ""
        if rejections:
            history_note = f"\nPrevious plan was rejected by guardrails: {rejections}. Choose a compliant alternative."

        prev_attempts_str = ""
        prev_attempts = obs.get("previous_attempts", [])
        if prev_attempts:
            prev_attempts_str = f"\nPrevious attempt history: {json.dumps(prev_attempts)}"

        rec_prob_val = obs.get("recovery_probability", 0.5)
        try:
            rec_prob_float = float(rec_prob_val)
        except (ValueError, TypeError):
            rec_prob_float = 0.5

        return f"""You are selecting a recovery action for a failed payment or abandoned cart.
Customer segment: {obs.get('segment', 'Medium')}, LTV: {obs.get('ltv', 0)}, decline_code: {obs.get('decline_code', 'UNKNOWN')},
attempt: {obs.get('current_attempt', 0)}, event_type: {obs.get('event_type', 'UPI_PAYMENT_FAIL')},
recovery_probability (ML model): {rec_prob_float:.2f},
whatsapp_consent: {obs.get('whatsapp_consent', False)}.{history_note}{prev_attempts_str}
Pick the best tool, channel, template, and discount from the allowed options. Explain your reasoning briefly."""

    def _validate(self, plan: Dict[str, Any]) -> None:
        """Hard assertion check on plan keys and enums (fail-closed defense in depth)."""
        assert isinstance(plan, dict), "Plan must be a dictionary"
        assert plan.get("tool") in ALLOWED_TOOLS, f"Invalid tool: {plan.get('tool')}"
        assert plan.get("channel") in ALLOWED_CHANNELS, f"Invalid channel: {plan.get('channel')}"
        assert plan.get("template_key") in ALLOWED_TEMPLATES, f"Invalid template_key: {plan.get('template_key')}"
        assert plan.get("action_type") in ALLOWED_ACTIONS, f"Invalid action_type: {plan.get('action_type')}"
        assert float(plan.get("discount_pct", -1)) in ALLOWED_DISCOUNTS, f"Invalid discount_pct: {plan.get('discount_pct')}"
        assert "reasoning" in plan and len(str(plan["reasoning"]).strip()) > 0, "Missing reasoning"

    def _call_gemini_api(self, prompt: str) -> Optional[str]:
        """Calls Gemini API using google.generativeai SDK or direct REST fallback."""
        if not self.api_key:
            return None

        # 1. Try google.generativeai SDK
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            try:
                model = genai.GenerativeModel(
                    self.model_name,
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={
                        "response_mime_type": "application/json",
                        "response_schema": PLAN_SCHEMA
                    }
                )
            except Exception:
                model = genai.GenerativeModel(
                    self.model_name,
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={"response_mime_type": "application/json"}
                )
            response = model.generate_content(prompt)
            return response.text
        except ImportError:
            pass
        except Exception as e:
            print(f"[LLMEngine] google.generativeai SDK call failed: {e}")

        # 2. REST API Fallback
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent?key={self.api_key}"
            req_data = {
                "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{prompt}"}]}],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "response_schema": PLAN_SCHEMA
                }
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(req_data).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as response:
                res_body = json.loads(response.read().decode("utf-8"))
                return res_body["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            print(f"[LLMEngine] Gemini REST API call failed: {e}")
            return None

    def reason_and_plan(
        self,
        observation: Dict[str, Any],
        previous_rejections: Optional[Any] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """Executes LLM reasoning and planning with fallback safety."""
        prompt = self._build_prompt(observation, previous_rejections)

        raw_response_text = None
        parsed_data = None

        if self.api_key:
            try:
                raw_response_text = self._call_gemini_api(prompt)
                if raw_response_text:
                    parsed_data = json.loads(raw_response_text)
                    self._validate(parsed_data)
            except Exception as e:
                print(f"[LLMEngine] Gemini call/validation failed: {e}. Falling back to deterministic logic.")
                parsed_data = None

        # Validate against schema and clean
        if parsed_data is not None:
            is_valid, err_msg, clean_plan = validate_plan_schema(parsed_data)
            if is_valid and clean_plan:
                clean_plan["_engine_mode"] = "llm"
                clean_plan["_raw_response"] = parsed_data
                reasoning = clean_plan.get("reasoning", "")
                return reasoning, clean_plan

        # Fail-closed fallback to deterministic MockLLM
        fallback_reasoning, fallback_plan = self.mock_fallback.reason_and_plan(observation, previous_rejections)
        fallback_plan["_engine_mode"] = "fallback"
        fallback_plan["_raw_response"] = raw_response_text or {
            "status": "FALLBACK_TRIGGERED",
            "reason": "API call or schema validation failed, using safe deterministic plan."
        }
        return fallback_reasoning, fallback_plan
