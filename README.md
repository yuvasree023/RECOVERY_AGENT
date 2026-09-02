# Recover — AI Revenue Recovery Agent

**Razorpay AI Buildathon — Track: AI Revenue Recovery ("Recover")**

Recover is an autonomous, bounded revenue-recovery agent that detects payment failures, checkout drop-offs, and subscription mandate issues, diagnoses the root cause, selects compliant interventions, enforces safety guardrails, and executes multi-channel recovery workflows with an immutable audit trail.

---

## 1. Executive Summary & Measured Batch Impact

Recover was evaluated in a simulated replay across **223 historical transactions** with a randomized, seeded **20% control group (A/B baseline)**:

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
| Playbook | Total Cases | Resolved | Resolution Rate | Gross Recovered | Channel Cost | Net Recovered |
|---|---|---|---|---|---|---|
| **Payment Failure Recovery** (UPI / Subscriptions) | 112 | 28 | 25.0% | ₹62,774.00 | ₹41.05 | **₹62,732.95** |
| **Checkout Drop-off Recovery** (Abandoned Carts) | 66 | 20 | 30.3% | ₹57,895.00 | ₹24.65 | **₹57,870.35** |

### Breakdown by Decline Code
| Decline Code | Cases | Resolved | Resolution Rate | Gross Recovered | Net Recovered |
|---|---|---|---|---|---|
| `NETWORK_TIMEOUT` | 40 | 23 | **57.5%** | ₹50,613.00 | ₹50,602.55 |
| `INSUFFICIENT_FUNDS` | 45 | 12 | **26.7%** | ₹33,631.00 | ₹33,614.75 |
| `HIGH_SHIPPING_COST` | 51 | 8 | **15.7%** | ₹25,017.00 | ₹24,996.95 |
| `CARD_EXPIRED` | 42 | 5 | **11.9%** | ₹11,408.00 | ₹11,389.05 |

---

## 2. Architecture: "LLM Proposes, Guardrail Disposes" [AI AGENT PATTERN]

Recover adopts the battle-tested **"LLM Proposes, Guardrail Disposes"** hybrid agent architecture:
1. **The LLM Agent Brain (`llm_agent.py` / `src/llm_agent.ts`):** Ingests payment failure context, decline diagnosis, and ML recovery likelihood to autonomously generate **Chain-of-Thought (CoT) reasoning**, select appropriate recovery tools (`schedule_retry`, `offer_discount`, `send_message`), and parameterize action proposals.
2. **The Deterministic Guardrail Shield (`guardrails.py` / `src/guardrails.ts`):** Acts as a fail-closed interceptor with absolute veto power over the AI's proposed actions. No AI-hallucinated timing, illegal discount, or unauthorized communication can ever reach execution.

| Layer | Responsibility | Method / Implementation |
|---|---|---|
| **Perception (OBSERVE)** | Ingest webhook event, customer LTV, decline status, consent | Ingestion pipeline + Database snapshot |
| **Prediction (SCORE)** | Estimate recovery likelihood given multivariate customer history | `scikit-learn LogisticRegression` ML Scorer |
| **Reasoning (REASON)** | Autonomous Chain-of-Thought (CoT) synthesis & hypothesis | LLM Agent (`generate_agent_plan`) |
| **Tool Planning (PLAN)** | Propose tool (`schedule_retry`, `offer_discount`, `send_message`) & channel | LLM ReAct Planning Proposal |
| **Safety Interceptor (GUARDRAIL_CHECK)** | **Fail-closed veto & compliance enforcement** | Deterministic 7-Rule Guardrail Engine |
| **Execution (ACT)** | Dispatch gateway retries, WhatsApp/SMS/Email via Razorpay APIs | Mock / Production Tool Integrations |
| **Outcome (OBSERVE_OUTCOME)** | Track payment settlement and increment bounded loop | State machine transition & closure |

---

## 3. Scikit-Learn Model & Time-Based Train/Test Split

The recovery scoring model estimates the probability of recovery to prioritize interventions:

- **Split Strategy**: Strictly **time-based** (Aug 2024 – Nov 2024 for training, Dec 2024 – Jan 2025 for evaluation).
- **Features**: `segment` (OneHot), `ltv` (StandardScaler), `decline_code` (OneHot), `attempt_number` (StandardScaler), `event_type` (OneHot).
- **Target**: `resolved` (0 or 1).

### Evaluation Metrics on Held-Out Test Set (Dec 2024 – Jan 2025)
- **Train Samples**: 147
- **Test Samples**: 76
- **Accuracy**: **76.32%**
- **Precision**: **66.67%**
- **Recall**: **36.36%**
- **ROC AUC**: **0.7576**

> *Statistical Caveat:* The held-out test split has 76 rows. While directionally strong and demonstrating clear signal on technical retries vs card expirations, production deployments should continuously retrain as event volume scales.

---

## 4. Guardrail & Safety Engine (`guardrails.py`)

All 7 safety and compliance rules are implemented in an **isolated module with zero framework/DB dependencies**:

1. **Rule 1 (Opt-out Protection):** `customer.opt_out_status == True` → Immediate `TERMINATED`, 0 contact, 0 cost.
2. **Rule 2 (Fraud Prevention):** `event.fraud_score > 0.8` → Immediate `TERMINATED`, flags for manual fraud review.
3. **Rule 3 (Contact Cap):** `case.current_attempt >= max_attempts` (3) → `TERMINATED`.
4. **Rule 4 (Loop Circuit Breaker):** `case.loop_iterations >= max_loop_iterations` (4) → `ESCALATED` to human desk.
5. **Rule 5 (Contact Cooldown):** Enforces minimum cooldown (`retry_cooldown_hours`) between consecutive contacts.
6. **Rule 6 (DND Compliance):** Blocks WhatsApp and SMS dispatches during DND hours (`21:00` to `08:00`).
7. **Rule 7 (Control Group Isolation):** Cases assigned to the 20% control group receive no active interventions.

---

## 5. Agent Architecture & State Machine

```
   [Incoming Webhook]
          │
          ▼
   ┌──────────────┐
   │ OBSERVE      │◄── Check outcomes (Pre-flight) & Pull Customer/Event
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ REASON       │◄── Deterministic Decline Diagnosis + ML Recovery Probability
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │ PLAN         │◄── Channel Routing + DND-Shifted Timing + Template Selection
   └──────┬───────┘
          ▼
   ┌──────────────┐      Violation
   │ GUARDRAIL    ├──────────────────────► [TERMINATE / ESCALATE]
   │ CHECK (7/7)  │
   └──────┬───────┘
          │ Passed
          ▼
   ┌──────────────┐
   │ ACT          │◄── Dispatch Bounded Tool (Retry / Message / Discount) & Log Cost
   └──────┬───────┘
          ▼
   ┌──────────────┐      Resolved
   │ OBSERVE      ├──────────────────────► [RESOLVED (Record Gross & Net $)]
   │ OUTCOME      │
   └──────┬───────┘
          │ Unresolved (Attempts remaining)
          └─────────────► Loop back to REASON
```

---

## 7. AI Judgment Map (Engineering Boundaries)

| Decision Point | Enforcement Method | Architectural Rationale |
|---|---|---|
| **Decline Code → Root Cause** | Deterministic Mapping | Fixed 4-code vocabulary, deterministic diagnosis mapping, zero hallucination risk. |
| **Recovery Probability** | `scikit-learn LogisticRegression` ML Scorer | Learns multivariate likelihood from customer LTV, attempt count, segment, and failure history. |
| **Tool & Channel Selection** | **LLM-Assisted Reasoning (`LLMEngine` / `MockLLM`)** | Autonomous Chain-of-Thought (CoT) selects tool (`send_message`, `schedule_retry`, `offer_discount`), channel (`WhatsApp`, `SMS`, `Email`), and template key (`PAYMENT_RETRY`, `CARD_EXPIRED`, `INSUFFICIENT_FUNDS`, `CART_DISCOUNT`, `CART_REMINDER`), bounded by strict schema enums and prior attempt memory. |
| **Adaptive Re-planning** | **Autonomous Feedback Loop** | If guardrails veto a proposed channel/action (`BLOCK_ACT`, e.g. DND curfew), the LLM receives rejection feedback to autonomously pivot (e.g. to Email) without human intervention. |
| **Discount & Commitments** | **Strict Schema Bounds (0%, 10%, 15%)** | The LLM may only select pre-approved discount percentages. Arbitrary financial promises are rejected at schema validation and fall back to safe defaults. |
| **Message Content** | **Fixed Template Slot-Filling Only** | Zero free-form generative customer text. Rendering is strictly parameter interpolation into pre-approved templates (`render_message_body`), eliminating regulatory and tone drift. |
| **Safety Guardrails** | **7 Hard-Coded Fail-Closed Rules** | Safety-critical; isolated module (`guardrails.py`), 100% unit-tested independently of LLM and framework. |

## 8. Frontend Command Center Dashboard

Recover includes a modern, high-performance web dashboard served directly from the FastAPI application:

- **Live URL**: `http://localhost:8000/`
- **Source Code**: [`static/index.html`](file:///c:/Users/91735/Desktop/recovery_agent/static/index.html), [`static/style.css`](file:///c:/Users/91735/Desktop/recovery_agent/static/style.css), [`static/app.js`](file:///c:/Users/91735/Desktop/recovery_agent/static/app.js)

### Dashboard Features:
1. **Executive KPI Analytics**: Real-time visualization of Net Recovered Revenue (₹1.20L+), Incremental Lift (+9.19%), ROI (1,835.7x), and 100% Guardrail compliance.
2. **Case Explorer & Search**: Search and filter all 223 cases by status (`RESOLVED`, `TERMINATED`, `ESCALATED`), playbook, and decline code.
3. **Interactive Audit Trail Drawer**: Click any transaction to inspect the step-by-step state machine (`OBSERVE` → `REASON` → `PLAN` → `GUARDRAIL_CHECK` → `ACT` → `OBSERVE_OUTCOME`) with rendered message previews.
4. **Batch Replay Console**: Configurable control group slider and random seed to trigger full chronological simulation with live terminal output.
5. **Live Webhook Simulator**: Ingest simulated payment failures and abandoned carts in real-time and observe the autonomous agent respond instantly.
6. **AI Judgment & Guardrail Matrix**: Visual reference of deterministic routing, scikit-learn ML scoring, and the 7 safety rules.

---

## 9. Running the Application

### Start the Full System (Backend API + Frontend Dashboard)
```bash
uvicorn main:app --reload --port 8000
```
Open **`http://localhost:8000`** in your browser.

### Run Standalone Guardrail Unit Tests
```bash
pytest test_guardrails.py -v
```

### Run Full Test Suite
```bash
pytest -v
```

### Run Command-Line Batch Simulation
```bash
python batch_runner.py
```
