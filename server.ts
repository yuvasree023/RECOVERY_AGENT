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
    service: 'Recover AI Agent',
    timestamp: new Date().toISOString()
  });
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

// Case details
app.get('/cases/:case_id', (req, res) => {
  const caseId = req.params.case_id;
  const caseRecord = db.getCase(caseId);
  if (!caseRecord) {
    return res.status(404).json({ detail: `Case ${caseId} not found.` });
  }

  res.json({
    case_id: caseRecord.caseId,
    event_id: caseRecord.eventId,
    customer_id: caseRecord.customerId,
    current_state: caseRecord.currentState,
    current_attempt: caseRecord.currentAttempt,
    max_attempts: caseRecord.maxAttempts,
    loop_iterations: caseRecord.loopIterations,
    is_control_group: caseRecord.isControlGroup,
    recovery_probability: caseRecord.recoveryProbability,
    total_recovered_amount: caseRecord.totalRecoveredAmount,
    total_cost_incurred: caseRecord.totalCostIncurred,
    next_action_time: caseRecord.nextActionTime ? caseRecord.nextActionTime.toISOString() : null
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

// System KPIs and metrics
app.get('/metrics', (req, res) => {
  const cases = db.getAllCases();
  const total = cases.length;
  const resolved = cases.filter(c => c.currentState === 'RESOLVED').length;
  const grossRecovered = cases.reduce((sum, c) => sum + c.totalRecoveredAmount, 0);
  const costIncurred = cases.reduce((sum, c) => sum + c.totalCostIncurred, 0);
  const netRecovered = grossRecovered - costIncurred;

  res.json({
    total_cases: total,
    resolved_cases: resolved,
    resolution_rate: total > 0 ? Math.round((resolved / total) * 10000) / 10000 : 0.0,
    gross_recovered_amount: Math.round(grossRecovered * 100) / 100,
    cost_incurred: Math.round(costIncurred * 100) / 100,
    net_recovered_amount: Math.round(netRecovered * 100) / 100,
    roi_multiple: costIncurred > 0 ? Math.round((netRecovered / costIncurred) * 10) / 10 : 0.0
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
      current_state: c.currentState,
      current_attempt: c.currentAttempt,
      max_attempts: c.maxAttempts,
      loop_iterations: c.loopIterations,
      is_control_group: c.isControlGroup,
      recovery_probability: c.recoveryProbability,
      total_recovered_amount: c.totalRecoveredAmount,
      total_cost_incurred: c.totalCostIncurred
    };
  });
  res.json(results);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Recover Revenue Engine running on port ${PORT} (0.0.0.0)`);
});
