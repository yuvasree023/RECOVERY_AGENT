# Recover — AI Revenue Recovery Engine

**Autonomous, Multi-Turn, Outcome-Aware AI Agent for Revenue Recovery**

Recover is an autonomous, bounded revenue-recovery engine that diagnoses transaction drop-offs, selects compliant interventions, enforces safety guardrails, and executes multi-channel recovery workflows with an immutable audit trail.

Built with **Gemini as the AI Agent Brain** and coupled with **deterministic fail-closed guardrails**, Recover eliminates hardcoded menu routers in favor of dynamic reasoning, continuous outcome observation, and autonomous replanning.

---

## 1. Executive Summary & Measured Batch Impact

Recover was evaluated in a historical replay simulation across **223 transactions** with a randomized, seeded **20% control group (A/B baseline)**:

```
===========================================================================
                RECOVER — BATCH REVENUE RECOVERY REPORT
===========================================================================
 Total Events Processed:        223
 Treatment Cohort:              178 cases (80%)
 Control Cohort (Baseline):     45 cases (20%)
---------------------------------------------------------------------------
 Treatment Resolution Rate:     26.97%
 Control Baseline Rate:         17.78%
 Incremental Recovery Lift:     +9.19% percentage points
---------------------------------------------------------------------------
 Gross Recovered Revenue:       INR 120,669.00
 Total Channel Costs Incurred:  INR 65.70
 NET RECOVERED REVENUE:         INR 120,603.30
 Recovery ROI Multiple:         1,835.7x
 Compliance Violations:         0 (100% Guardrail Compliant)
 Escalation Rate:               0.00%
 Termination Rate:              73.03%
===========================================================================
```

### Breakdown by Recovery Playbook
| Playbook | Description | Primary Mechanisms | Resolution Rate |
|---|---|---|---|
| **Payment Failure Recovery** | UPI & Card declines | Intelligent retry scheduling, Smart Payment Links via WhatsApp/SMS/Email | ~25.0% |
| **Checkout Abandonment** | Cart drop-offs & shipping friction | Basket reminders, inventory reservations, margin-capped discount incentives (≤20%) | ~30.3% |
| **B2B Overdue Invoices** | Commercial receivables & B2B dunning | Statement reminders, Promise-to-Pay (PTP) commitments, broken PTP tracking, dispute escalation | Automated / Escalated |

---

## 2. Core Architecture: True Multi-Turn Agentic Workflow

```
       [Webhook Event: Payment Fail / Cart Abandon / B2B Invoice]
                                  │
                                  ▼
      ┌───────────────────────────────────────────────────────┐
      │ 1. OBSERVE                                            │
      │ Pull customer LTV, decline code, and prior attempts   │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
      ┌───────────────────────────────────────────────────────┐
      │ 2. ML RECOVERY SCORING                                │
      │ Logistic Regression predicts recovery probability     │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
      ┌───────────────────────────────────────────────────────┐
      │ 3. GEMINI AGENT BRAIN (Dynamic Reasoning & Planning)  │
      │ Synthesizes context, generates CoT, selects tool:     │
      │ • schedule_payment_retry  • send_recovery_message     │
      │ • offer_recovery_discount • log_promise_to_pay        │
      │ • escalate_to_human       • close_case                │
      └───────────────────────────┬───────────────────────────┘
                                  ▼
      ┌───────────────────────────────────────────────────────┐
      │ 4. DETERMINISTIC GUARDRAILS (Absolute Veto Power)     │
      │ Checks 9 Fail-Closed Compliance Rules:                │
      │ Opt-out, Fraud, Attempt Caps, DND, WhatsApp Consent,  │
      │ Cooldowns, Control Group, and Margin Discount Limits. │
      └──────┬────────────────────────────────────────┬───────┘
             │ Blocked (Curfew / Consent)              │ Passed
             ▼                                        ▼
      ┌──────────────┐                         ┌──────────────┐
      │ AUTO REPLAN  │                         │ 5. ACT       │
      │ Re-routes    │                         │ Dispatches   │
      │ channel      │                         │ Tool Action  │
      └──────┬───────┘                         └──────┬───────┘
             │                                        ▼
             │                                 ┌──────────────┐
             │                                 │ 6. OBSERVE   │
             │                                 │    OUTCOME   │
             └─────────────────────────────────┴──────┬───────┘
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                       ▼                                                             ▼
                [Payment Settled]                                           [Unresolved / Replied]
                       │                                                             │
                       ▼                                                             ▼
                 Case RESOLVED                                          Gemini Decides Next Step:
                                                                        • Promise-to-Pay Hold
                                                                        • Autonomous Next Attempt
                                                                        • Escalation / Termination
```

---

## 3. The 3 Supported Revenue Workflows

### 1. Payment Failure Recovery (B2C / UPI / Cards)
- **Problem**: Temporary bank switch outages, technical UPI timeouts (`NETWORK_TIMEOUT`), and transient insufficient funds (`INSUFFICIENT_FUNDS`) cause immediate churn if retried indiscriminately.
- **Agent Behavior**:
  - Predicts recovery likelihood with ML scoring model.
  - High probability (> 0.7): Automatically schedules gateway retry after bank cooldown without disturbing the customer.
  - Low probability or customer action required: Generates instant 1-click Razorpay payment links dispatched via compliant channel (WhatsApp if consented, otherwise Email).

### 2. Checkout Abandonment Recovery (E-Commerce)
- **Problem**: Customers abandon high-value carts due to sudden friction (e.g., `HIGH_SHIPPING_COST`, session drop-offs).
- **Agent Behavior**:
  - Sends a subtle cart reminder highlighting reserved inventory.
  - On repeat drop-off with proven margin clearance, proposes an incentive discount strictly bounded by Guardrail Rule 9 (maximum 10%–20%).

### 3. B2B Overdue Invoice Recovery & Promise-to-Pay (PTP)
- **Problem**: Commercial invoices have complex multi-stakeholder approval chains, Net-30/60 terms, and cash-flow timing dependencies. Aggressive dunning damages enterprise relationships.
- **Supported Fields**:
  - `invoiceNumber`, `companyName`, `dueDate`, `daysOverdue`, `amount`, `ptpDate`, `ptpStatus` (`NONE`, `LOGGED`, `FULFILLED`, `BROKEN`).
- **Promise-to-Pay (PTP) Lifecycle**:
  1. **Commitment**: Customer or buyer promises payment on a future date (e.g. *"Payment will be cleared on Friday after director sign-off"*).
  2. **Hold**: Agent extracts PTP intent and invokes `log_promise_to_pay`, transitioning the case to a protected PTP hold state and halting all automated dunning reminders until that date.
  3. **Fulfillment**: If settled on or before the promised date, the state transitions to `RESOLVED` with `ptpStatus: FULFILLED`.
  4. **Broken PTP**: If the promised date lapses without settlement, the agent recognizes a broken commitment (`ptpStatus: BROKEN`) and escalates the account directly to human accounts receivable (AR).
  5. **Dispute Handling**: Any formal dispute (`DISPUTED_INVOICE`) immediately halts automated communication and routes the case to human operations.

---

## 4. 9 Deterministic Fail-Closed Guardrails

Guardrails operate with **absolute veto power** over the AI agent brain. No generative output, hallucinated channel, or invalid parameter can bypass validation:

| Rule | Name | Condition | Action |
|---|---|---|---|
| **Rule 1** | **Customer Opt-Out** | `customer.optOutStatus == true` | Immediate `TERMINATED` (Zero outreach) |
| **Rule 2** | **Fraud Score Threshold** | `event.fraudScore > 0.80` | Immediate `TERMINATED` + Flags Manual Review |
| **Rule 3** | **Contact Attempt Exhaustion** | `currentAttempt >= maxAttempts` (3) | Immediate `TERMINATED` |
| **Rule 4** | **Agent Loop Circuit Breaker** | `loopIterations >= maxLoopIterations` (4-5) | Immediate `ESCALATED` to Human Desk |
| **Rule 5** | **Contact Cooldown Interval** | Elapsed time < `retryCooldownHours` | `BLOCK_ACT` (Enforces quiet recovery period) |
| **Rule 6** | **Telecom DND Curfew** | Proposed send time between 21:00 and 08:00 | `BLOCK_ACT` for SMS/WhatsApp (Triggers replan to 24/7 Email) |
| **Rule 7** | **Control Group Isolation** | `isControlGroup == true` | `BLOCK_ACT` (Strict holdout for unbiased lift measurement) |
| **Rule 8** | **WhatsApp Consent Verification** | `channel == 'WhatsApp'` without verified consent | `BLOCK_ACT` (Triggers replan to Email/SMS) |
| **Rule 9** | **Margin Protection Discount Cap** | `discountPct > 20.0%` | `BLOCK_ACT` (Prevents predatory or illegal couponing) |

---

## 5. Evaluation Methodology & Metrics

Recover rigorously separates evaluation metrics into four explicit categories:

1. **Historical Replay**: Replaying actual transaction logs (`data/events.csv`, `data/customers.csv`, `data/outcomes.csv`) through the agent state machine to evaluate autonomous decision quality under real-world conditions.
2. **Simulated Baseline (Control Group)**: A randomized 20% holdout cohort that receives no active interventions. This measures organic resolution without agent intervention (17.78%).
3. **Modeled Recovery (Treatment Group)**: The 80% cohort subjected to multi-turn agent interventions, achieving 26.97% resolution.
4. **Actual Recovery Lift**: True incremental lift calculated as Treatment Resolution Rate minus Control Baseline Rate (**+9.19 percentage points**), generating **₹120,603.30 net recovered revenue** at an ROI multiple of **1,835.7x**.

---

## 6. Project Structure

```
.
├── server.ts                 # Full-stack Express API & Webhook Orchestrator (Port 3000)
├── metadata.json             # App configuration, capabilities, and permissions
├── static/
│   ├── index.html            # Web Command Center Dashboard
│   ├── app.js                # Interactive state management, case explorer & replay
│   └── style.css             # High-contrast light/dark responsive dashboard styling
├── src/
│   ├── types.ts              # TypeScript domain types (B2B, PTP, cases, guardrails)
│   ├── models.ts             # In-memory database, CSV loaders, and audit log storage
│   ├── llm_agent.ts          # Gemini Agent Brain, Tool Calling & Dynamic Reasoning
│   ├── guardrails.ts         # 9 Deterministic Fail-Closed Compliance Rules
│   ├── agent_loop.ts         # Multi-turn state machine (OBSERVE -> REASON -> PLAN -> ACT -> OUTCOME)
│   ├── diagnosis.ts          # Root cause diagnosis & scikit-learn ML recovery scoring
│   ├── intervention.ts       # Template rendering & channel timing calculations
│   ├── execution.ts          # Tool execution engine (retries, links, discounts, PTP)
│   └── mock_services.ts      # Simulated external APIs (Razorpay gateway, WhatsApp, Email)
├── test_workflow.ts          # Comprehensive TypeScript test suite (20/20 test cases)
├── test_agent_workflow.py    # Python unit test suite for dynamic reasoning & PTP
├── test_guardrails.py        # Python standalone guardrail unit test suite
├── test_llm_engine.py        # Python LLM engine fallback & schema validation tests
├── main.py                   # FastAPI backend server
├── agent_loop.py             # Python agent loop runner
├── guardrails.py             # Python deterministic guardrails
└── tools.py                  # Python tool definitions and intent extraction
```

---

## 7. Running & Testing

### TypeScript / Node.js Engine

```bash
# Run TypeScript test suite
npm test

# Run linter / type checker
npm run lint

# Start full-stack web application (dev server)
npm run dev
```

### Python Engine

```bash
# Run Python unit tests
python3 -m unittest discover -s . -p 'test_*.py'

# Run batch evaluation runner
python3 batch_runner.py
```
