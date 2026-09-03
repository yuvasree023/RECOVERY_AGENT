import path from 'path';
import crypto from 'crypto';
import { parseCSV } from './csv_parser.js';
import {
  Customer,
  EventRecord,
  OutcomeRecord,
  ChannelCostRecord,
  RecoveryCaseRecord,
  AuditLogRecord,
  AuditStep,
  CaseState
} from './types.js';

export class Database {
  customers: Map<string, Customer> = new Map();
  events: Map<string, EventRecord> = new Map();
  outcomes: Map<string, OutcomeRecord> = new Map();
  channelCosts: Map<string, ChannelCostRecord> = new Map();
  cases: Map<string, RecoveryCaseRecord> = new Map();
  auditLogs: AuditLogRecord[] = [];

  constructor() {}

  reset() {
    this.customers.clear();
    this.events.clear();
    this.outcomes.clear();
    this.channelCosts.clear();
    this.cases.clear();
    this.auditLogs = [];
  }

  loadCsvData(dataDir: string = 'data') {
    // 1. Customers
    const custRows = parseCSV(path.join(dataDir, 'customers.csv'));
    for (const row of custRows) {
      if (!this.customers.has(row.customer_id)) {
        this.customers.set(row.customer_id, {
          customerId: row.customer_id,
          segment: row.segment || 'Low',
          ltv: parseFloat(row.ltv) || 0,
          whatsappConsent: row.whatsapp_consent?.toLowerCase() === 'true',
          optOutStatus: row.opt_out_status?.toLowerCase() === 'true'
        });
      }
    }

    // 2. Channel Costs
    const costRows = parseCSV(path.join(dataDir, 'channel_cost.csv'));
    for (const row of costRows) {
      if (!this.channelCosts.has(row.channel)) {
        this.channelCosts.set(row.channel, {
          channel: row.channel,
          costPerSend: parseFloat(row.cost_per_send) || 0.05,
          avgResponseTimeHours: parseInt(row.avg_response_time_hours) || 2,
          dndStart: row.dnd_start || null,
          dndEnd: row.dnd_end || null
        });
      }
    }

    // 3. Events
    const eventRows = parseCSV(path.join(dataDir, 'events.csv'));
    for (const row of eventRows) {
      if (!this.events.has(row.event_id)) {
        this.events.set(row.event_id, {
          eventId: row.event_id,
          customerId: row.customer_id,
          eventType: row.event_type,
          amount: parseFloat(row.amount) || 0,
          status: row.status || 'FAILED',
          timestamp: new Date(row.timestamp),
          declineCode: row.decline_code,
          attemptNumber: parseInt(row.attempt_number) || 1,
          fraudScore: parseFloat(row.fraud_score) || 0,
          retryCooldownHours: parseInt(row.retry_cooldown_hours) || 2,
          ptpDate: row.ptp_date ? row.ptp_date : null
        });
      }
    }

    // 4. Outcomes
    const outcomeRows = parseCSV(path.join(dataDir, 'outcomes.csv'));
    for (const row of outcomeRows) {
      if (!this.outcomes.has(row.event_id)) {
        this.outcomes.set(row.event_id, {
          eventId: row.event_id,
          resolved: row.resolved?.toLowerCase() === 'true',
          resolutionChannel: row.resolution_channel ? row.resolution_channel : null,
          resolvedAmount: parseFloat(row.resolved_amount) || 0,
          resolutionTimestamp: row.resolution_timestamp ? new Date(row.resolution_timestamp) : null
        });
      }
    }
  }

  getCaseByEventId(eventId: string): RecoveryCaseRecord | undefined {
    for (const c of this.cases.values()) {
      if (c.eventId === eventId) return c;
    }
    return undefined;
  }

  getCase(caseId: string): RecoveryCaseRecord | undefined {
    return this.cases.get(caseId);
  }

  saveCase(caseRecord: RecoveryCaseRecord) {
    this.cases.set(caseRecord.caseId, caseRecord);
  }

  createCase(eventId: string, customerId: string, isControlGroup: boolean = false): RecoveryCaseRecord {
    const caseId = `case_${crypto.randomUUID().substring(0, 8)}`;
    const newCase: RecoveryCaseRecord = {
      caseId,
      eventId,
      customerId,
      isControlGroup,
      currentState: 'OBSERVE',
      currentAttempt: 0,
      maxAttempts: 3,
      loopIterations: 0,
      maxLoopIterations: 5,
      totalCostIncurred: 0,
      totalRecoveredAmount: 0,
      recoveryProbability: null,
      lastActTimestamp: null,
      nextActionTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      previousActions: [],
      availableActions: [
        'schedule_payment_retry',
        'send_recovery_message',
        'offer_recovery_discount',
        'log_promise_to_pay',
        'escalate_to_human',
        'close_case'
      ]
    };
    this.cases.set(caseId, newCase);
    return newCase;
  }

  getEvent(eventId: string): EventRecord | undefined {
    return this.events.get(eventId);
  }

  saveEvent(eventRecord: EventRecord) {
    this.events.set(eventRecord.eventId, eventRecord);
  }

  getCustomer(customerId: string): Customer | undefined {
    return this.customers.get(customerId);
  }

  saveCustomer(customerRecord: Customer) {
    this.customers.set(customerRecord.customerId, customerRecord);
  }

  getOutcome(eventId: string): OutcomeRecord | undefined {
    return this.outcomes.get(eventId);
  }

  saveOutcome(outcomeRecord: OutcomeRecord) {
    this.outcomes.set(outcomeRecord.eventId, outcomeRecord);
  }

  getChannelCost(channel: string): ChannelCostRecord | undefined {
    return this.channelCosts.get(channel);
  }

  addAuditLog(caseId: string, step: AuditStep, detail: any, timestamp: Date = new Date()): AuditLogRecord {
    const log: AuditLogRecord = {
      logId: crypto.randomUUID(),
      caseId,
      timestamp,
      step,
      detail
    };
    this.auditLogs.push(log);
    return log;
  }

  getAuditLogs(caseId: string): AuditLogRecord[] {
    return this.auditLogs
      .filter(l => l.caseId === caseId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  getAllCases(): RecoveryCaseRecord[] {
    return Array.from(this.cases.values());
  }
}

// Global Singleton Database
export const db = new Database();
