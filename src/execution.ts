import { Database } from './models.js';
import { RecoveryCaseRecord, InterventionStrategy } from './types.js';
import { scheduleRetry, sendMessage, offerDiscount, CHANNEL_COSTS } from './mock_services.js';
import { renderMessage } from './intervention.js';

export function executeRecoveryAction(
  db: Database,
  caseRecord: RecoveryCaseRecord,
  actionPlan: InterventionStrategy,
  customerName: string,
  eventAmount: number,
  currentSimTime: Date
) {
  const channel = actionPlan.channel;
  const actionType = actionPlan.actionType;
  const templateKey = actionPlan.templateKey;
  const templateId = actionPlan.templateId;
  const discountPct = actionPlan.discountPct || 0;

  // 1. Fetch channel cost
  const costRecord = db.getChannelCost(channel);
  const costPerSend = costRecord ? costRecord.costPerSend : (CHANNEL_COSTS[channel] || 0.05);

  // 2. Render message
  const retryTimeStr = `${actionPlan.actionTime.getDate()} ${actionPlan.actionTime.toLocaleString('en-US', { month: 'short' })} ${String(actionPlan.actionTime.getHours()).padStart(2, '0')}:${String(actionPlan.actionTime.getMinutes()).padStart(2, '0')}`;
  const messageVars = {
    customer_name: customerName,
    amount: eventAmount,
    reason: 'transaction decline',
    retry_time: retryTimeStr,
    event_id: caseRecord.eventId,
    discount_pct: Math.floor(discountPct),
    coupon_code: discountPct > 0 ? `RECOVER${Math.floor(discountPct)}` : ''
  };
  const renderedBody = renderMessage(templateKey, messageVars);

  // 3. Call tool
  const toolResult: Record<string, any> = {};
  if (actionType === 'OFFER_DISCOUNT') {
    toolResult.discount = offerDiscount(caseRecord.caseId, discountPct);
    toolResult.message = sendMessage(caseRecord.caseId, channel, templateId, messageVars, costPerSend);
  } else if (actionType === 'SCHEDULE_RETRY') {
    toolResult.retry = scheduleRetry(caseRecord.caseId, actionPlan.actionTime, 2);
    toolResult.message = sendMessage(caseRecord.caseId, channel, templateId, messageVars, costPerSend);
  } else {
    toolResult.message = sendMessage(caseRecord.caseId, channel, templateId, messageVars, costPerSend);
  }

  // 4. Update case state
  caseRecord.currentAttempt += 1;
  caseRecord.loopIterations += 1;
  caseRecord.totalCostIncurred += costPerSend;
  caseRecord.currentState = 'EXECUTED';
  caseRecord.nextActionTime = actionPlan.actionTime;
  db.saveCase(caseRecord);

  // 5. Audit log
  db.addAuditLog(
    caseRecord.caseId,
    'ACT',
    {
      action_type: actionType,
      channel,
      template_id: templateId,
      cost_incurred: costPerSend,
      rendered_message: renderedBody,
      tool_response: toolResult,
      attempt: caseRecord.currentAttempt,
      iteration: caseRecord.loopIterations
    },
    currentSimTime
  );

  return {
    status: 'SUCCESS',
    action_type: actionType,
    channel,
    cost_incurred: costPerSend,
    tool_result: toolResult
  };
}
