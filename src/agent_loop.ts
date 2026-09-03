import { Database } from './models.js';
import { RecoveryCaseRecord, GuardrailContext, CaseState } from './types.js';
import { evaluateGuardrails } from './guardrails.js';
import { classifyDecline, getRecoveryScorer } from './diagnosis.js';
import { calculateNextActionTime } from './intervention.js';
import { generateAgentPlan, AgentContext } from './llm_agent.js';
import { executeRecoveryAction } from './execution.js';
import { escalateToHuman, closeCase } from './mock_services.js';

export function runAgentLoopForCase(
  db: Database,
  caseId: string,
  dataDir: string = 'data'
): RecoveryCaseRecord {
  const caseRecord = db.getCase(caseId);
  if (!caseRecord) {
    throw new Error(`Case ${caseId} not found.`);
  }

  const event = db.getEvent(caseRecord.eventId);
  if (!event) {
    throw new Error(`Event for case ${caseId} not found.`);
  }

  const customer = db.getCustomer(caseRecord.customerId) || {
    customerId: caseRecord.customerId,
    segment: 'Low',
    ltv: 0,
    whatsappConsent: false,
    optOutStatus: false
  };

  const outcome = db.getOutcome(caseRecord.eventId);
  const scorer = getRecoveryScorer(dataDir);

  let simTime = new Date(event.timestamp);
  let lastActTime: Date | null = null;

  // Initialize standardized case metadata
  caseRecord.currency = 'INR';
  caseRecord.customerContext = {
    segment: customer.segment,
    ltv: customer.ltv,
    preferredChannel: customer.whatsappConsent ? 'WhatsApp' : 'SMS',
    dnd: false,
    optedOut: customer.optOutStatus
  };
  caseRecord.riskContext = {
    fraudScore: event.fraudScore,
    declineCode: event.declineCode,
    riskBand: event.fraudScore > 0.5 ? 'HIGH' : 'NORMAL'
  };
  caseRecord.availableActions = [
    'schedule_payment_retry',
    'send_recovery_message',
    'offer_recovery_discount',
    'log_promise_to_pay',
    'escalate_to_human',
    'close_case'
  ];
  caseRecord.invoiceContext = {
    invoiceNumber: event.invoiceNumber || `INV-${event.eventId.slice(-6)}`,
    companyName: event.companyName || `Account_${customer.customerId}`,
    dueDate: event.dueDate || new Date(event.timestamp.getTime() - 15 * 86400000).toISOString().slice(0, 10),
    daysOverdue: event.daysOverdue || Math.max(1, Math.floor((simTime.getTime() - event.timestamp.getTime()) / 86400000) + 15),
    ptpDate: event.ptpDate,
    ptpStatus: event.ptpDate ? 'LOGGED' : 'NONE',
    previousReminders: Math.max(0, caseRecord.currentAttempt - 1)
  };

  // STEP 1: OBSERVE (Pre-flight check)
  caseRecord.currentState = 'OBSERVE';
  db.saveCase(caseRecord);

  if (
    outcome &&
    outcome.resolved &&
    outcome.resolutionTimestamp &&
    outcome.resolutionTimestamp.getTime() <= event.timestamp.getTime()
  ) {
    caseRecord.currentState = 'RESOLVED';
    caseRecord.totalRecoveredAmount = outcome.resolvedAmount;
    caseRecord.decisionReason = 'Payment confirmed prior to agent intervention. Safe automatic closure.';
    db.saveCase(caseRecord);
    db.addAuditLog(
      caseRecord.caseId,
      'OBSERVE',
      {
        pre_flight_check: 'ALREADY_RESOLVED',
        decision_reason: caseRecord.decisionReason,
        message: 'Payment resolved prior to agent intervention. Closing case.'
      },
      simTime
    );
    return caseRecord;
  }

  db.addAuditLog(
    caseRecord.caseId,
    'OBSERVE',
    {
      event_id: event.eventId,
      event_type: event.eventType,
      amount: event.amount,
      currency: 'INR',
      customer_id: customer.customerId,
      customer_segment: customer.segment,
      customer_ltv: customer.ltv,
      decline_code: event.declineCode,
      prior_attempts: caseRecord.currentAttempt
    },
    simTime
  );

  // Main Bounded Agent Loop: Max 4 iterations & max 3 attempts
  while (
    (caseRecord.currentState as CaseState) !== 'RESOLVED' &&
    (caseRecord.currentState as CaseState) !== 'TERMINATED' &&
    (caseRecord.currentState as CaseState) !== 'ESCALATED'
  ) {
    // Safety circuit breaker check on the loop itself
    if (caseRecord.loopIterations >= caseRecord.maxLoopIterations) {
      caseRecord.currentState = 'ESCALATED';
      caseRecord.decisionReason = 'Reasoning loop iteration limit reached (circuit breaker triggered). Escalating to human desk.';
      db.saveCase(caseRecord);
      const escRes = escalateToHuman(caseRecord.caseId, 'Loop iteration limit reached (circuit breaker).', 'HIGH');
      db.addAuditLog(
        caseRecord.caseId,
        'ESCALATE',
        {
          ...escRes,
          decision_reason: caseRecord.decisionReason
        },
        simTime
      );
      break;
    }

    // STEP 2: REASON (ML Likelihood Signal + Root Cause Diagnosis)
    caseRecord.currentState = 'REASON';
    const declineDiagnosis = classifyDecline(event.declineCode);
    const recoveryProb = scorer.predictProbability(
      customer.segment,
      customer.ltv,
      event.declineCode,
      caseRecord.currentAttempt + 1,
      event.eventType
    );
    caseRecord.recoveryProbability = recoveryProb;
    const riskBand = recoveryProb >= 0.6 ? 'low' : recoveryProb >= 0.3 ? 'medium' : 'high';

    db.saveCase(caseRecord);

    db.addAuditLog(
      caseRecord.caseId,
      'REASON',
      {
        decline_code: event.declineCode,
        diagnosis: declineDiagnosis,
        recovery_signal: {
          probability: Math.round(recoveryProb * 1000) / 1000,
          risk_band: riskBand,
          model_version: 'recovery-v1-logistic-regression'
        },
        decision_reason: `ML model estimated recovery probability at ${(recoveryProb * 100).toFixed(1)}% (${riskBand} risk tier) for ${event.declineCode}.`
      },
      simTime
    );

    // STEP 3: PLAN (Gemini Autonomous Agent Tool Calling)
    caseRecord.currentState = 'PLAN';
    const agentContext: AgentContext = {
      caseId: caseRecord.caseId,
      declineCode: event.declineCode,
      segment: customer.segment,
      whatsappConsent: customer.whatsappConsent,
      optOutStatus: customer.optOutStatus,
      eventType: event.eventType,
      amount: event.amount,
      currency: 'INR',
      attemptNumber: caseRecord.currentAttempt + 1,
      fraudScore: event.fraudScore,
      retryCooldownHours: event.retryCooldownHours,
      ptpDate: event.ptpDate || caseRecord.invoiceContext?.ptpDate,
      invoiceContext: caseRecord.invoiceContext,
      previousActions: caseRecord.previousActions || [],
      lastToolResult: caseRecord.lastToolResult,
      policyState: {
        cooldownActive: lastActTime ? (simTime.getTime() - lastActTime.getTime() < event.retryCooldownHours * 3600 * 1000) : false,
        retryLimitRemaining: Math.max(0, caseRecord.maxAttempts - caseRecord.currentAttempt),
        contactLimitRemaining: Math.max(0, caseRecord.maxAttempts - caseRecord.currentAttempt)
      }
    };

    const llmProposal = generateAgentPlan(agentContext, recoveryProb);
    caseRecord.decisionReason = llmProposal.decisionReason;

    const nextActionTime = calculateNextActionTime(
      simTime,
      event.retryCooldownHours,
      llmProposal.toolArgs.channel
    );

    const actionPlan = {
      channel: llmProposal.toolArgs.channel,
      actionTime: nextActionTime,
      actionType: llmProposal.toolArgs.actionType as any,
      templateKey: llmProposal.toolArgs.templateKey,
      templateId: llmProposal.toolArgs.templateKey,
      discountPct: llmProposal.toolArgs.discountPct,
      ptpDate: llmProposal.toolArgs.ptpDate
    };

    db.saveCase(caseRecord);

    db.addAuditLog(
      caseRecord.caseId,
      'PLAN',
      {
        decision_reason: llmProposal.decisionReason,
        proposed_tool: llmProposal.toolName,
        channel: actionPlan.channel,
        action_type: actionPlan.actionType,
        scheduled_time: actionPlan.actionTime.toISOString(),
        template_key: actionPlan.templateKey,
        discount_pct: actionPlan.discountPct
      },
      simTime
    );

    // STEP 4: GUARDRAIL_CHECK (LLM Proposes, Deterministic Guardrail Disposes)
    caseRecord.currentState = 'GUARDRAIL_CHECK';
    let finalActionPlan = actionPlan;
    let finalProposal = llmProposal;

    const gCtx: GuardrailContext = {
      optOutStatus: customer.optOutStatus,
      fraudScore: event.fraudScore,
      retryCooldownHours: event.retryCooldownHours,
      currentAttempt: caseRecord.currentAttempt,
      maxAttempts: caseRecord.maxAttempts,
      loopIterations: caseRecord.loopIterations,
      maxLoopIterations: caseRecord.maxLoopIterations,
      isControlGroup: caseRecord.isControlGroup,
      lastActTimestamp: lastActTime,
      channel: finalActionPlan.channel,
      proposedActionTime: finalActionPlan.actionTime,
      whatsappConsent: customer.whatsappConsent,
      discountPct: finalActionPlan.discountPct
    };

    let decision = evaluateGuardrails(gCtx);
    caseRecord.guardrailState = {
      lastCheckPassed: decision.passed,
      violatedRule: decision.violatedRule,
      rejectionReason: decision.reason
    };

    db.addAuditLog(
      caseRecord.caseId,
      'GUARDRAIL_CHECK',
      {
        passed: decision.passed,
        status: decision.status,
        violated_rule: decision.violatedRule,
        reason: decision.reason,
        flag_manual_review: decision.flagManualReview || false
      },
      simTime
    );

    // Adaptive Replan Loop if Guardrails rejected the proposal
    if (!decision.passed && !caseRecord.isControlGroup) {
      if (decision.status === 'TERMINATE') {
        caseRecord.currentState = 'TERMINATED';
        caseRecord.decisionReason = `Case terminated by guardrail rule ${decision.violatedRule}: ${decision.reason}`;
        db.saveCase(caseRecord);
        const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0, caseRecord.decisionReason);
        db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
        break;
      }

      if (decision.status === 'ESCALATE') {
        caseRecord.currentState = 'ESCALATED';
        caseRecord.decisionReason = `Case escalated by guardrail rule ${decision.violatedRule}: ${decision.reason}`;
        db.saveCase(caseRecord);
        const escInfo = escalateToHuman(caseRecord.caseId, caseRecord.decisionReason, 'HIGH');
        db.addAuditLog(caseRecord.caseId, 'ESCALATE', escInfo, simTime);
        break;
      }

      db.addAuditLog(
        caseRecord.caseId,
        'GUARDRAIL_FAIL',
        {
          rejected_plan: finalProposal.toolName,
          rejected_channel: finalActionPlan.channel,
          violated_rule: decision.violatedRule,
          rejection_reason: decision.reason,
          action: 'Invoking Gemini Replan with structured rejection feedback'
        },
        simTime
      );

      // Replan with structured guardrail feedback
      const replanProposal = generateAgentPlan(agentContext, recoveryProb, decision.reason);
      const replanActionTime = calculateNextActionTime(
        simTime,
        event.retryCooldownHours,
        replanProposal.toolArgs.channel
      );

      const replanActionPlan = {
        channel: replanProposal.toolArgs.channel,
        actionTime: replanActionTime,
        actionType: replanProposal.toolArgs.actionType as any,
        templateKey: replanProposal.toolArgs.templateKey,
        templateId: replanProposal.toolArgs.templateKey,
        discountPct: replanProposal.toolArgs.discountPct,
        ptpDate: replanProposal.toolArgs.ptpDate
      };

      db.addAuditLog(
        caseRecord.caseId,
        'REPLAN',
        {
          decision_reason: replanProposal.decisionReason,
          proposed_tool: replanProposal.toolName,
          channel: replanActionPlan.channel,
          action_type: replanActionPlan.actionType,
          scheduled_time: replanActionPlan.actionTime.toISOString()
        },
        simTime
      );

      const replanGCtx: GuardrailContext = {
        optOutStatus: customer.optOutStatus,
        fraudScore: event.fraudScore,
        retryCooldownHours: event.retryCooldownHours,
        currentAttempt: caseRecord.currentAttempt,
        maxAttempts: caseRecord.maxAttempts,
        loopIterations: caseRecord.loopIterations,
        maxLoopIterations: caseRecord.maxLoopIterations,
        isControlGroup: caseRecord.isControlGroup,
        lastActTimestamp: lastActTime,
        channel: replanActionPlan.channel,
        proposedActionTime: replanActionPlan.actionTime
      };

      const replanDecision = evaluateGuardrails(replanGCtx);
      db.addAuditLog(
        caseRecord.caseId,
        'GUARDRAIL_CHECK',
        {
          ...replanDecision,
          attempt: 'REPLAN_VALIDATION'
        },
        simTime
      );

      if (replanDecision.passed) {
        finalActionPlan = replanActionPlan;
        finalProposal = replanProposal;
      } else {
        if (replanDecision.status === 'TERMINATE') {
          caseRecord.currentState = 'TERMINATED';
          caseRecord.decisionReason = `Replan terminated: ${replanDecision.reason}`;
          db.saveCase(caseRecord);
          const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0, caseRecord.decisionReason);
          db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
          break;
        } else {
          caseRecord.currentState = 'ESCALATED';
          caseRecord.decisionReason = `Replan exhausted safe alternatives: ${replanDecision.reason}`;
          db.saveCase(caseRecord);
          const escInfo = escalateToHuman(caseRecord.caseId, `Replan failed: ${replanDecision.reason}`, 'HIGH');
          db.addAuditLog(caseRecord.caseId, 'ESCALATE', escInfo, simTime);
          break;
        }
      }
    } else if (!decision.passed && caseRecord.isControlGroup) {
      // Control group holdout baseline (Rule 7)
    }

    // STEP 5: ACT (Execute Bounded Tool via Simulator)
    if (!caseRecord.isControlGroup) {
      if (finalProposal.toolName === 'close_case') {
        caseRecord.currentState = 'TERMINATED';
        db.saveCase(caseRecord);
        const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0, finalProposal.decisionReason);
        db.addAuditLog(
          caseRecord.caseId,
          'CLOSE',
          {
            ...closeInfo,
            decision_reason: finalProposal.decisionReason
          },
          simTime
        );
        break;
      }

      if (finalProposal.toolName === 'escalate_to_human') {
        caseRecord.currentState = 'ESCALATED';
        db.saveCase(caseRecord);
        const escInfo = escalateToHuman(caseRecord.caseId, finalProposal.decisionReason, 'HIGH');
        db.addAuditLog(
          caseRecord.caseId,
          'ESCALATE',
          {
            ...escInfo,
            decision_reason: finalProposal.decisionReason
          },
          simTime
        );
        break;
      }

      const custName = `Customer ${customer.customerId.split('_').slice(-1)[0] || 'User'}`;
      executeRecoveryAction(
        db,
        caseRecord,
        finalActionPlan,
        custName,
        event.amount,
        finalActionPlan.actionTime
      );
      lastActTime = finalActionPlan.actionTime;
      simTime = new Date(finalActionPlan.actionTime.getTime() + 2 * 3600 * 1000);
    } else {
      caseRecord.loopIterations += 1;
      caseRecord.currentState = 'ACT';
      db.saveCase(caseRecord);
      simTime = new Date(simTime.getTime() + 2 * 3600 * 1000);
    }

    // STEP 6: OBSERVE_OUTCOME
    caseRecord.currentState = 'OBSERVE_OUTCOME';
    const isResolved = outcome ? outcome.resolved : false;

    if (isResolved) {
      caseRecord.currentState = 'RESOLVED';
      caseRecord.totalRecoveredAmount = outcome ? outcome.resolvedAmount : event.amount;
      if (caseRecord.invoiceContext?.ptpDate) {
        caseRecord.invoiceContext.ptpStatus = 'FULFILLED';
        caseRecord.decisionReason = `Promise-to-Pay fulfilled! Outstanding commercial invoice of ₹${caseRecord.totalRecoveredAmount.toLocaleString('en-IN')} paid in full on or before agreed date (${caseRecord.invoiceContext.ptpDate}).`;
      } else {
        caseRecord.decisionReason = `Revenue of ₹${caseRecord.totalRecoveredAmount.toLocaleString('en-IN')} successfully recovered via ${outcome?.resolutionChannel || finalActionPlan.channel}. Case resolved.`;
      }
      db.saveCase(caseRecord);
      const closeInfo = closeCase(caseRecord.caseId, 'RESOLVED', caseRecord.totalRecoveredAmount, caseRecord.decisionReason);
      db.addAuditLog(
        caseRecord.caseId,
        'OBSERVE_OUTCOME',
        {
          outcome: 'RESOLVED',
          decision_reason: caseRecord.decisionReason,
          recovered_amount: caseRecord.totalRecoveredAmount,
          resolution_channel: outcome?.resolutionChannel || finalActionPlan.channel,
          ptp_status: caseRecord.invoiceContext?.ptpStatus
        },
        simTime
      );
      db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
      break;
    } else {
      // STEP 7: DECIDE_NEXT
      caseRecord.currentState = 'DECIDE_NEXT';
      if (caseRecord.invoiceContext?.ptpDate && caseRecord.invoiceContext.ptpStatus === 'LOGGED') {
        caseRecord.invoiceContext.ptpStatus = 'BROKEN';
      }
      if (caseRecord.currentAttempt >= caseRecord.maxAttempts || caseRecord.isControlGroup) {
        caseRecord.currentState = 'TERMINATED';
        caseRecord.decisionReason = caseRecord.isControlGroup
          ? 'Control group holdout baseline completed (unintervened comparison).'
          : `Maximum retry attempts exhausted (${caseRecord.currentAttempt}/${caseRecord.maxAttempts}). Safely stopping intervention to protect customer goodwill.`;
        db.saveCase(caseRecord);
        const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0, caseRecord.decisionReason);
        db.addAuditLog(
          caseRecord.caseId,
          'OBSERVE_OUTCOME',
          {
            outcome: 'UNRESOLVED',
            decision_reason: caseRecord.decisionReason,
            status: 'Attempts exhausted or control baseline recorded'
          },
          simTime
        );
        db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
        break;
      } else {
        db.addAuditLog(
          caseRecord.caseId,
          'OBSERVE_OUTCOME',
          {
            outcome: 'UNRESOLVED',
            attempts_used: caseRecord.currentAttempt,
            decision_reason: `Attempt ${caseRecord.currentAttempt} did not immediately settle. Looping back to Gemini with tool outcome for adaptive next-action selection.`
          },
          simTime
        );
      }
    }
  }

  return caseRecord;
}
