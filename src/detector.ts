import crypto from 'crypto';
import { Database } from './models.js';
import { RecoveryCaseRecord, EventRecord } from './types.js';

export function ingestEvent(
  db: Database,
  eventData: Record<string, any>,
  isControlGroup: boolean = false
): [RecoveryCaseRecord, boolean] {
  const eventId = String(eventData.event_id || eventData.eventId);

  // 1. Idempotency Check
  const existingCase = db.getCaseByEventId(eventId);
  if (existingCase) {
    return [existingCase, false];
  }

  // 2. Ensure Event record exists
  let event = db.getEvent(eventId);
  if (!event) {
    let ts = eventData.timestamp;
    if (typeof ts === 'string') {
      ts = new Date(ts);
    } else if (!ts) {
      ts = new Date();
    }

    event = {
      eventId,
      customerId: String(eventData.customer_id || eventData.customerId),
      eventType: String(eventData.event_type || eventData.eventType || 'UPI_PAYMENT_FAIL'),
      amount: parseFloat(eventData.amount) || 0,
      status: String(eventData.status || 'FAILED'),
      timestamp: ts,
      declineCode: String(eventData.decline_code || eventData.declineCode || 'NETWORK_TIMEOUT'),
      attemptNumber: parseInt(eventData.attempt_number || eventData.attemptNumber) || 1,
      fraudScore: parseFloat(eventData.fraud_score || eventData.fraudScore) || 0.0,
      retryCooldownHours: parseInt(eventData.retry_cooldown_hours || eventData.retryCooldownHours) || 2,
      ptpDate: eventData.ptp_date || eventData.ptpDate || null
    };
    db.saveEvent(event);
  }

  // 3. Initialize RecoveryCase
  const caseId = crypto.randomUUID();
  const newCase: RecoveryCaseRecord = {
    caseId,
    eventId,
    customerId: event.customerId,
    currentState: 'INIT',
    currentAttempt: 0,
    maxAttempts: 3,
    loopIterations: 0,
    maxLoopIterations: 4,
    nextActionTime: null,
    recoveryProbability: null,
    isControlGroup,
    totalRecoveredAmount: 0.0,
    totalCostIncurred: 0.0
  };
  db.saveCase(newCase);

  // 4. Log initial observation
  db.addAuditLog(
    caseId,
    'OBSERVE',
    `Detected revenue-at-risk event ${eventId} (${event.eventType}, amount: ₹${event.amount.toFixed(2)}, status: ${event.status}). Initialized case in state INIT (control_group=${isControlGroup}).`,
    event.timestamp
  );

  return [newCase, true];
}
