"""LLM Agent Module for Recover AI Revenue Recovery Agent.

Implements the 'LLM Proposes, Guardrail Disposes' pattern.
Provides dynamic Chain-of-Thought (CoT) reasoning synthesizing recovery_probability,
LTV, customer segment, decline codes, attempt history, and customer reply outcomes.

Supports:
1. Groq (llama-3.3-70b-versatile) via SDK or REST API with response_format={"type": "json_object"}.
2. Google Gemini (gemini-2.0-flash / gemini-1.5-flash) via SDK or REST API with JSON response format.
3. Realistic dynamic local ReAct CoT generator when running in simulated/offline mode.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple

# Toggle to True to enable real external LLM calls (Groq or Gemini)
USE_REAL_LLM = os.getenv("USE_REAL_LLM", "false").lower() == "true" or os.getenv("LLM_MODE", "mock").lower() == "live"

# Supported Provider Keys
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")

SYSTEM_PROMPT = """You are Recover AI, an autonomous financial revenue recovery agent for an e-commerce & fintech platform.
Your objective is to analyze payment failures and cart drop-offs, conduct Chain-of-Thought reasoning, and propose a bounded recovery tool action.

Available tools:
1. 'schedule_retry': Schedules automated gateway retry with notification. (tool_args: channel, template_key, discount_pct: 0.0)
2. 'send_message': Sends a customer notification with recovery link. (tool_args: channel, template_key, discount_pct: 0.0)
3. 'offer_discount': Offers a maximum 10% incentive coupon to recover drop-offs. (tool_args: channel, template_key, discount_pct: 10.0)
4. 'escalate_to_human': Flags complex or high-risk cases for human intervention. (tool_args: channel: 'Email', template_key: 'PAYMENT_RETRY', discount_pct: 0.0)

Channels: 'WhatsApp', 'SMS', 'Email'
Templates: 'PAYMENT_RETRY', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'CART_DISCOUNT', 'CART_REMINDER'

CRITICAL: Return ONLY valid JSON matching this schema:
{
  "thought": "Chain of thought reasoning synthesizing ML recovery probability, customer LTV, decline diagnosis, attempt history, and outcome feedback...",
  "tool_name": "schedule_retry" | "send_message" | "offer_discount" | "escalate_to_human",
  "tool_args": {
    "channel": "WhatsApp" | "SMS" | "Email",
    "template_key": "PAYMENT_RETRY" | "INSUFFICIENT_FUNDS" | "CARD_EXPIRED" | "CART_DISCOUNT" | "CART_REMINDER",
    "discount_pct": 0.0,
    "action_type": "SEND_MESSAGE" | "SCHEDULE_RETRY" | "OFFER_DISCOUNT" | "ESCALATE"
  }
}"""


def call_real_llm(
    context: Dict[str, Any],
    diagnosis: Dict[str, str],
    recovery_prob: float,
    previous_error: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Calls Groq or Gemini API with structured JSON output."""
    groq_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or GEMINI_API_KEY

    user_payload = {
        "event_context": context,
        "decline_diagnosis": diagnosis,
        "ml_recovery_probability": round(recovery_prob, 4),
        "previous_guardrail_rejection": previous_error or "None",
        "previous_attempts": context.get("previous_attempts", []),
        "customer_reply": context.get("customer_reply", None),
    }
    user_prompt = f"Case Information:\n{json.dumps(user_payload, indent=2)}\n\nAnalyze this case and output your structured JSON plan:"

    # 1. Try Groq (llama-3.3-70b-versatile) with response_format json_object
    if groq_key:
        try:
            try:
                from groq import Groq
                client = Groq(api_key=groq_key)
                completion = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.2,
                )
                return json.loads(completion.choices[0].message.content)
            except ImportError:
                url = "https://api.groq.com/openai/v1/chat/completions"
                req_data = {
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2
                }
                req = urllib.request.Request(
                    url,
                    data=json.dumps(req_data).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {groq_key}"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    res_body = json.loads(response.read().decode("utf-8"))
                    content = res_body["choices"][0]["message"]["content"]
                    return json.loads(content)
        except Exception as e:
            print(f"[Recover LLM] Groq API call error: {e}")

    # 2. Try Gemini (gemini-2.0-flash / gemini-1.5-flash)
    if gemini_key:
        try:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_key)
                model = genai.GenerativeModel(
                    "gemini-2.0-flash",
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={"response_mime_type": "application/json"}
                )
                response = model.generate_content(user_prompt)
                return json.loads(response.text)
            except Exception:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
                req_data = {
                    "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_prompt}"}]}],
                    "generationConfig": {"response_mime_type": "application/json"}
                }
                req = urllib.request.Request(
                    url,
                    data=json.dumps(req_data).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    res_body = json.loads(response.read().decode("utf-8"))
                    text = res_body["candidates"][0]["content"]["parts"][0]["text"]
                    return json.loads(text)
        except Exception as e:
            print(f"[Recover LLM] Gemini API call error: {e}")

    return None


def generate_agent_plan(
    context: Dict[str, Any],
    diagnosis: Dict[str, str],
    recovery_prob: float,
    previous_error: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates an autonomous ReAct recovery plan.
    Synthesizes recovery_probability, LTV, segment, attempt history, and customer reply intent.
    """
    # 1. Check if live external LLM should be used
    if USE_REAL_LLM or os.getenv("LLM_MODE", "mock").lower() == "live":
        real_plan = call_real_llm(context, diagnosis, recovery_prob, previous_error)
        if real_plan and "thought" in real_plan and "tool_name" in real_plan:
            tool_args = real_plan.get("tool_args", {})
            action_type_map = {
                "schedule_retry": "SCHEDULE_RETRY",
                "send_message": "SEND_MESSAGE",
                "offer_discount": "OFFER_DISCOUNT",
                "escalate_to_human": "ESCALATE",
            }
            tool_args.setdefault("action_type", action_type_map.get(real_plan["tool_name"], "SEND_MESSAGE"))
            real_plan["tool_args"] = tool_args
            return real_plan

    # 2. Dynamic Reasoning Engine (Outcome-Aware & Probability Synthesizing)
    decline_code = context.get("decline_code", "UNKNOWN")
    segment = context.get("segment", "Medium")
    ltv = float(context.get("ltv", 0.0))
    whatsapp_consent = bool(context.get("whatsapp_consent", False))
    event_type = context.get("event_type", "UPI_PAYMENT_FAIL")
    attempt = int(context.get("attempt_number", context.get("current_attempt", 0)))
    customer_reply = context.get("customer_reply")
    prev_attempts = context.get("previous_attempts", [])

    # Re-planning on Guardrail Veto
    if previous_error:
        err_upper = str(previous_error).upper()
        if any(k in err_upper for k in ["DND", "WINDOW", "CONSENT", "COOLDOWN", "RULE 5", "RULE 6"]):
            channel = "Email"
            thought = (
                f"GUARDRAIL INTERCEPTION: Previous action blocked due to '{previous_error}'. "
                f"DYNAMIC REPLANNING: Switching channel from WhatsApp/SMS to Email (24/7 compliant, unaffected by telecom DND curfew) "
                f"to ensure immediate and non-intrusive payment recovery."
            )
            tool_name = "send_message"
            template_key = "PAYMENT_RETRY" if "PAYMENT" in event_type else "CART_REMINDER"
            action_type = "SEND_MESSAGE"
            discount_pct = 0.0
        else:
            channel = "Email"
            thought = (
                f"GUARDRAIL INTERCEPTION: Previous plan blocked due to '{previous_error}'. "
                f"DYNAMIC REPLANNING: Initiating safe fallback protocol by escalating this case to human customer support specialist."
            )
            tool_name = "escalate_to_human"
            template_key = "PAYMENT_RETRY"
            action_type = "ESCALATE"
            discount_pct = 0.0

        return {
            "thought": thought,
            "tool_name": tool_name,
            "tool_args": {
                "channel": channel,
                "template_key": template_key,
                "action_type": action_type,
                "discount_pct": discount_pct
            }
        }

    # Dynamic Strategy Synthesis based on ML likelihood, LTV, segment, and history:
    # -------------------------------------------------------------------------
    # Case A: Low Recovery Likelihood (< 0.3) -> Lean towards Discount Incentive or Escalation
    # -------------------------------------------------------------------------
    if recovery_prob < 0.3:
        if ltv >= 5000 and attempt >= 2:
            channel = "Email"
            tool_name = "escalate_to_human"
            template_key = "PAYMENT_RETRY"
            action_type = "ESCALATE"
            discount_pct = 0.0
            thought = (
                f"Low recovery probability ({recovery_prob:.1%}) for high-value customer (LTV: ₹{ltv:,.2f}, Segment: {segment}). "
                f"Prior automated attempts ({len(prev_attempts)}) did not convert. "
                f"Synthesizing strategy: escalating to VIP human ops desk to prevent customer churn."
            )
        else:
            channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else ("Email" if segment == "Medium" else "SMS")
            tool_name = "offer_discount"
            template_key = "CART_DISCOUNT" if "CART" in event_type else "PAYMENT_RETRY"
            action_type = "OFFER_DISCOUNT"
            discount_pct = 10.0
            thought = (
                f"Low ML recovery probability ({recovery_prob:.1%}) on {event_type} ({decline_code}, LTV: ₹{ltv:,.2f}). "
                f"Standard passive reminders have low conversion elasticity. "
                f"Proposing 10% incentive coupon via {channel} to overcome friction."
            )

    # -------------------------------------------------------------------------
    # Case B: High Recovery Likelihood (> 0.7) -> Immediate automated cooldown retry
    # -------------------------------------------------------------------------
    elif recovery_prob > 0.7:
        channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else "SMS"
        tool_name = "schedule_retry"
        template_key = "PAYMENT_RETRY"
        action_type = "SCHEDULE_RETRY"
        discount_pct = 0.0
        thought = (
            f"High ML recovery likelihood ({recovery_prob:.1%}) for {segment} segment customer (LTV: ₹{ltv:,.2f}). "
            f"Diagnosed transient issue ({decline_code}); scheduling immediate cooldown gateway retry with reassuring {channel} alert."
        )

    # -------------------------------------------------------------------------
    # Case C: Moderate Likelihood (0.3 <= prob <= 0.7) -> Targeted notification & instrument update
    # -------------------------------------------------------------------------
    else:
        channel = "WhatsApp" if (segment == "High" and whatsapp_consent) else ("SMS" if segment == "Low" else "Email")
        if decline_code == "CARD_EXPIRED":
            tool_name = "send_message"
            template_key = "CARD_EXPIRED"
            action_type = "SEND_MESSAGE"
            discount_pct = 0.0
            thought = (
                f"Customer card expired with moderate recovery likelihood ({recovery_prob:.1%}). "
                f"Automated retries will bounce. Sending secure card update link via {channel}."
            )
        elif decline_code == "INSUFFICIENT_FUNDS":
            tool_name = "schedule_retry"
            template_key = "INSUFFICIENT_FUNDS"
            action_type = "SCHEDULE_RETRY"
            discount_pct = 0.0
            thought = (
                f"Insufficient balance diagnosed (ML score: {recovery_prob:.1%}). "
                f"Scheduling delayed retry window paired with discreet balance notification via {channel}."
            )
        elif "CART" in event_type or decline_code == "HIGH_SHIPPING_COST":
            tool_name = "offer_discount" if attempt >= 1 else "send_message"
            template_key = "CART_DISCOUNT" if attempt >= 1 else "CART_REMINDER"
            action_type = "OFFER_DISCOUNT" if attempt >= 1 else "SEND_MESSAGE"
            discount_pct = 10.0 if attempt >= 1 else 0.0
            thought = (
                f"Moderate recovery likelihood ({recovery_prob:.1%}) on checkout drop-off (Attempt #{attempt + 1}). "
                f"Dispatching targeted {channel} reminder{' with 10% discount incentive' if discount_pct > 0 else ''}."
            )
        else:
            tool_name = "send_message"
            template_key = "PAYMENT_RETRY"
            action_type = "SEND_MESSAGE"
            discount_pct = 0.0
            thought = (
                f"Event '{event_type}' ({decline_code}) with recovery probability {recovery_prob:.1%}. "
                f"Proposing instant payment recovery link via {channel}."
            )

    return {
        "thought": thought,
        "tool_name": tool_name,
        "tool_args": {
            "channel": channel,
            "template_key": template_key,
            "action_type": action_type,
            "discount_pct": discount_pct
        }
    }

