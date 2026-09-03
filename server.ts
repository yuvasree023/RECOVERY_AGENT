import express from 'express';
import path from 'path';
import { db } from './src/models.js';
import { ingestEvent } from './src/detector.js';
import { runAgentLoopForCase } from './src/agent_loop.js';
import { runBatchSimulation } from './src/batch_runner.js';
import { classifyDecline, getRecoveryScorer } from './src/diagnosis.js';

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Database and initial run
const dataDir = path.join(process.cwd(), 'data');
db.loadCsvData(dataDir);
getRecoveryScorer(dataDir);

// Run initial simulation to populate DB state and metrics
runBatchSimulation(db, { dataDir, controlGroupPct: 0.20, randomSeed: 42 });

// Mount static directory
const staticDir = path.join(process.cwd(), 'static');
app.use('/static', express.static(staticDir));

// Root route serves dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'RECOVER — Autonomous Revenue Recovery Engine',
    model: 'Gemini 2.5 Flash',
    timestamp: new Date().toISOString()
  });
});

// Synchronous Interactive Case Simulation for Webhook Simulator
app.post('/api/simulate-case', (req, res) => {
  try {
    const payload = req.body || {};
    const eventType = payload.event_type || payload.eventType || 'UPI_PAYMENT_FAIL';
    const declineCode = payload.decline_code || payload.declineCode || 'NETWORK_TIMEOUT';
    const amount = Number(payload.amount) || 2499;
    const fraudScore = typeof payload.fraud_score === 'number' ? payload.fraud_score : (Number(payload.fraudScore) || 0.1);
    const customerSegment = payload.customer_segment || payload.customerSegment || 'High';
    const whatsappConsent = payload.whatsapp_consent !== undefined ? Boolean(payload.whatsapp_consent) : true;
    const optOutStatus = payload.opt_out !== undefined ? Boolean(payload.opt_out) : false;
    const simulateFailure = Boolean(payload.simulate_gateway_failure);
    const timeOfDay = payload.time_of_day || 'DAY'; // 'DAY' or 'NIGHT_DND'

    // Create unique event and customer
    const eventId = `EVT_SIM_${Date.now()}`;
    const customerId = `CUST_SIM_${Date.now().toString().slice(-4)}`;

    const eventDate = timeOfDay === 'NIGHT_DND' ? new Date(2024, 9, 1, 22, 30) : new Date();

    db.customers.set(customerId, {
      customerId,
      segment: customerSegment,
      ltv: customerSegment === 'High' ? 45000 : customerSegment === 'Medium' ? 15000 : 3500,
      whatsappConsent,
      optOutStatus
    });

    const eventRecord = {
      eventId,
      customerId,
      eventType,
      amount,
      status: 'FAILED',
      timestamp: eventDate,
      declineCode,
      attemptNumber: 1,
      fraudScore,
      retryCooldownHours: 2,
      ptpDate: null
    };
    db.events.set(eventId, eventRecord);

    // If simulated gateway failure is requested, inject an outcome or keep unresolved
    if (!simulateFailure && declineCode !== 'CARD_EXPIRED' && fraudScore <= 0.8 && !optOutStatus) {
      db.outcomes.set(eventId, {
        eventId,
        resolved: true,
        resolutionChannel: whatsappConsent && timeOfDay !== 'NIGHT_DND' ? 'WhatsApp' : 'Email',
        resolvedAmount: amount,
        resolutionTimestamp: new Date(eventDate.getTime() + 30 * 60 * 1000)
      });
    }

    const [caseRecord] = ingestEvent(db, eventRecord, false);
    runAgentLoopForCase(db, caseRecord.caseId, dataDir);

    const updatedCase = db.getCase(caseRecord.caseId);
    const auditLogs = db.getAuditLogs(caseRecord.caseId);

    res.json({
      success: true,
      case: updatedCase,
      logs: auditLogs,
      summary: {
        case_id: updatedCase?.caseId,
        final_state: updatedCase?.currentState,
        recovered_amount: updatedCase?.totalRecoveredAmount,
        cost_incurred: updatedCase?.totalCostIncurred,
        attempts: updatedCase?.currentAttempt,
        decision_reason: updatedCase?.decisionReason
      }
    });
  } catch (err: any) {
    console.error('Error simulating case:', err);
    res.status(500).json({ error: err.message || 'Simulation error' });
  }
});

// Webhook: Payment Failed
app.post('/webhooks/payment-failed', (req, res) => {
  const payload = req.body || {};
  const [caseRecord, isNew] = ingestEvent(db, payload, false);

  if (isNew) {
    // Run agent loop asynchronously
    setImmediate(() => {
      try {
        runAgentLoopForCase(db, caseRecord.caseId, dataDir);
      } catch (err) {
        console.error('Error running agent loop for case:', err);
      }
    });
  }

  const declineCode = payload.decline_code || payload.declineCode || 'NETWORK_TIMEOUT';

  res.json({
    status: 'ACCEPTED',
    is_new_case: isNew,
    case_id: caseRecord.caseId,
    event_id: caseRecord.eventId,
    current_state: caseRecord.currentState,
    diagnosis: classifyDecline(declineCode)
  });
});

// Webhook: Cart Abandoned
app.post('/webhooks/cart-abandoned', (req, res) => {
  const payload = req.body || {};
  payload.event_type = 'CART_ABANDON';
  payload.status = 'DROPPED';
  const [caseRecord, isNew] = ingestEvent(db, payload, false);

  if (isNew) {
    setImmediate(() => {
      try {
        runAgentLoopForCase(db, caseRecord.caseId, dataDir);
      } catch (err) {
        console.error('Error running agent loop for cart abandon:', err);
      }
    });
  }

  res.json({
    status: 'ACCEPTED',
    is_new_case: isNew,
    case_id: caseRecord.caseId,
    event_id: caseRecord.eventId,
    current_state: caseRecord.currentState,
    playbook: 'Checkout Drop-off Recovery'
  });
});

// Webhook: Subscription Failed
app.post('/webhooks/subscription-failed', (req, res) => {
  const payload = req.body || {};
  payload.event_type = 'SUBSCRIPTION_FAIL';
  const [caseRecord, isNew] = ingestEvent(db, payload, false);

  if (isNew) {
    setImmediate(() => {
      try {
        runAgentLoopForCase(db, caseRecord.caseId, dataDir);
      } catch (err) {
        console.error('Error running agent loop for subscription fail:', err);
      }
    });
  }

  res.json({
    status: 'ACCEPTED',
    is_new_case: isNew,
    case_id: caseRecord.caseId,
    event_id: caseRecord.eventId,
    current_state: caseRecord.currentState,
    playbook: 'Subscription Mandate Recovery'
  });
});

// Case details with Deep Timeline
app.get('/cases/:case_id', (req, res) => {
  const caseId = req.params.case_id;
  const caseRecord = db.getCase(caseId);
  if (!caseRecord) {
    return res.status(404).json({ detail: `Case ${caseId} not found.` });
  }

  const evt = db.getEvent(caseRecord.eventId);
  const cust = db.getCustomer(caseRecord.customerId);
  const logs = db.getAuditLogs(caseId);

  // Build deep chronological timeline
  const timeline = logs.map(l => {
    let title: string = l.step;
    let description = '';
    let status = 'info';

    if (l.step === 'OBSERVE') {
      title = '1. Event Observed & Ingested';
      description = `Ingested ${evt?.eventType || 'event'} (${evt?.declineCode || 'decline'}) for customer ${cust?.customerId} (Segment: ${cust?.segment}, LTV: ₹${cust?.ltv || 0}).`;
    } else if (l.step === 'REASON') {
      title = '2. ML Likelihood & Root Cause Reasoning';
      description = l.detail.decision_reason || `Diagnosed root cause: ${l.detail.diagnosis?.rootCause}. ML estimated ${(l.detail.recovery_signal?.probability * 100).toFixed(1)}% recovery likelihood.`;
    } else if (l.step === 'PLAN') {
      title = '3. Gemini Agent Selected Next Action';
      description = `${l.detail.decision_reason || ''} [Tool: ${l.detail.proposed_tool}, Channel: ${l.detail.channel || 'Direct'}]`;
    } else if (l.step === 'GUARDRAIL_CHECK') {
      title = `4. Deterministic Guardrails: ${l.detail.passed ? 'PASSED' : 'BLOCKED'}`;
      description = l.detail.passed
        ? 'All 7 fail-closed compliance guardrails passed successfully.'
        : `Blocked by Rule ${l.detail.violated_rule}: ${l.detail.reason}`;
      status = l.detail.passed ? 'success' : 'warning';
    } else if (l.step === 'GUARDRAIL_FAIL') {
      title = '4a. Guardrail Interception';
      description = `Action blocked: ${l.detail.rejection_reason}. Invoking Gemini Replan with structured feedback.`;
      status = 'warning';
    } else if (l.step === 'REPLAN') {
      title = '4b. Gemini Adaptive Replan';
      description = `Pivoted plan: ${l.detail.decision_reason || l.detail.proposed_tool} via ${l.detail.channel}.`;
      status = 'info';
    } else if (l.step === 'ACT') {
      title = '5. Tool Executed via Simulator';
      description = `Dispatched ${l.detail.action_type} via ${l.detail.channel} (Cost: ₹${l.detail.cost_incurred}). Message template: ${l.detail.template_id}.`;
      status = 'success';
    } else if (l.step === 'OBSERVE_OUTCOME') {
      title = `6. Outcome Observed: ${l.detail.outcome}`;
      description = l.detail.decision_reason || (l.detail.outcome === 'RESOLVED' ? `Recovered ₹${l.detail.recovered_amount} via ${l.detail.resolution_channel}.` : 'Pending settlement.');
      status = l.detail.outcome === 'RESOLVED' ? 'success' : 'neutral';
    } else if (l.step === 'CLOSE') {
      title = `7. Terminal State: ${l.detail.final_state}`;
      description = l.detail.decision_reason || `Case safely closed. Total recovered: ₹${l.detail.recovered_amount || 0}.`;
      status = l.detail.final_state === 'RESOLVED' ? 'success' : 'neutral';
    } else if (l.step === 'ESCALATE') {
      title = 'Escalated to Human Ops Desk';
      description = l.detail.decision_reason || l.detail.reason || 'Escalated for human operator review.';
      status = 'danger';
    }

    return {
      log_id: l.logId,
      step: l.step,
      timestamp: l.timestamp.toISOString(),
      title,
      description,
      status,
      detail: l.detail
    };
  });

  res.json({
    case_id: caseRecord.caseId,
    event_id: caseRecord.eventId,
    customer_id: caseRecord.customerId,
    current_state: caseRecord.currentState,
    current_attempt: caseRecord.currentAttempt,
    max_attempts: caseRecord.maxAttempts,
    loop_iterations: caseRecord.loopIterations,
    max_loop_iterations: caseRecord.maxLoopIterations,
    is_control_group: caseRecord.isControlGroup,
    recovery_probability: caseRecord.recoveryProbability,
    total_recovered_amount: caseRecord.totalRecoveredAmount,
    total_cost_incurred: caseRecord.totalCostIncurred,
    currency: caseRecord.currency || 'INR',
    decision_reason: caseRecord.decisionReason || 'Autonomous reasoning active.',
    customer_context: caseRecord.customerContext || {
      segment: cust?.segment || 'Unknown',
      ltv: cust?.ltv || 0,
      preferredChannel: cust?.whatsappConsent ? 'WhatsApp' : 'SMS',
      optedOut: cust?.optOutStatus || false
    },
    risk_context: caseRecord.riskContext || {
      fraudScore: evt?.fraudScore || 0.1,
      declineCode: evt?.declineCode || 'UNKNOWN',
      riskBand: 'NORMAL'
    },
    previous_actions: caseRecord.previousActions || [],
    available_actions: caseRecord.availableActions || [
      'schedule_payment_retry',
      'send_recovery_message',
      'offer_recovery_discount',
      'escalate_to_human',
      'close_case'
    ],
    last_tool_result: caseRecord.lastToolResult || null,
    next_action_time: caseRecord.nextActionTime ? caseRecord.nextActionTime.toISOString() : null,
    timeline
  });
});

// Case audit trail
app.get('/cases/:case_id/audit', (req, res) => {
  const caseId = req.params.case_id;
  const logs = db.getAuditLogs(caseId);
  if (!logs || logs.length === 0) {
    return res.status(404).json({ detail: `No audit logs found for case ${caseId}.` });
  }

  res.json({
    case_id: caseId,
    total_steps: logs.length,
    audit_trail: logs.map(l => ({
      log_id: l.logId,
      timestamp: l.timestamp.toISOString(),
      step: l.step,
      detail: l.detail
    }))
  });
});

// Batch Simulation Replay
app.post('/batch/run', (req, res) => {
  const reqBody = req.body || {};
  const controlPct = typeof reqBody.control_group_pct === 'number' ? reqBody.control_group_pct : 0.20;
  const seed = typeof reqBody.random_seed === 'number' ? reqBody.random_seed : 42;

  const report = runBatchSimulation(db, {
    dataDir,
    controlGroupPct: controlPct,
    randomSeed: seed
  });

  res.json(report);
});

// System KPIs and transparent evaluation metrics
app.get('/metrics', (req, res) => {
  const cases = db.getAllCases();
  const treatmentCases = cases.filter(c => !c.isControlGroup);
  const controlCases = cases.filter(c => c.isControlGroup);

  const total = cases.length;
  const nTreatment = treatmentCases.length;
  const nControl = controlCases.length;

  const tResolved = treatmentCases.filter(c => c.currentState === 'RESOLVED').length;
  const cResolved = controlCases.filter(c => c.currentState === 'RESOLVED').length;

  const tEscalated = treatmentCases.filter(c => c.currentState === 'ESCALATED').length;
  const tTerminated = treatmentCases.filter(c => c.currentState === 'TERMINATED').length;

  const treatmentRate = nTreatment > 0 ? tResolved / nTreatment : 0.0;
  const controlRate = nControl > 0 ? cResolved / nControl : 0.0;
  const observedDiff = treatmentRate - controlRate;

  const grossRecovered = treatmentCases.reduce((sum, c) => sum + c.totalRecoveredAmount, 0);
  const costIncurred = treatmentCases.reduce((sum, c) => sum + c.totalCostIncurred, 0);
  const netRecovered = grossRecovered - costIncurred;

  let guardrailBlocks = 0;
  for (const log of db.auditLogs) {
    if (log.step === 'GUARDRAIL_CHECK' && log.detail?.passed === false) {
      guardrailBlocks++;
    }
  }

  res.json({
    evaluation_type: 'Offline historical replay',
    comparison_method: 'Simulated baseline comparison',
    disclaimer: 'Metrics derived from offline historical replay with a 20% simulated holdout baseline.',
    total_cases: total,
    treatment_cases_count: nTreatment,
    control_cases_count: nControl,
    treatment_resolution_rate: Math.round(treatmentRate * 10000) / 10000,
    control_resolution_rate: Math.round(controlRate * 10000) / 10000,
    observed_recovery_rate_diff: Math.round(observedDiff * 10000) / 10000,
    gross_recovered_amount: Math.round(grossRecovered * 100) / 100,
    total_cost_incurred: Math.round(costIncurred * 100) / 100,
    net_recovered_amount: Math.round(netRecovered * 100) / 100,
    roi_multiple: costIncurred > 0 ? Math.round((netRecovered / costIncurred) * 10) / 10 : 0.0,
    guardrail_blocks_count: guardrailBlocks,
    escalation_count: tEscalated,
    termination_count: tTerminated
  });
});

// All Audit Logs endpoint
app.get('/api/audit/logs', (req, res) => {
  const stepFilter = req.query.step as string | undefined;
  const limit = Math.min(200, Number(req.query.limit) || 100);

  let logs = [...db.auditLogs];
  if (stepFilter && stepFilter !== 'ALL') {
    logs = logs.filter(l => l.step === stepFilter);
  }

  // Reverse sort by timestamp
  logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  res.json({
    total: logs.length,
    logs: logs.slice(0, limit).map(l => ({
      log_id: l.logId,
      case_id: l.caseId,
      step: l.step,
      timestamp: l.timestamp.toISOString(),
      decision_reason: l.detail?.decision_reason || null,
      detail: l.detail
    }))
  });
});

// Case Explorer API
app.get('/api/cases', (req, res) => {
  const cases = db.getAllCases();
  const results = cases.map(c => {
    const evt = db.getEvent(c.eventId);
    const cust = db.getCustomer(c.customerId);
    return {
      case_id: c.caseId,
      event_id: c.eventId,
      customer_id: c.customerId,
      customer_segment: cust?.segment || 'Unknown',
      event_type: evt?.eventType || 'UNKNOWN',
      decline_code: evt?.declineCode || 'UNKNOWN',
      amount: evt?.amount || 0.0,
      currency: c.currency || 'INR',
      current_state: c.currentState,
      current_attempt: c.currentAttempt,
      max_attempts: c.maxAttempts,
      loop_iterations: c.loopIterations,
      is_control_group: c.isControlGroup,
      recovery_probability: c.recoveryProbability,
      decision_reason: c.decisionReason || 'Autonomous reasoning evaluated.',
      total_recovered_amount: c.totalRecoveredAmount,
      total_cost_incurred: c.totalCostIncurred
    };
  });
  res.json(results);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Recover Revenue Engine running on port ${PORT} (0.0.0.0)`);
});
