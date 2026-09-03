/**
 * Test Suite for Recover AI Revenue Recovery Engine (TypeScript)
 * Validates:
 * 1. Payment Failure Recovery Workflow
 * 2. Checkout Abandonment Recovery Workflow
 * 3. B2B Overdue Invoice & Promise-to-Pay (PTP) Workflow
 * 4. Deterministic Guardrail Vetoes & Autonomous Replan Loops
 * 5. Bounded Agent Loop State Machine
 */

import { Database } from './src/models.js';
import { runAgentLoopForCase } from './src/agent_loop.js';
import { evaluateGuardrails, checkDndWindow } from './src/guardrails.js';
import { generateAgentPlan } from './src/llm_agent.js';
import { Customer, EventRecord, OutcomeRecord } from './src/types.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`);
    process.exit(1);
  } else {
    passedTests++;
    console.log(`✅ PASS: ${testName}`);
  }
}

console.log('--- RECOVER AGENT TEST SUITE ---\n');

// 1. Guardrail Unit Tests
console.log('[1] Deterministic Guardrail Tests');

const dndNight = checkDndWindow(new Date('2025-01-01T22:30:00Z'));
assert(dndNight === true, 'DND window correctly detects 22:30 as restricted hours');

const dndDay = checkDndWindow(new Date('2025-01-01T14:15:00Z'));
assert(dndDay === false, 'DND window permits 14:15 daytime communications');

const optOutDecision = evaluateGuardrails({
  optOutStatus: true,
  fraudScore: 0.1,
  currentAttempt: 0,
  maxAttempts: 3,
  loopIterations: 1,
  maxLoopIterations: 5,
  lastActTimestamp: null,
  proposedActionTime: new Date(),
  retryCooldownHours: 4,
  channel: 'Email',
  whatsappConsent: false,
  discountPct: 0
});
assert(optOutDecision.passed === false && optOutDecision.violatedRule === 1, 'Rule 1: Opt-Out vetoes outreach');

const fraudDecision = evaluateGuardrails({
  optOutStatus: false,
  fraudScore: 0.92,
  currentAttempt: 0,
  maxAttempts: 3,
  loopIterations: 1,
  maxLoopIterations: 5,
  lastActTimestamp: null,
  proposedActionTime: new Date(),
  retryCooldownHours: 4,
  channel: 'Email',
  whatsappConsent: false,
  discountPct: 0
});
assert(fraudDecision.passed === false && fraudDecision.violatedRule === 2, 'Rule 2: Fraud score > 0.80 vetoes outreach');

const discountCapDecision = evaluateGuardrails({
  optOutStatus: false,
  fraudScore: 0.2,
  currentAttempt: 1,
  maxAttempts: 3,
  loopIterations: 1,
  maxLoopIterations: 5,
  lastActTimestamp: null,
  proposedActionTime: new Date(),
  retryCooldownHours: 4,
  channel: 'Email',
  whatsappConsent: false,
  discountPct: 25.0
});
assert(discountCapDecision.passed === false && discountCapDecision.violatedRule === 9, 'Rule 9: Margin protection discount cap blocks >20%');

const whatsappConsentDecision = evaluateGuardrails({
  optOutStatus: false,
  fraudScore: 0.1,
  currentAttempt: 0,
  maxAttempts: 3,
  loopIterations: 1,
  maxLoopIterations: 5,
  lastActTimestamp: null,
  proposedActionTime: new Date(),
  retryCooldownHours: 4,
  channel: 'WhatsApp',
  whatsappConsent: false,
  discountPct: 0
});
assert(whatsappConsentDecision.passed === false && whatsappConsentDecision.violatedRule === 8, 'Rule 8: Unsolicited WhatsApp without consent vetoed');

// 2. Dynamic Agent Plan Generation Tests
console.log('\n[2] Agent Brain Dynamic Reasoning Tests');

const highProbPlan = generateAgentPlan({
  declineCode: 'NETWORK_TIMEOUT',
  segment: 'High',
  whatsappConsent: true,
  eventType: 'UPI_PAYMENT_FAIL',
  amount: 2500,
  attemptNumber: 1
}, 0.85);
assert(highProbPlan.toolName === 'schedule_payment_retry', 'High recovery probability network timeout triggers schedule_payment_retry');
assert(highProbPlan.toolArgs.channel === 'WhatsApp', 'High segment with consent selects WhatsApp');

const cartAbandonPlan = generateAgentPlan({
  declineCode: 'HIGH_SHIPPING_COST',
  segment: 'Medium',
  whatsappConsent: false,
  eventType: 'CART_ABANDON',
  amount: 4200,
  attemptNumber: 2
}, 0.25);
assert(cartAbandonPlan.toolName === 'offer_recovery_discount', 'Cart drop-off with shipping friction triggers offer_recovery_discount');
assert(cartAbandonPlan.toolArgs.discountPct <= 20.0, 'Incentive discount adheres to margin cap');

// 3. B2B Overdue Invoice Workflow Tests
console.log('\n[3] B2B Overdue Invoice & Promise-to-Pay (PTP) Tests');

const b2bInitialPlan = generateAgentPlan({
  declineCode: 'OVERDUE_RECEIVABLE',
  segment: 'High',
  whatsappConsent: false,
  eventType: 'INVOICE_OVERDUE',
  amount: 45000,
  attemptNumber: 1,
  invoiceContext: {
    invoiceNumber: 'INV-2025-001',
    companyName: 'Acme Logistics Ltd',
    daysOverdue: 14
  }
}, 0.55);
assert(b2bInitialPlan.toolName === 'send_recovery_message', 'New B2B overdue invoice triggers professional statement reminder');

const b2bPtpPlan = generateAgentPlan({
  declineCode: 'OVERDUE_RECEIVABLE',
  segment: 'Medium',
  whatsappConsent: false,
  eventType: 'INVOICE_OVERDUE',
  amount: 60000,
  attemptNumber: 1,
  ptpDate: '2025-01-20',
  invoiceContext: {
    invoiceNumber: 'INV-2025-089',
    companyName: 'TechCorp Pvt Ltd',
    daysOverdue: 22,
    ptpDate: '2025-01-20',
    ptpStatus: 'NONE'
  }
}, 0.70);
assert(b2bPtpPlan.toolName === 'log_promise_to_pay', 'Customer PTP commitment triggers log_promise_to_pay tool');
assert(b2bPtpPlan.toolArgs.ptpDate === '2025-01-20', 'PTP date accurately logged in tool args');

const b2bDisputePlan = generateAgentPlan({
  declineCode: 'DISPUTED_INVOICE',
  segment: 'High',
  whatsappConsent: true,
  eventType: 'INVOICE_OVERDUE',
  amount: 150000,
  attemptNumber: 1,
  invoiceContext: {
    invoiceNumber: 'INV-2025-999',
    companyName: 'Global Enterprises Inc',
    daysOverdue: 35
  }
}, 0.30);
assert(b2bDisputePlan.toolName === 'escalate_to_human', 'Disputed invoice immediately halts automated dunning and routes to human AR');

// 4. Multi-Turn End-to-End Workflow Execution in Database
console.log('\n[4] Multi-Turn Agent Loop Execution Tests');

const db = new Database();

// Test Case A: Payment Failure with Guardrail Replan (WhatsApp blocked -> Replan to Email)
const custA: Customer = {
  customerId: 'CUST_A_01',
  segment: 'High',
  ltv: 12000,
  whatsappConsent: false, // NO WhatsApp consent
  optOutStatus: false
};
const eventA: EventRecord = {
  eventId: 'EVT_PAY_01',
  customerId: 'CUST_A_01',
  eventType: 'UPI_PAYMENT_FAIL',
  amount: 3200,
  status: 'FAILED',
  timestamp: new Date('2025-01-10T10:00:00Z'),
  declineCode: 'NETWORK_TIMEOUT',
  attemptNumber: 1,
  fraudScore: 0.05,
  retryCooldownHours: 2,
  ptpDate: null
};
const outcomeA: OutcomeRecord = {
  eventId: 'EVT_PAY_01',
  resolved: true,
  resolutionChannel: 'Email',
  resolvedAmount: 3200,
  resolutionTimestamp: new Date('2025-01-10T12:30:00Z')
};

db.saveCustomer(custA);
db.saveEvent(eventA);
db.saveOutcome(outcomeA);
const caseRecA = db.createCase(eventA.eventId, eventA.customerId, false);

const caseA = runAgentLoopForCase(db, caseRecA.caseId);
assert(caseA.currentState === 'RESOLVED', 'Case A: Payment failure successfully resolved');
assert(caseA.totalRecoveredAmount === 3200, 'Case A: Recovered full payment amount');

// Test Case B: Fraudulent Event Vetoed
const custB: Customer = {
  customerId: 'CUST_B_01',
  segment: 'Low',
  ltv: 500,
  whatsappConsent: false,
  optOutStatus: false
};
const eventB: EventRecord = {
  eventId: 'EVT_FRAUD_01',
  customerId: 'CUST_B_01',
  eventType: 'UPI_PAYMENT_FAIL',
  amount: 98000,
  status: 'FAILED',
  timestamp: new Date('2025-01-10T11:00:00Z'),
  declineCode: 'BANK_DECLINED',
  attemptNumber: 1,
  fraudScore: 0.95, // High fraud
  retryCooldownHours: 4,
  ptpDate: null
};

db.saveCustomer(custB);
db.saveEvent(eventB);
const caseRecB = db.createCase(eventB.eventId, eventB.customerId, false);

const caseB = runAgentLoopForCase(db, caseRecB.caseId);
assert(caseB.currentState === 'TERMINATED', 'Case B: High fraud event terminated immediately without communication');
assert(caseB.guardrailState?.violatedRule === 2, 'Case B: Guardrail Rule 2 recorded in case record');

// Test Case C: B2B Invoice with PTP Fulfilled
const custC: Customer = {
  customerId: 'CUST_C_B2B',
  segment: 'High',
  ltv: 85000,
  whatsappConsent: true,
  optOutStatus: false
};
const eventC: EventRecord = {
  eventId: 'EVT_INV_01',
  customerId: 'CUST_C_B2B',
  eventType: 'INVOICE_OVERDUE',
  amount: 45000,
  status: 'OVERDUE',
  timestamp: new Date('2025-01-10T09:00:00Z'),
  declineCode: 'OVERDUE_RECEIVABLE',
  attemptNumber: 1,
  fraudScore: 0.02,
  retryCooldownHours: 24,
  ptpDate: '2025-01-15',
  invoiceNumber: 'INV-2025-8812',
  companyName: 'Vertex Solutions LLP',
  dueDate: '2025-01-01',
  daysOverdue: 9
};
const outcomeC: OutcomeRecord = {
  eventId: 'EVT_INV_01',
  resolved: true,
  resolutionChannel: 'WhatsApp',
  resolvedAmount: 45000,
  resolutionTimestamp: new Date('2025-01-15T14:00:00Z')
};

db.saveCustomer(custC);
db.saveEvent(eventC);
db.saveOutcome(outcomeC);
const caseRecC = db.createCase(eventC.eventId, eventC.customerId, false);

const caseC = runAgentLoopForCase(db, caseRecC.caseId);
assert(caseC.currentState === 'RESOLVED', 'Case C: B2B Invoice with PTP successfully resolved');
assert(caseC.invoiceContext?.ptpStatus === 'FULFILLED', 'Case C: PTP status tracked as FULFILLED');

console.log(`\n========================================`);
console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests} tests green`);
console.log(`========================================\n`);
