import path from 'path';
import { parseCSV } from './csv_parser.js';
import { DeclineDiagnosis } from './types.js';

export const DECLINE_CODE_MAP: Record<string, DeclineDiagnosis> = {
  NETWORK_TIMEOUT: {
    rootCause: 'TECHNICAL_GLITCH',
    retryStrategy: 'COOLDOWN_RETRY',
    description: 'Network timeout or bank gateway downtime. Recommended action: retry after cooldown.'
  },
  INSUFFICIENT_FUNDS: {
    rootCause: 'CASH_FLOW_ISSUE',
    retryStrategy: 'SCHEDULED_RETRY',
    description: 'Insufficient funds in customer account. Recommended action: schedule retry with notification.'
  },
  CARD_EXPIRED: {
    rootCause: 'OUTDATED_PAYMENT_METHOD',
    retryStrategy: 'UPDATE_INSTRUMENT',
    description: 'Payment card expired. Recommended action: prompt customer to update payment details.'
  },
  HIGH_SHIPPING_COST: {
    rootCause: 'CHECKOUT_FRICTION',
    retryStrategy: 'INCENTIVE_DISCOUNT',
    description: 'Checkout abandoned due to shipping cost. Recommended action: offer shipping discount or fee waiver.'
  }
};

export function classifyDecline(declineCode: string): DeclineDiagnosis {
  return DECLINE_CODE_MAP[declineCode] || {
    rootCause: 'UNKNOWN_ERROR',
    retryStrategy: 'MANUAL_REVIEW',
    description: `Unrecognized decline code: ${declineCode}`
  };
}

export class RecoveryScorer {
  private isTrained = false;
  private weights: number[] = [];
  private bias: number = 0;
  private numMeans: number[] = [0, 0]; // ltv, attemptNumber
  private numStds: number[] = [1, 1];
  private featureNames: string[] = [];

  constructor(private dataDir: string = 'data') {}

  private extractFeatures(
    segment: string,
    ltv: number,
    declineCode: string,
    attemptNumber: number,
    eventType: string
  ): number[] {
    // 1. Normalized numeric features
    const normLtv = this.numStds[0] > 0 ? (ltv - this.numMeans[0]) / this.numStds[0] : 0;
    const normAttempt = this.numStds[1] > 0 ? (attemptNumber - this.numMeans[1]) / this.numStds[1] : 0;

    const vec: number[] = [normLtv, normAttempt];

    // 2. One-hot categories
    const segments = ['High', 'Medium', 'Low'];
    const declines = ['NETWORK_TIMEOUT', 'INSUFFICIENT_FUNDS', 'CARD_EXPIRED', 'HIGH_SHIPPING_COST'];
    const eventTypes = ['UPI_PAYMENT_FAIL', 'CART_ABANDON', 'SUBSCRIPTION_FAIL'];

    for (const s of segments) vec.push(segment === s ? 1 : 0);
    for (const d of declines) vec.push(declineCode === d ? 1 : 0);
    for (const e of eventTypes) vec.push(eventType === e ? 1 : 0);

    return vec;
  }

  train() {
    const custRows = parseCSV(path.join(this.dataDir, 'customers.csv'));
    const evtRows = parseCSV(path.join(this.dataDir, 'events.csv'));
    const outRows = parseCSV(path.join(this.dataDir, 'outcomes.csv'));

    const custMap = new Map(custRows.map(c => [c.customer_id, c]));
    const outMap = new Map(outRows.map(o => [o.event_id, o]));

    const splitDate = new Date('2024-12-01T00:00:00Z').getTime();

    const trainSamples: {
      segment: string;
      ltv: number;
      declineCode: string;
      attemptNumber: number;
      eventType: string;
      y: number;
    }[] = [];

    for (const e of evtRows) {
      const ts = new Date(e.timestamp).getTime();
      if (ts < splitDate) {
        const cust = custMap.get(e.customer_id);
        const outcome = outMap.get(e.event_id);
        if (cust && outcome) {
          trainSamples.push({
            segment: cust.segment || 'Low',
            ltv: parseFloat(cust.ltv) || 0,
            declineCode: e.decline_code || 'NETWORK_TIMEOUT',
            attemptNumber: parseInt(e.attempt_number) || 1,
            eventType: e.event_type || 'UPI_PAYMENT_FAIL',
            y: outcome.resolved?.toLowerCase() === 'true' ? 1 : 0
          });
        }
      }
    }

    if (trainSamples.length === 0) {
      this.isTrained = true;
      return;
    }

    // Compute means and standard deviations for numeric features
    const ltvs = trainSamples.map(s => s.ltv);
    const attempts = trainSamples.map(s => s.attemptNumber);

    this.numMeans[0] = ltvs.reduce((a, b) => a + b, 0) / ltvs.length;
    this.numMeans[1] = attempts.reduce((a, b) => a + b, 0) / attempts.length;

    this.numStds[0] = Math.sqrt(ltvs.reduce((a, b) => a + Math.pow(b - this.numMeans[0], 2), 0) / ltvs.length) || 1;
    this.numStds[1] = Math.sqrt(attempts.reduce((a, b) => a + Math.pow(b - this.numMeans[1], 2), 0) / attempts.length) || 1;

    // Build design matrix X and target y
    const X: number[][] = [];
    const y: number[] = [];

    for (const s of trainSamples) {
      X.push(this.extractFeatures(s.segment, s.ltv, s.declineCode, s.attemptNumber, s.eventType));
      y.push(s.y);
    }

    const nFeatures = X[0].length;
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    // Train with Logistic Regression Gradient Descent (L2 regularization)
    const lr = 0.05;
    const l2 = 0.01;
    const epochs = 500;
    const m = X.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradW = new Array(nFeatures).fill(0);
      let gradB = 0;

      for (let i = 0; i < m; i++) {
        let z = this.bias;
        for (let j = 0; j < nFeatures; j++) {
          z += this.weights[j] * X[i][j];
        }
        const pred = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
        const error = pred - y[i];

        for (let j = 0; j < nFeatures; j++) {
          gradW[j] += (error * X[i][j]) / m;
        }
        gradB += error / m;
      }

      for (let j = 0; j < nFeatures; j++) {
        this.weights[j] -= lr * (gradW[j] + l2 * this.weights[j]);
      }
      this.bias -= lr * gradB;
    }

    this.isTrained = true;
  }

  predictProbability(
    segment: string,
    ltv: number,
    declineCode: string,
    attemptNumber: number,
    eventType: string
  ): number {
    if (!this.isTrained) {
      this.train();
    }

    const vec = this.extractFeatures(segment, ltv, declineCode, attemptNumber, eventType);
    let z = this.bias;
    for (let i = 0; i < vec.length; i++) {
      z += (this.weights[i] || 0) * vec[i];
    }
    const prob = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
    return Math.round(prob * 10000) / 10000;
  }
}

let globalScorer: RecoveryScorer | null = null;

export function getRecoveryScorer(dataDir: string = 'data'): RecoveryScorer {
  if (!globalScorer) {
    globalScorer = new RecoveryScorer(dataDir);
    globalScorer.train();
  }
  return globalScorer;
}
