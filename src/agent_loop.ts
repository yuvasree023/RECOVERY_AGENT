import { Database } from './models.js';
import { RecoveryCaseRecord, GuardrailContext } from './types.js';
import { evaluateGuardrails } from './guardrails.js';
import { classifyDecline, getRecoveryScorer } from './diagnosis.js';
import { calculateNextActionTime } from './intervention.js';
import { generateAgentPlan } from './llm_agent.js';
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

  // STEP 1: OBSERVE (Pre-flight check)
  if (outcome && outcome.resolved && outcome.resolutionTimestamp && outcome.resolutionTimestamp.getTime() <= event.timestamp.getTime()) {
    caseRecord.currentState = 'RESOLVED';
    caseRecord.totalRecoveredAmount = outcome.resolvedAmount;
    db.saveCase(caseRecord);
    db.addAuditLog(
      caseRecord.caseId,
      'OBSERVE',
      {
        pre_flight_check: 'ALREADY_RESOLVED',
        message: 'Payment resolved prior to agent intervention. Closing case.'
      },
      simTime
    );
    return caseRecord;
  }

  // Main Bounded Agent Loop
  while (caseRecord.currentState !== 'RESOLVED' && caseRecord.currentState !== 'TERMINATED' && caseRecord.currentState !== 'ESCALATED') {
    // Safety circuit breaker check on the loop itself
    if (caseRecord.loopIterations >= caseRecord.maxLoopIterations) {
      caseRecord.currentState = 'ESCALATED';
      db.saveCase(caseRecord);
      const escRes = escalateToHuman(caseRecord.caseId, 'Loop iteration limit reached (circuit breaker).');
      db.addAuditLog(caseRecord.caseId, 'ESCALATE', escRes, simTime);
      break;
    }

    // STEP 2: REASON
    const declineDiagnosis = classifyDecline(event.declineCode);
    const recoveryProb = scorer.predictProbability(
      customer.segment,
      customer.ltv,
      event.declineCode,
      caseRecord.currentAttempt + 1,
      event.eventType
    );
    caseRecord.recoveryProbability = recoveryProb;
    caseRecord.currentState = 'DIAGNOSED';
    db.saveCase(caseRecord);

    db.addAuditLog(
      caseRecord.caseId,
      'REASON',
      {
        decline_code: event.declineCode,
        diagnosis: declineDiagnosis,
        recovery_probability: recoveryProb,
        model: 'LogisticRegression ML Scorer (time-split)'
      },
      simTime
    );

    // STEP 3: PLAN (LLM Autonomous Agent ReAct)
    const agentContext = {
      declineCode: event.declineCode,
      segment: customer.segment,
      whatsappConsent: customer.whatsappConsent,
      eventType: event.eventType,
      amount: event.amount,
      attemptNumber: caseRecord.currentAttempt + 1
    };
    const llmProposal = generateAgentPlan(agentContext, recoveryProb);

    const nextActionTime = calculateNextActionTime(
      simTime,
      event.retryCooldownHours,
      llmProposal.toolArgs.channel
    );

    const actionPlan = {
      channel: llmProposal.toolArgs.channel,
      actionTime: nextActionTime,
      actionType: llmProposal.toolArgs.actionType,
      templateKey: llmProposal.toolArgs.templateKey,
      discountPct: llmProposal.toolArgs.discountPct
    };

    caseRecord.currentState = 'SCHEDULED';
    db.saveCase(caseRecord);

    db.addAuditLog(
      caseRecord.caseId,
      'PLAN',
      {
        llm_thought: llmProposal.thought,
        proposed_tool: llmProposal.toolName,
        channel: actionPlan.channel,
        action_type: actionPlan.actionType,
        scheduled_time: actionPlan.actionTime.toISOString(),
        template_key: actionPlan.templateKey,
        discount_pct: actionPlan.discountPct
      },
      simTime
    );

    // STEP 4: GUARDRAIL_CHECK (LLM Proposes, Guardrail Disposes)
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
      proposedActionTime: finalActionPlan.actionTime
    };

    let decision = evaluateGuardrails(gCtx);

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
        db.saveCase(caseRecord);
        const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0);
        db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
        break;
      }

      db.addAuditLog(
        caseRecord.caseId,
        'GUARDRAIL_FAIL',
        {
          rejected_plan: finalProposal.toolName,
          rejected_channel: finalActionPlan.channel,
          rejection_reason: decision.reason,
          action: 'Invoking LLM Replan Loop with guardrail rejection feedback'
        },
        simTime
      );

      const replanProposal = generateAgentPlan(agentContext, recoveryProb, decision.reason);
      const replanActionTime = calculateNextActionTime(
        simTime,
        event.retryCooldownHours,
        replanProposal.toolArgs.channel
      );

      const replanActionPlan = {
        channel: replanProposal.toolArgs.channel,
        actionTime: replanActionTime,
        actionType: replanProposal.toolArgs.actionType,
        templateKey: replanProposal.toolArgs.templateKey,
        discountPct: replanProposal.toolArgs.discountPct
      };

      db.addAuditLog(
        caseRecord.caseId,
        'REPLAN',
        {
          llm_thought: replanProposal.thought,
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
          db.saveCase(caseRecord);
          const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0);
          db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
          break;
        } else {
          caseRecord.currentState = 'ESCALATED';
          db.saveCase(caseRecord);
          const escInfo = escalateToHuman(caseRecord.caseId, `Replan failed: ${replanDecision.reason}`);
          db.addAuditLog(caseRecord.caseId, 'ESCALATE', escInfo, simTime);
          break;
        }
      }
    } else if (!decision.passed && caseRecord.isControlGroup) {
      // Control group holdout baseline
    }

    // STEP 5: ACT (Skipped for control group)
    if (!caseRecord.isControlGroup) {
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
      db.saveCase(caseRecord);
      simTime = new Date(simTime.getTime() + 2 * 3600 * 1000);
    }

    // STEP 6: OBSERVE_OUTCOME
    const isResolved = outcome ? outcome.resolved : false;

    if (isResolved) {
      caseRecord.currentState = 'RESOLVED';
      caseRecord.totalRecoveredAmount = outcome ? outcome.resolvedAmount : event.amount;
      db.saveCase(caseRecord);
      const closeInfo = closeCase(caseRecord.caseId, 'RESOLVED', caseRecord.totalRecoveredAmount);
      db.addAuditLog(
        caseRecord.caseId,
        'OBSERVE_OUTCOME',
        {
          outcome: 'RESOLVED',
          recovered_amount: caseRecord.totalRecoveredAmount,
          resolution_channel: outcome?.resolutionChannel || actionPlan.channel
        },
        simTime
      );
      db.addAuditLog(caseRecord.caseId, 'CLOSE', closeInfo, simTime);
      break;
    } else {
      if (caseRecord.currentAttempt >= caseRecord.maxAttempts || caseRecord.isControlGroup) {
        caseRecord.currentState = 'TERMINATED';
        db.saveCase(caseRecord);
        const closeInfo = closeCase(caseRecord.caseId, 'TERMINATED', 0.0);
        db.addAuditLog(
          caseRecord.caseId,
          'OBSERVE_OUTCOME',
          {
            outcome: 'UNRESOLVED',
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
            action: 'Looping back for next retry attempt'
          },
          simTime
        );
      }
    }
  }

  return caseRecord;
}
