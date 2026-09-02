"""LLM Agent Module for Recover AI Revenue Recovery Agent.

Implements the 'LLM Proposes, Guardrail Disposes' pattern.
Provides autonomous Chain-of-Thought (CoT) reasoning, dynamic tool selection,
and an adaptive replan loop when guardrails reject an action proposal.

Supports:
1. Groq (llama3-70b-8192 or llama-3.3-70b-versatile) via SDK or REST API with JSON response format.
2. Google Gemini (gemini-1.5-flash) via google.generativeai or REST API with JSON response format.
3. Realistic local ReAct CoT generator when running in simulated/offline mode.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

# Toggle to True to enable real external LLM calls (Groq or Gemini)
USE_REAL_LLM = os.getenv("USE_REAL_LLM", "false").lower() == "true"

# Supported Provider Keys (NO OPENAI)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


SYSTEM_PROMPT = """You are Recover AI, an autonomous financial revenue recovery agent for an e-commerce & fintech platform.
Your objective is to analyze payment failures and cart drop-offs, conduct Chain-of-Thought reasoning, and propose a specific recovery tool action.

Available tools:
1. 'schedule_retry': Schedules automated gateway retry with notification. (tool_args: channel, template_key, discount_pct)
2. 'send_message': Sends a customer notification with recovery link. (tool_args: channel, template_key, discount_pct)
3. 'offer_discount': Offers a maximum 10% incentive coupon to recover drop-offs. (tool_args: channel, template_key, discount_pct: 10.0)
4. 'escalate_to_human': Flags complex or high-risk cases for human intervention. (tool_args: channel: 'Email', template_key: 'PAYMENT_RETRY', discount_pct: 0.0)

Channels: 'WhatsApp', 'SMS', 'Email'
Templates: 'PAYMENT_RETRY', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'CART_DISCOUNT', 'CART_REMINDER'

CRITICAL: Return ONLY valid JSON matching this schema:
{
  "thought": "Chain of thought reasoning explaining the diagnosis, ML likelihood, and rationale...",
  "tool_name": "schedule_retry" | "send_message" | "offer_discount" | "escalate_to_human",
  "tool_args": {
    "channel": "WhatsApp" | "SMS" | "Email",
    "template_key": "PAYMENT_RETRY" | "INSUFFICIENT_FUNDS" | "CARD_EXPIRED" | "CART_DISCOUNT" | "CART_REMINDER",
    "discount_pct": 0.0
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
    gemini_key = os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY

    user_payload = {
        "event_context": context,
        "decline_diagnosis": diagnosis,
        "ml_recovery_probability": round(recovery_prob, 4),
        "previous_guardrail_rejection": previous_error or "None",
    }
    user_prompt = f"Case Information:\n{json.dumps(user_payload, indent=2)}\n\nPropose your recovery action plan in valid JSON format."

    # 1. Try Groq (llama3-70b-8192 or llama-3.3-70b-versatile)
    if groq_key:
        try:
            # Check if groq SDK is available
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
                # Direct REST API invocation using standard library
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

    # 2. Try Gemini (gemini-1.5-flash)
    if gemini_key:
        try:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_key)
                model = genai.GenerativeModel(
                    "gemini-1.5-flash",
                    system_instruction=SYSTEM_PROMPT,
                    generation_config={"response_mime_type": "application/json"}
                )
                response = model.generate_content(user_prompt)
                return json.loads(response.text)
            except ImportError:
                # Direct REST API call
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
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
    Supports real LLM execution or high-fidelity simulated CoT reasoning,
    including iterative replanning when a guardrail vetoes a proposal.
    """
    # Check if live LLM should be used
    if USE_REAL_LLM:
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

    # Simulated Autonomous ReAct Engine (Zero external dependencies)
    decline_code = context.get("decline_code", "UNKNOWN")
    segment = context.get("segment", "Medium")
    whatsapp_consent = context.get("whatsapp_consent", False)
    event_type = context.get("event_type", "UPI_PAYMENT_FAIL")
    attempt = int(context.get("attempt_number", 1))

    # Handle Replan feedback if previous proposal was vetoed by guardrails
    if previous_error:
        err_upper = previous_error.upper()
        if "DND" in err_upper or "WINDOW" in err_upper or "CONSENT" in err_upper or "COOLDOWN" in err_upper:
            channel = "Email"
            thought = (
                f"GUARDRAIL INTERCEPTION: Previous action blocked due to '{previous_error}'. "
                f"REPLANNING: Switching channel from WhatsApp/SMS to Email (24/7 compliant, unaffected by telecom DND curfew) "
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
                f"REPLANNING: Initiating safe fallback protocol by escalating this case to human customer support specialist."
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

    # Standard Autonomous CoT Reasoning
    if decline_code == "NETWORK_TIMEOUT":
        channel = "WhatsApp" if segment == "High" and whatsapp_consent else "SMS"
        thought = (
            f"Customer experienced a transient network glitch ({decline_code}). "
            f"ML Model estimates recovery probability is {recovery_prob:.1%}. "
            f"I reason that an immediate gateway retry scheduled post-cooldown, paired with a reassuring {channel} notification, "
            f"will minimize friction and maximize recovery yield."
        )
        tool_name = "schedule_retry"
        template_key = "PAYMENT_RETRY"
        action_type = "SCHEDULE_RETRY"
        discount_pct = 0.0

    elif decline_code == "HIGH_SHIPPING_COST" or (event_type == "CART_ABANDON" and attempt >= 2):
        channel = "WhatsApp" if segment == "High" and whatsapp_consent else ("Email" if segment == "Medium" else "SMS")
        thought = (
            f"Checkout drop-off friction detected. "
            f"Passive reminders will yield low conversion ({recovery_prob:.1%}). "
            f"I propose offering an approved 10% discount incentive coupon via {channel} to recover this cart abandonment."
        )
        tool_name = "offer_discount"
        template_key = "CART_DISCOUNT"
        action_type = "OFFER_DISCOUNT"
        discount_pct = 10.0

    elif decline_code == "CARD_EXPIRED":
        channel = "Email"
        thought = (
            f"The customer's payment card has expired. Standard automated retries will fail. "
            f"I reason that prompting the user with a secure payment instrument update link via {channel} "
            f"is the only viable recovery path."
        )
        tool_name = "send_message"
        template_key = "CARD_EXPIRED"
        action_type = "SEND_MESSAGE"
        discount_pct = 0.0

    elif decline_code == "INSUFFICIENT_FUNDS":
        channel = "SMS" if segment == "Low" else "WhatsApp" if (segment == "High" and whatsapp_consent) else "Email"
        thought = (
            f"Customer account has insufficient funds. Aggressive repeated charges cause churn. "
            f"Recovery probability is {recovery_prob:.1%}. "
            f"I will schedule a delayed retry window and dispatch a discreet payment reminder via {channel}."
        )
        tool_name = "schedule_retry"
        template_key = "INSUFFICIENT_FUNDS"
        action_type = "SCHEDULE_RETRY"
        discount_pct = 0.0

    else:
        channel = "Email"
        thought = (
            f"Detected event '{event_type}' with status code '{decline_code}'. "
            f"ML recovery likelihood is {recovery_prob:.1%}. "
            f"Proposing general transaction retry and payment recovery link via {channel}."
        )
        tool_name = "send_message"
        template_key = "PAYMENT_RETRY"
        action_type = "SEND_MESSAGE"
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
