import { GuardrailContext, GuardrailDecision } from './types.js';

export function checkDndWindow(dt: Date, dndStartHour: number = 21, dndEndHour: number = 8): boolean {
  const hour = dt.getHours();
  const minute = dt.getMinutes();
  const timeFloat = hour + minute / 60.0;
  // DND from 21:00 (inclusive) to 08:00 (exclusive)
  if (timeFloat >= dndStartHour || timeFloat < dndEndHour) {
    return true;
  }
  return false;
}

export function evaluateGuardrails(ctx: GuardrailContext): GuardrailDecision {
  // Rule 1: Customer Opt-Out Check
  if (ctx.optOutStatus) {
    return {
      passed: false,
      status: 'TERMINATE',
      violatedRule: 1,
      reason: 'Customer has opted out of communications (opt_out_status=True).'
    };
  }

  // Rule 2: Fraud Score Check
  if (ctx.fraudScore > 0.8) {
    return {
      passed: false,
      status: 'TERMINATE',
      violatedRule: 2,
      reason: `Fraud score (${ctx.fraudScore.toFixed(2)}) exceeds threshold 0.80.`,
      flagManualReview: true
    };
  }

  // Rule 3: Contact Attempts Exhaustion
  if (ctx.currentAttempt >= ctx.maxAttempts) {
    return {
      passed: false,
      status: 'TERMINATE',
      violatedRule: 3,
      reason: `Maximum contact attempts reached (${ctx.currentAttempt}/${ctx.maxAttempts}).`
    };
  }

  // Rule 4: Reasoning Loop Iteration Circuit Breaker
  if (ctx.loopIterations >= ctx.maxLoopIterations) {
    return {
      passed: false,
      status: 'ESCALATE',
      violatedRule: 4,
      reason: `Agent loop iteration limit exceeded (${ctx.loopIterations}/${ctx.maxLoopIterations}). Circuit breaker tripped.`
    };
  }

  // Rule 5: Contact Cooldown Violation
  if (ctx.lastActTimestamp !== null && ctx.proposedActionTime !== null) {
    const elapsedSeconds = (ctx.proposedActionTime.getTime() - ctx.lastActTimestamp.getTime()) / 1000;
    const requiredSeconds = ctx.retryCooldownHours * 3600;
    if (elapsedSeconds < requiredSeconds) {
      return {
        passed: false,
        status: 'BLOCK_ACT',
        violatedRule: 5,
        reason: `Contact cooldown active. Elapsed: ${(elapsedSeconds / 3600).toFixed(1)}h, Required: ${ctx.retryCooldownHours}h.`
      };
    }
  }

  // Rule 6: DND Window Check for WhatsApp and SMS
  if ((ctx.channel === 'WhatsApp' || ctx.channel === 'SMS') && ctx.proposedActionTime !== null) {
    if (checkDndWindow(ctx.proposedActionTime)) {
      const hoursStr = String(ctx.proposedActionTime.getHours()).padStart(2, '0');
      const minsStr = String(ctx.proposedActionTime.getMinutes()).padStart(2, '0');
      return {
        passed: false,
        status: 'BLOCK_ACT',
        violatedRule: 6,
        reason: `Proposed send time ${hoursStr}:${minsStr} falls inside DND window (21:00 - 08:00) for ${ctx.channel}.`
      };
    }
  }

  // Rule 7: Control Group Isolation
  if (ctx.isControlGroup) {
    return {
      passed: false,
      status: 'BLOCK_ACT',
      violatedRule: 7,
      reason: 'Case is assigned to control group. No active intervention allowed.'
    };
  }

  // All 7 rules passed
  return {
    passed: true,
    status: 'PROCEED',
    violatedRule: null,
    reason: 'All 7 guardrails passed.'
  };
}
