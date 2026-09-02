export interface Customer {
  customerId: string;
  segment: string; // 'High' | 'Medium' | 'Low'
  ltv: number;
  whatsappConsent: boolean;
  optOutStatus: boolean;
}

export interface EventRecord {
  eventId: string;
  customerId: string;
  eventType: string; // 'UPI_PAYMENT_FAIL' | 'CART_ABANDON' | 'SUBSCRIPTION_FAIL'
  amount: number;
  status: string; // 'FAILED' | 'DROPPED'
  timestamp: Date;
  declineCode: string; // 'NETWORK_TIMEOUT' | 'INSUFFICIENT_FUNDS' | 'CARD_EXPIRED' | 'HIGH_SHIPPING_COST'
  attemptNumber: number;
  fraudScore: number;
  retryCooldownHours: number;
  ptpDate: string | null;
}

export interface OutcomeRecord {
  eventId: string;
  resolved: boolean;
  resolutionChannel: string | null; // 'WhatsApp' | 'SMS' | 'Email'
  resolvedAmount: number;
  resolutionTimestamp: Date | null;
}

export interface ChannelCostRecord {
  channel: string; // 'WhatsApp' | 'SMS' | 'Email'
  costPerSend: number;
  avgResponseTimeHours: number;
  dndStart: string | null; // '21:00'
  dndEnd: string | null; // '08:00'
}

export type CaseState = 'INIT' | 'DIAGNOSED' | 'SCHEDULED' | 'EXECUTED' | 'RESOLVED' | 'TERMINATED' | 'ESCALATED';

export interface RecoveryCaseRecord {
  caseId: string;
  eventId: string;
  customerId: string;
  currentState: CaseState;
  currentAttempt: number;
  maxAttempts: number;
  loopIterations: number;
  maxLoopIterations: number;
  nextActionTime: Date | null;
  recoveryProbability: number | null;
  isControlGroup: boolean;
  totalRecoveredAmount: number;
  totalCostIncurred: number;
}

export type AuditStep = 'OBSERVE' | 'REASON' | 'PLAN' | 'GUARDRAIL_CHECK' | 'GUARDRAIL_FAIL' | 'REPLAN' | 'ACT' | 'OBSERVE_OUTCOME' | 'ESCALATE' | 'CLOSE';

export interface AuditLogRecord {
  logId: string;
  caseId: string;
  timestamp: Date;
  step: AuditStep;
  detail: any;
}

export interface GuardrailContext {
  optOutStatus: boolean;
  fraudScore: number;
  retryCooldownHours: number;
  currentAttempt: number;
  maxAttempts: number;
  loopIterations: number;
  maxLoopIterations: number;
  isControlGroup: boolean;
  lastActTimestamp: Date | null;
  channel: string | null;
  proposedActionTime: Date | null;
}

export interface GuardrailDecision {
  passed: boolean;
  status: 'PROCEED' | 'TERMINATE' | 'ESCALATE' | 'BLOCK_ACT';
  violatedRule: number | null;
  reason: string;
  flagManualReview?: boolean;
}

export interface DeclineDiagnosis {
  rootCause: string;
  retryStrategy: string;
  description: string;
}

export interface InterventionStrategy {
  channel: string;
  actionTime: Date;
  actionType: 'SCHEDULE_RETRY' | 'SEND_MESSAGE' | 'OFFER_DISCOUNT';
  templateKey: string;
  templateId: string;
  discountPct: number;
}

export interface BatchSummary {
  total_events_processed: number;
  treatment_cases_count: number;
  control_cases_count: number;
  treatment_resolution_rate: number;
  control_resolution_rate: number;
  incremental_lift_percentage_points: number;
  gross_recovered_amount: number;
  total_cost_incurred: number;
  net_recovered_amount: number;
  roi_multiple: number;
  compliance_violations_count: number;
  escalation_rate: number;
  termination_rate: number;
}

export interface BreakdownItem {
  total: number;
  resolved: number;
  recovered: number;
  cost: number;
  resolution_rate: number;
  net_recovered: number;
}

export interface BatchReport {
  batch_summary: BatchSummary;
  breakdown_by_decline_code: Record<string, BreakdownItem>;
  breakdown_by_playbook: Record<string, BreakdownItem>;
}
