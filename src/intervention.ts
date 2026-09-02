import { checkDndWindow } from './guardrails.js';
import { InterventionStrategy } from './types.js';

export const TEMPLATES: Record<string, { templateId: string; text: string }> = {
  PAYMENT_RETRY: {
    templateId: 'TPL_PAY_RETRY_01',
    text: 'Hi {customer_name}, your payment of INR {amount} was not completed due to {reason}. We have scheduled a retry at {retry_time}. Complete it instantly here: https://rzp.io/i/{event_id}'
  },
  CARD_EXPIRED: {
    templateId: 'TPL_CARD_EXP_01',
    text: 'Hi {customer_name}, your payment method for INR {amount} has expired. Please update your card details securely: https://rzp.io/pay/{event_id}'
  },
  INSUFFICIENT_FUNDS: {
    templateId: 'TPL_FUNDS_RETRY_01',
    text: 'Hi {customer_name}, your transaction of INR {amount} could not be processed. We will retry on {retry_time}. Pay now directly: https://rzp.io/i/{event_id}'
  },
  CART_DISCOUNT: {
    templateId: 'TPL_CART_DISC_01',
    text: 'Hi {customer_name}, complete your purchase of INR {amount} with an exclusive {discount_pct}% discount! Use code {coupon_code}: https://rzp.io/cart/{event_id}'
  },
  CART_REMINDER: {
    templateId: 'TPL_CART_REM_01',
    text: 'Hi {customer_name}, your items worth INR {amount} are waiting in your cart. Finish your checkout here: https://rzp.io/cart/{event_id}'
  }
};

export function selectChannel(segment: string, whatsappConsent: boolean): string {
  if (segment === 'High' && whatsappConsent) {
    return 'WhatsApp';
  } else if (segment === 'Low') {
    return 'SMS';
  } else {
    return 'Email';
  }
}

export function calculateNextActionTime(
  currentTime: Date,
  retryCooldownHours: number,
  channel: string
): Date {
  const nextTime = new Date(currentTime.getTime() + retryCooldownHours * 3600 * 1000);

  if (channel === 'WhatsApp' || channel === 'SMS') {
    if (checkDndWindow(nextTime)) {
      const hours = nextTime.getHours();
      if (hours >= 21) {
        // Push forward to 08:00 next day
        const nextDay = new Date(nextTime);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(8, 0, 0, 0);
        return nextDay;
      } else if (hours < 8) {
        // Push to 08:00 same day
        const sameDay = new Date(nextTime);
        sameDay.setHours(8, 0, 0, 0);
        return sameDay;
      }
    }
  }

  return nextTime;
}

export function selectInterventionStrategy(
  eventType: string,
  declineCode: string,
  segment: string,
  whatsappConsent: boolean,
  amount: number,
  currentTime: Date,
  retryCooldownHours: number,
  attemptNumber: number
): InterventionStrategy {
  const channel = selectChannel(segment, whatsappConsent);
  const actionTime = calculateNextActionTime(currentTime, retryCooldownHours, channel);

  let templateKey = 'PAYMENT_RETRY';
  let actionType: 'SCHEDULE_RETRY' | 'SEND_MESSAGE' | 'OFFER_DISCOUNT' = 'SCHEDULE_RETRY';
  let discountPct = 0;

  if (eventType === 'CART_ABANDON') {
    if (declineCode === 'HIGH_SHIPPING_COST' || attemptNumber >= 2) {
      templateKey = 'CART_DISCOUNT';
      actionType = 'OFFER_DISCOUNT';
      discountPct = 10.0;
    } else {
      templateKey = 'CART_REMINDER';
      actionType = 'SEND_MESSAGE';
      discountPct = 0.0;
    }
  } else if (declineCode === 'CARD_EXPIRED') {
    templateKey = 'CARD_EXPIRED';
    actionType = 'SEND_MESSAGE';
    discountPct = 0.0;
  } else if (declineCode === 'INSUFFICIENT_FUNDS') {
    templateKey = 'INSUFFICIENT_FUNDS';
    actionType = 'SCHEDULE_RETRY';
    discountPct = 0.0;
  } else {
    templateKey = 'PAYMENT_RETRY';
    actionType = 'SCHEDULE_RETRY';
    discountPct = 0.0;
  }

  return {
    channel,
    actionTime,
    actionType,
    templateKey,
    templateId: TEMPLATES[templateKey]?.templateId || 'TPL_PAY_RETRY_01',
    discountPct
  };
}

export function renderMessage(templateKey: string, variables: Record<string, any>): string {
  const templateSpec = TEMPLATES[templateKey] || TEMPLATES['PAYMENT_RETRY'];
  let text = templateSpec.text;

  const defaults: Record<string, any> = {
    customer_name: 'Customer',
    amount: (variables.amount !== undefined ? Number(variables.amount).toFixed(2) : '0.00'),
    reason: 'a technical error',
    retry_time: 'shortly',
    event_id: '',
    discount_pct: 10,
    coupon_code: 'RECOVER10'
  };

  const merged = { ...defaults, ...variables };

  if (typeof merged.amount === 'number') {
    merged.amount = merged.amount.toFixed(2);
  }

  for (const [k, v] of Object.entries(merged)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }

  return text;
}
