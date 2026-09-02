import { Database } from './models.js';
import { ingestEvent } from './detector.js';
import { runAgentLoopForCase } from './agent_loop.js';
import { BatchReport, BatchSummary, BreakdownItem } from './types.js';

// Simple seeded PRNG (Linear Congruential Generator)
function createSeededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function runBatchSimulation(
  targetDb: Database,
  options: {
    dataDir?: string;
    controlGroupPct?: number;
    randomSeed?: number;
  } = {}
): BatchReport {
  const dataDir = options.dataDir || 'data';
  const controlGroupPct = options.controlGroupPct !== undefined ? options.controlGroupPct : 0.20;
  const randomSeed = options.randomSeed !== undefined ? options.randomSeed : 42;

  // Reset database state and reload CSV data
  targetDb.reset();
  targetDb.loadCsvData(dataDir);

  const rand = createSeededRandom(randomSeed);

  // Fetch all events chronologically
  const events = Array.from(targetDb.events.values()).sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  const totalEvents = events.length;
  const controlCount = Math.round(totalEvents * controlGroupPct);

  // Sample control group indices
  const indices = Array.from({ length: totalEvents }, (_, i) => i);
  // Fisher-Yates shuffle with seeded rand
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const controlIndices = new Set(indices.slice(0, controlCount));

  const caseIds: string[] = [];

  // 1. Ingest all events
  for (let idx = 0; idx < events.length; idx++) {
    const evt = events[idx];
    const isControl = controlIndices.has(idx);
    const [c] = ingestEvent(targetDb, evt, isControl);
    caseIds.push(c.caseId);
  }

  // 2. Run agent loop for every case
  for (const cid of caseIds) {
    runAgentLoopForCase(targetDb, cid, dataDir);
  }

  // 3. Analyze results
  const allCases = targetDb.getAllCases();
  const treatmentCases = allCases.filter(c => !c.isControlGroup);
  const controlCases = allCases.filter(c => c.isControlGroup);

  const nTreatment = treatmentCases.length;
  const tResolved = treatmentCases.filter(c => c.currentState === 'RESOLVED');
  const tTerminated = treatmentCases.filter(c => c.currentState === 'TERMINATED');
  const tEscalated = treatmentCases.filter(c => c.currentState === 'ESCALATED');

  const treatmentResolvedRate = nTreatment > 0 ? tResolved.length / nTreatment : 0;
  const treatmentGrossRecovered = treatmentCases.reduce((sum, c) => sum + c.totalRecoveredAmount, 0);
  const treatmentTotalCost = treatmentCases.reduce((sum, c) => sum + c.totalCostIncurred, 0);
  const treatmentNetRecovered = treatmentGrossRecovered - treatmentTotalCost;

  const nControl = controlCases.length;
  const cResolved = controlCases.filter(c => c.currentState === 'RESOLVED');
  const controlResolvedRate = nControl > 0 ? cResolved.length / nControl : 0;

  const incrementalLiftPct = (treatmentResolvedRate - controlResolvedRate) * 100.0;
  const roiMultiple = treatmentTotalCost > 0 ? treatmentNetRecovered / treatmentTotalCost : 0;

  // Breakdown by decline code
  const declineBreakdown: Record<string, BreakdownItem> = {};
  for (const c of treatmentCases) {
    const evt = targetDb.getEvent(c.eventId);
    const code = evt ? evt.declineCode : 'UNKNOWN';
    if (!declineBreakdown[code]) {
      declineBreakdown[code] = { total: 0, resolved: 0, recovered: 0, cost: 0, resolution_rate: 0, net_recovered: 0 };
    }
    declineBreakdown[code].total += 1;
    if (c.currentState === 'RESOLVED') {
      declineBreakdown[code].resolved += 1;
      declineBreakdown[code].recovered += c.totalRecoveredAmount;
    }
    declineBreakdown[code].cost += c.totalCostIncurred;
  }

  for (const k of Object.keys(declineBreakdown)) {
    const item = declineBreakdown[k];
    item.resolution_rate = item.total > 0 ? Math.round((item.resolved / item.total) * 10000) / 10000 : 0;
    item.net_recovered = Math.round((item.recovered - item.cost) * 100) / 100;
  }

  // Breakdown by playbook
  const playbookBreakdown: Record<string, BreakdownItem> = {
    'Payment Failure Recovery (UPI/SUB)': { total: 0, resolved: 0, recovered: 0, cost: 0, resolution_rate: 0, net_recovered: 0 },
    'Checkout Drop-off Recovery (CART)': { total: 0, resolved: 0, recovered: 0, cost: 0, resolution_rate: 0, net_recovered: 0 }
  };

  for (const c of treatmentCases) {
    const evt = targetDb.getEvent(c.eventId);
    const pb = evt?.eventType === 'CART_ABANDON'
      ? 'Checkout Drop-off Recovery (CART)'
      : 'Payment Failure Recovery (UPI/SUB)';

    playbookBreakdown[pb].total += 1;
    if (c.currentState === 'RESOLVED') {
      playbookBreakdown[pb].resolved += 1;
      playbookBreakdown[pb].recovered += c.totalRecoveredAmount;
    }
    playbookBreakdown[pb].cost += c.totalCostIncurred;
  }

  for (const k of Object.keys(playbookBreakdown)) {
    const item = playbookBreakdown[k];
    item.resolution_rate = item.total > 0 ? Math.round((item.resolved / item.total) * 10000) / 10000 : 0;
    item.net_recovered = Math.round((item.recovered - item.cost) * 100) / 100;
  }

  // Check compliance violations in audit logs
  let complianceViolations = 0;
  for (const al of targetDb.auditLogs) {
    if (al.step === 'ACT') {
      const caseObj = targetDb.getCase(al.caseId);
      if (caseObj) {
        if (caseObj.isControlGroup) complianceViolations++;
        const cust = targetDb.getCustomer(caseObj.customerId);
        if (cust?.optOutStatus) complianceViolations++;
        const evt = targetDb.getEvent(caseObj.eventId);
        if (evt && evt.fraudScore > 0.8) complianceViolations++;
      }
    }
  }

  const summary: BatchSummary = {
    total_events_processed: totalEvents,
    treatment_cases_count: nTreatment,
    control_cases_count: nControl,
    treatment_resolution_rate: Math.round(treatmentResolvedRate * 10000) / 10000,
    control_resolution_rate: Math.round(controlResolvedRate * 10000) / 10000,
    incremental_lift_percentage_points: Math.round(incrementalLiftPct * 100) / 100,
    gross_recovered_amount: Math.round(treatmentGrossRecovered * 100) / 100,
    total_cost_incurred: Math.round(treatmentTotalCost * 100) / 100,
    net_recovered_amount: Math.round(treatmentNetRecovered * 100) / 100,
    roi_multiple: Math.round(roiMultiple * 10) / 10,
    compliance_violations_count: complianceViolations,
    escalation_rate: nTreatment > 0 ? Math.round((tEscalated.length / nTreatment) * 10000) / 10000 : 0,
    termination_rate: nTreatment > 0 ? Math.round((tTerminated.length / nTreatment) * 10000) / 10000 : 0
  };

  return {
    batch_summary: summary,
    breakdown_by_decline_code: declineBreakdown,
    breakdown_by_playbook: playbookBreakdown
  };
}
