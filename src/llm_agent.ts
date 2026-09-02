/**
 * LLM Agent Module for Recover AI Revenue Recovery Agent.
 *
 * Implements the "LLM Proposes, Guardrail Disposes" pattern:
 * - Generates explicit Chain-of-Thought (CoT) reasoning
 * - Dynamically proposes tools and parameters
 * - Supports Replan Loop when guardrails reject a proposal
 */

export interface LLMProposal {
  thought: string;
  toolName: string;
  toolArgs: {
    channel: string;
    templateKey: string;
    actionType: string;
    discountPct: number;
  };
}

export function generateAgentPlan(
  context: {
    declineCode: string;
    segment: string;
    whatsappConsent: boolean;
    eventType: string;
    amount: number;
    attemptNumber: number;
  },
  recoveryProb: number,
  previousError?: string
): LLMProposal {
  const { declineCode, segment, whatsappConsent, eventType, attemptNumber } = context;

  // Handle Replan Loop if guardrails vetoed previous plan
  if (previousError) {
    const errUpper = previousError.toUpperCase();
    if (errUpper.includes('DND') || errUpper.includes('WINDOW') || errUpper.includes('CONSENT') || errUpper.includes('COOLDOWN')) {
      return {
        thought: `GUARDRAIL INTERCEPTION: Previous action blocked due to '${previousError}'. REPLANNING: Switching channel to Email (24/7 compliant, unaffected by telecom DND curfew) for non-intrusive recovery.`,
        toolName: 'send_message',
        toolArgs: {
          channel: 'Email',
          templateKey: eventType.includes('PAYMENT') ? 'PAYMENT_RETRY' : 'CART_REMINDER',
          actionType: 'SEND_MESSAGE',
          discountPct: 0.0
        }
      };
    } else {
      return {
        thought: `GUARDRAIL INTERCEPTION: Previous plan blocked due to '${previousError}'. REPLANNING: Escalating case to human specialist team for manual review.`,
        toolName: 'escalate_to_human',
        toolArgs: {
          channel: 'Email',
          templateKey: 'PAYMENT_RETRY',
          actionType: 'ESCALATE',
          discountPct: 0.0
        }
      };
    }
  }

  if (declineCode === 'NETWORK_TIMEOUT') {
    const channel = segment === 'High' && whatsappConsent ? 'WhatsApp' : 'SMS';
    return {
      thought: `Customer experienced a transient network glitch (${declineCode}). ML Model estimates recovery probability is ${(recoveryProb * 100).toFixed(1)}%. I should schedule an immediate retry post-cooldown and send a reassuring ${channel} message to reduce friction.`,
      toolName: 'schedule_retry',
      toolArgs: {
        channel,
        templateKey: 'PAYMENT_RETRY',
        actionType: 'SCHEDULE_RETRY',
        discountPct: 0.0
      }
    };
  }

  if (declineCode === 'HIGH_SHIPPING_COST' || (eventType === 'CART_ABANDON' && attemptNumber >= 2)) {
    const channel = segment === 'High' && whatsappConsent ? 'WhatsApp' : (segment === 'Medium' ? 'Email' : 'SMS');
    return {
      thought: `Checkout drop-off friction detected. Passive reminders will yield low conversion (${(recoveryProb * 100).toFixed(1)}%). I propose offering an approved 10% discount incentive coupon via ${channel} to recover this cart abandonment.`,
      toolName: 'offer_discount',
      toolArgs: {
        channel,
        templateKey: 'CART_DISCOUNT',
        actionType: 'OFFER_DISCOUNT',
        discountPct: 10.0
      }
    };
  }

  if (declineCode === 'CARD_EXPIRED') {
    return {
      thought: `The customer's payment card has expired. Standard automated retries will fail. I must prompt the customer to update their card details securely via Email.`,
      toolName: 'send_message',
      toolArgs: {
        channel: 'Email',
        templateKey: 'CARD_EXPIRED',
        actionType: 'SEND_MESSAGE',
        discountPct: 0.0
      }
    };
  }

  if (declineCode === 'INSUFFICIENT_FUNDS') {
    const channel = segment === 'Low' ? 'SMS' : (segment === 'High' && whatsappConsent ? 'WhatsApp' : 'Email');
    return {
      thought: `Customer lacks sufficient funds. Aggressive repeated charges cause churn. Recovery probability is ${(recoveryProb * 100).toFixed(1)}%. I will schedule a delayed retry window and dispatch a discreet payment reminder via ${channel}.`,
      toolName: 'schedule_retry',
      toolArgs: {
        channel,
        templateKey: 'INSUFFICIENT_FUNDS',
        actionType: 'SCHEDULE_RETRY',
        discountPct: 0.0
      }
    };
  }

  return {
    thought: `Detected event '${eventType}' with decline code '${declineCode}'. ML likelihood is ${(recoveryProb * 100).toFixed(1)}%. Proposing payment recovery link via Email.`,
    toolName: 'send_message',
    toolArgs: {
      channel: 'Email',
      templateKey: 'PAYMENT_RETRY',
      actionType: 'SEND_MESSAGE',
      discountPct: 0.0
    }
  };
}
