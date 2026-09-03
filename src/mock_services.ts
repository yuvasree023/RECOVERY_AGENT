import crypto from 'crypto';

export const CHANNEL_COSTS: Record<string, number> = {
  WhatsApp: 0.35,
  SMS: 0.15,
  Email: 0.05
};

export const MAX_DISCOUNT_PERCENT = 10.0;

/**
 * Payment Gateway Simulator (Production API Surface)
 * Simulates asynchronous gateway processing, status checks, and realistic failure codes.
 */
export function schedulePaymentRetry(
  caseId: string,
  retryTime: Date,
  cooldownHours: number = 2,
  options?: { channel?: string; amount?: number; simulatedFailure?: string }
) {
  const retryId = `RET-${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
  const gwRef = `gw_tx_${crypto.randomUUID().substring(0, 10)}`;

  let status: 'SCHEDULED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'DECLINED' = 'SCHEDULED';
  let reason: string | null = null;

  if (options?.simulatedFailure) {
    status = 'FAILED';
    reason = options.simulatedFailure;
  }

  return {
    status,
    retry_id: retryId,
    gateway_reference: gwRef,
    case_id: caseId,
    scheduled_for: retryTime.toISOString(),
    cooldown_hours: cooldownHours,
    channel_used: options?.channel || 'API_GATEWAY',
    amount: options?.amount || 0.0,
    reason,
    timestamp: new Date().toISOString(),
    is_simulation: true
  };
}

// Backward compatibility alias
export const scheduleRetry = schedulePaymentRetry;

/**
 * Omni-Channel Messaging Simulator (Production API Surface)
 * Simulates WhatsApp Business API, Twilio SMS, and SendGrid/SES Email.
 */
export function sendRecoveryMessage(
  caseId: string,
  channel: string,
  templateId: string,
  variables: Record<string, any>,
  costOverride?: number
) {
  const cost = costOverride !== undefined ? costOverride : (CHANNEL_COSTS[channel] || 0.05);
  const msgId = `MSG-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

  return {
    status: 'SENT',
    delivery_status: 'DELIVERED',
    message_id: msgId,
    case_id: caseId,
    channel,
    template_id: templateId,
    cost_incurred: cost,
    variables,
    timestamp: new Date().toISOString(),
    is_simulation: true
  };
}

// Backward compatibility alias
export const sendMessage = sendRecoveryMessage;

/**
 * Dynamic Incentive / Discount Coupon Simulator (Production API Surface)
 * Generates bound single-use recovery coupons with expiry.
 */
export function offerRecoveryDiscount(caseId: string, pct: number) {
  const effectivePct = Math.min(Math.max(0, Number(pct) || 0), MAX_DISCOUNT_PERCENT);
  const couponId = `REC-${Math.floor(effectivePct)}-${crypto.randomUUID().substring(0, 4).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  return {
    status: 'CREATED',
    coupon_id: couponId,
    coupon_code: `RECOVER${Math.floor(effectivePct)}`,
    case_id: caseId,
    requested_pct: pct,
    discount_percent: effectivePct,
    expires_at: expiresAt,
    is_simulation: true
  };
}

// Backward compatibility alias
export const offerDiscount = offerRecoveryDiscount;

/**
 * Human Escalation Simulator (Production API Surface)
 * Routes complex cases, disputes, and VIPs to human operations queues.
 */
export function escalateToHuman(caseId: string, reason: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH') {
  const escId = `ESC-${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
  return {
    status: 'QUEUED',
    escalation_id: escId,
    case_id: caseId,
    priority,
    reason,
    assigned_queue: 'VIP_REVENUE_OPS_DESK',
    sla_minutes: priority === 'HIGH' ? 30 : 120,
    timestamp: new Date().toISOString(),
    is_simulation: true
  };
}

/**
 * Case Closure Tool (Production API Surface)
 */
export function closeCase(
  caseId: string,
  outcome: string,
  recoveredAmount: number = 0,
  reason?: string
) {
  return {
    status: 'CLOSED',
    case_id: caseId,
    final_state: outcome,
    recovered_amount: recoveredAmount,
    reason: reason || `Case reached terminal state: ${outcome}`,
    closed_at: new Date().toISOString(),
    is_simulation: true
  };
}

/**
 * Payment Status Inspector Tool (Production API Surface)
 */
export function checkPaymentStatus(caseId: string, isResolved: boolean = false, amount: number = 0) {
  return {
    case_id: caseId,
    status: isResolved ? 'PAID' : 'UNPAID',
    resolved_amount: isResolved ? amount : 0,
    currency: 'INR',
    last_verified_at: new Date().toISOString(),
    is_simulation: true
  };
}

/**
 * Checkout Drop-off Status Inspector Tool (Production API Surface)
 */
export function checkCheckoutStatus(caseId: string, isConverted: boolean = false, cartValue: number = 0) {
  return {
    case_id: caseId,
    status: isConverted ? 'COMPLETED' : 'ABANDONED',
    cart_value: cartValue,
    time_since_abandonment_minutes: 35,
    last_verified_at: new Date().toISOString(),
    is_simulation: true
  };
}

/**
 * B2B Promise-to-Pay (PTP) Commitment Logger Tool (Production API Surface)
 * Records commercial payment commitment, temporarily pausing aggressive dunning.
 */
export function logPromiseToPay(
  caseId: string,
  ptpDate: string,
  agreedAmount?: number,
  notes?: string
) {
  const ptpId = `PTP-${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
  return {
    status: 'PTP_RECORDED',
    ptp_id: ptpId,
    case_id: caseId,
    promised_date: ptpDate,
    agreed_amount: agreedAmount || 0,
    dunning_paused: true,
    notes: notes || 'Customer committed to settle invoice by promised date.',
    timestamp: new Date().toISOString(),
    is_simulation: true
  };
}

/**
 * B2B Invoice Receivable Inspector Tool (Production API Surface)
 */
export function checkInvoiceStatus(
  caseId: string,
  invoiceId?: string,
  isPaid: boolean = false,
  amount: number = 0,
  ptpDate?: string | null
) {
  return {
    case_id: caseId,
    invoice_id: invoiceId || `INV-${caseId.slice(-6)}`,
    status: isPaid ? 'PAID' : 'OVERDUE',
    settled_amount: isPaid ? amount : 0,
    ptp_status: ptpDate ? 'ACTIVE_COMMITMENT' : 'NONE',
    promised_date: ptpDate || null,
    last_verified_at: new Date().toISOString(),
    is_simulation: true
  };
}


