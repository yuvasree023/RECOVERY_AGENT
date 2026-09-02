import crypto from 'crypto';

export const CHANNEL_COSTS: Record<string, number> = {
  WhatsApp: 0.35,
  SMS: 0.15,
  Email: 0.05
};

export const MAX_DISCOUNT_PERCENT = 10.0;

export function scheduleRetry(caseId: string, retryTime: Date, cooldownHours: number) {
  return {
    status: 'SCHEDULED',
    case_id: caseId,
    scheduled_for: retryTime.toISOString(),
    cooldown_hours: cooldownHours,
    reference_id: `RETRY_${crypto.randomUUID().substring(0, 8).toUpperCase()}`
  };
}

export function sendMessage(
  caseId: string,
  channel: string,
  templateId: string,
  variables: Record<string, any>,
  costOverride?: number
) {
  const cost = costOverride !== undefined ? costOverride : (CHANNEL_COSTS[channel] || 0.05);
  const msgId = `MSG_${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

  return {
    status: 'SENT',
    message_id: msgId,
    case_id: caseId,
    channel,
    template_id: templateId,
    cost_incurred: cost,
    variables,
    timestamp: new Date().toISOString()
  };
}

export function offerDiscount(caseId: string, pct: number) {
  const effectivePct = Math.min(Number(pct), MAX_DISCOUNT_PERCENT);
  const couponCode = `RECOVER${Math.floor(effectivePct)}`;

  return {
    status: 'OFFERED',
    case_id: caseId,
    requested_pct: pct,
    applied_pct: effectivePct,
    coupon_code: couponCode,
    expires_in_hours: 24
  };
}

export function escalateToHuman(caseId: string, reason: string) {
  const ticketId = `TICK_${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
  return {
    status: 'ESCALATED',
    case_id: caseId,
    ticket_id: ticketId,
    reason,
    timestamp: new Date().toISOString()
  };
}

export function closeCase(caseId: string, outcome: string, recoveredAmount: number = 0) {
  return {
    status: 'CLOSED',
    case_id: caseId,
    final_state: outcome,
    recovered_amount: recoveredAmount,
    closed_at: new Date().toISOString()
  };
}
