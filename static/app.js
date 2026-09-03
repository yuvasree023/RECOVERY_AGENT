// RECOVER — Frontend Orchestrator & Deep Timeline Engine

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initFlowNodes();
  fetchOverviewMetrics();
  fetchCases();
  initBatchButton();
  initSimulator();
});

// ---------------------------------------------------------------------------
// Tabs Navigation
// ---------------------------------------------------------------------------
function initTabs() {
  const tabBtns = document.querySelectorAll(".nav-tab");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  const targetBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
  const targetContent = document.getElementById(`tab-${tabName}`);

  if (targetBtn) targetBtn.classList.add("active");
  if (targetContent) targetContent.classList.add("active");

  if (tabName === "cases") fetchCases();
  if (tabName === "overview") fetchOverviewMetrics();
  if (tabName === "audit") fetchAuditLogs();
  if (tabName === "agent-runs") renderAgentRunsTable();
}

// ---------------------------------------------------------------------------
// Overview Metrics
// ---------------------------------------------------------------------------
async function fetchOverviewMetrics() {
  try {
    const res = await fetch("/metrics");
    if (!res.ok) return;
    const data = await res.json();

    if (data.net_recovered_amount !== undefined) {
      document.getElementById("kpi-net-recovered").innerText = `₹${data.net_recovered_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      document.getElementById("kpi-gross-recovered").innerText = `₹${data.gross_recovered_amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      document.getElementById("kpi-total-cost").innerText = `₹${data.total_cost_incurred.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      document.getElementById("kpi-roi-multiple").innerText = `${data.roi_multiple.toFixed(1)}x`;

      const diffPct = (data.observed_recovery_rate_diff * 100).toFixed(2);
      document.getElementById("kpi-rate-difference").innerText = `+${diffPct}%`;
      document.getElementById("kpi-treatment-rate").innerText = `${(data.treatment_resolution_rate * 100).toFixed(2)}%`;
      document.getElementById("kpi-baseline-rate").innerText = `${(data.control_resolution_rate * 100).toFixed(2)}%`;

      document.getElementById("kpi-guardrail-blocks").innerText = data.guardrail_blocks_count || 0;
      document.getElementById("kpi-escalations").innerText = data.escalation_count || 0;

      // Update interactive flow stats
      document.getElementById("flow-stat-recovery").innerText = `₹${(data.net_recovered_amount / 100000).toFixed(2)}L`;
    }
  } catch (err) {
    console.error("Failed to load metrics:", err);
  }
}

// ---------------------------------------------------------------------------
// Interactive Revenue Recovery Flow
// ---------------------------------------------------------------------------
const FLOW_DESCRIPTIONS = {
  risk: {
    title: "Stage 01: Revenue at Risk",
    text: "Ingests transaction drop-offs: insufficient funds, card expiry, bank timeouts, and cart abandonments with real-time customer LTV & consent metadata.",
    actionText: "View Cases &rarr;",
    actionTab: "cases"
  },
  brain: {
    title: "Stage 02: Agent Brain (Gemini 2.5 Flash)",
    text: "Autonomous reasoning engine evaluates ML likelihood signal, customer segment, and past attempts to choose bounded recovery tools and parameters.",
    actionText: "Inspect State Machine &rarr;",
    actionTab: "agent-runs"
  },
  actions: {
    title: "Stage 03: Production Tools",
    text: "Dispatches simulated production tools: Payment Gateway Cooldown Retries, Omnichannel Messaging (WhatsApp/Email/SMS), Bounded Coupons, and Human Desk routing.",
    actionText: "Open Webhook Simulator &rarr;",
    actionTab: "simulator"
  },
  guardrails: {
    title: "Stage 04: Deterministic Guardrails",
    text: "7 fail-closed rules with absolute veto power: enforces telecom DND curfew (21:00-08:00), opt-out status, fraud score limits, max attempts, and holdout baseline.",
    actionText: "View Audit Log &rarr;",
    actionTab: "audit"
  },
  recovery: {
    title: "Stage 05: Recovered Value",
    text: "Reconciles settlement outcomes, records net yield, verifies zero compliance violations, and safely closes terminal recovery cases.",
    actionText: "View Playbooks &rarr;",
    actionTab: "playbooks"
  }
};

function initFlowNodes() {
  const nodes = document.querySelectorAll(".flow-node");
  nodes.forEach(node => {
    node.addEventListener("click", () => {
      nodes.forEach(n => n.classList.remove("active-node"));
      node.classList.add("active-node");

      const flowKey = node.getAttribute("data-flow");
      const info = FLOW_DESCRIPTIONS[flowKey];
      if (info) {
        document.getElementById("flow-inspector-text").innerHTML = `<strong>${info.title}</strong> &mdash; ${info.text}`;
        const actionEl = document.getElementById("flow-inspector-action");
        actionEl.innerHTML = info.actionText;
        actionEl.onclick = () => switchTab(info.actionTab);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Cases Explorer & Deep Timeline Drawer
// ---------------------------------------------------------------------------
let cachedCases = [];

async function fetchCases() {
  const tbody = document.getElementById("cases-table-body");
  tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">Loading live cases...</td></tr>`;

  try {
    const res = await fetch("/api/cases");
    if (!res.ok) throw new Error("Failed to load cases");
    cachedCases = await res.json();
    renderCasesTable(cachedCases);
    renderAgentRunsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--accent-rose);">Error: ${err.message}</td></tr>`;
  }
}

function renderCasesTable(cases) {
  const tbody = document.getElementById("cases-table-body");
  const stateFilter = document.getElementById("filter-state").value;
  const pbFilter = document.getElementById("filter-playbook").value;
  const search = document.getElementById("case-search").value.toLowerCase().trim();

  let filtered = cases.filter(c => {
    if (stateFilter !== "ALL" && c.current_state !== stateFilter) return false;
    if (pbFilter !== "ALL" && c.event_type !== pbFilter) return false;
    if (search) {
      const matchCase = c.case_id.toLowerCase().includes(search);
      const matchCust = c.customer_id.toLowerCase().includes(search);
      const matchDecline = c.decline_code.toLowerCase().includes(search);
      if (!matchCase && !matchCust && !matchDecline) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">No matching recovery cases found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const stateBadge = getStateBadge(c.current_state);
    const prob = c.recovery_probability ? `${(c.recovery_probability * 100).toFixed(0)}%` : "—";
    const recStr = c.total_recovered_amount > 0
      ? `<strong style="color: var(--accent-emerald);">₹${c.total_recovered_amount.toLocaleString("en-IN")}</strong>`
      : `<span style="color: var(--text-dim);">₹0</span>`;

    return `
      <tr class="clickable-row" onclick="openCaseDrawer('${c.case_id}')">
        <td>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-blue);">${c.case_id}</div>
          <div style="font-size: 10px; color: var(--text-dim);">${c.event_id}</div>
        </td>
        <td>
          <div>${c.customer_id}</div>
          <span style="font-size: 10px; color: var(--text-muted);">${c.customer_segment} LTV</span>
        </td>
        <td><code style="font-size: 11px; color: var(--text-secondary);">${c.decline_code}</code></td>
        <td><strong>₹${c.amount.toLocaleString("en-IN")}</strong></td>
        <td>${stateBadge}</td>
        <td>${c.current_attempt}/${c.max_attempts}</td>
        <td>${prob}</td>
        <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-muted);">
          ${c.decision_reason || 'Evaluating...'}
        </td>
        <td>${recStr}</td>
      </tr>
    `;
  }).join("");
}

// Filter event listeners
document.getElementById("case-search").addEventListener("input", () => renderCasesTable(cachedCases));
document.getElementById("filter-state").addEventListener("change", () => renderCasesTable(cachedCases));
document.getElementById("filter-playbook").addEventListener("change", () => renderCasesTable(cachedCases));

function getStateBadge(state) {
  if (state === "RESOLVED") return `<span class="badge badge-resolved">RESOLVED</span>`;
  if (state === "TERMINATED") return `<span class="badge badge-terminated">TERMINATED</span>`;
  if (state === "ESCALATED") return `<span class="badge badge-escalated">ESCALATED</span>`;
  if (state === "ACT" || state === "SCHEDULED") return `<span class="badge badge-act">ACT</span>`;
  if (state === "REPLAN") return `<span class="badge badge-replan">REPLAN</span>`;
  return `<span class="badge badge-act">${state}</span>`;
}

// ---------------------------------------------------------------------------
// Deep Case Timeline Drawer
// ---------------------------------------------------------------------------
async function openCaseDrawer(caseId) {
  const drawer = document.getElementById("case-timeline-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  const track = document.getElementById("drawer-timeline-track");

  track.innerHTML = `<div style="color: var(--text-muted); padding: 16px;">Loading deep case timeline...</div>`;
  drawer.classList.add("open");
  backdrop.classList.add("open");

  try {
    const res = await fetch(`/cases/${caseId}`);
    if (!res.ok) throw new Error("Case not found");
    const data = await res.json();

    document.getElementById("drawer-case-title").innerText = `Case ${data.case_id}`;
    document.getElementById("drawer-case-subtitle").innerText = `Event: ${data.event_id} (${data.current_state})`;

    document.getElementById("drawer-state-val").innerHTML = getStateBadge(data.current_state);
    document.getElementById("drawer-amount-val").innerText = `₹${data.total_recovered_amount.toLocaleString("en-IN")} / ₹${data.risk_context?.fraudScore !== undefined ? 'Risk ' + data.risk_context.fraudScore : ''}`;
    document.getElementById("drawer-customer-val").innerText = `${data.customer_id} (${data.customer_context?.segment || 'Normal'})`;
    document.getElementById("drawer-decline-val").innerText = data.risk_context?.declineCode || "UNKNOWN";
    document.getElementById("drawer-decision-reason-val").innerText = data.decision_reason || "Autonomous reasoning active.";

    // Render deep timeline steps
    const timeline = data.timeline || [];
    if (timeline.length === 0) {
      track.innerHTML = `<div style="color: var(--text-muted); padding: 16px;">No audit steps recorded yet.</div>`;
      return;
    }

    track.innerHTML = timeline.map(step => {
      const dotClass = step.status === "success" ? "dot-success" : step.status === "warning" ? "dot-warning" : step.status === "danger" ? "dot-danger" : "";
      const timeStr = new Date(step.timestamp).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return `
        <div class="timeline-item">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-item-header">
            <span class="timeline-item-title">${step.title}</span>
            <span class="timeline-item-time">${timeStr}</span>
          </div>
          <div class="timeline-item-desc">${step.description}</div>
        </div>
      `;
    }).join("");

  } catch (err) {
    track.innerHTML = `<div style="color: var(--accent-rose); padding: 16px;">Failed to load case details: ${err.message}</div>`;
  }
}

function closeDrawer() {
  document.getElementById("case-timeline-drawer").classList.remove("open");
  document.getElementById("drawer-backdrop").classList.remove("open");
}

// ---------------------------------------------------------------------------
// Agent Runs Tab
// ---------------------------------------------------------------------------
function renderAgentRunsTable() {
  const tbody = document.getElementById("agent-runs-tbody");
  if (!tbody || cachedCases.length === 0) return;

  const slice = cachedCases.slice(0, 15);
  tbody.innerHTML = slice.map(c => {
    return `
      <tr class="clickable-row" onclick="openCaseDrawer('${c.case_id}')">
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-blue);">${c.case_id}</td>
        <td><code>${c.event_type}</code></td>
        <td>${getStateBadge(c.current_state)}</td>
        <td style="font-size: 12px; color: var(--text-secondary); max-width: 320px;">${c.decision_reason || 'Reasoning active'}</td>
        <td>${c.loop_iterations || 1} turns</td>
        <td>${c.total_recovered_amount > 0 ? '<strong style="color: var(--accent-emerald);">Recovered</strong>' : '<span style="color: var(--text-muted);">Executed / Logged</span>'}</td>
      </tr>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Webhook Simulator
// ---------------------------------------------------------------------------
const PRESETS = {
  adaptive_recovery: {
    event_type: "UPI_PAYMENT_FAIL",
    decline_code: "NETWORK_TIMEOUT",
    amount: 3499,
    segment: "High",
    fraud_score: 0.10,
    time_of_day: "DAY",
    whatsapp_consent: true,
    opt_out: false
  },
  guardrail_replan: {
    event_type: "UPI_PAYMENT_FAIL",
    decline_code: "NETWORK_TIMEOUT",
    amount: 1999,
    segment: "High",
    fraud_score: 0.05,
    time_of_day: "NIGHT_DND", // 22:30 night - triggers Rule 6 DND curfew
    whatsapp_consent: true,
    opt_out: false
  },
  safe_termination: {
    event_type: "UPI_PAYMENT_FAIL",
    decline_code: "CARD_DECLINED",
    amount: 14500,
    segment: "Low",
    fraud_score: 0.88, // > 0.80 - triggers Rule 2 Fraud check
    time_of_day: "DAY",
    whatsapp_consent: false,
    opt_out: false
  },
  cart_dropoff: {
    event_type: "CART_ABANDON",
    decline_code: "HIGH_SHIPPING_COST",
    amount: 4200,
    segment: "Medium",
    fraud_score: 0.05,
    time_of_day: "DAY",
    whatsapp_consent: true,
    opt_out: false
  }
};

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;

  document.getElementById("sim-event-type").value = p.event_type;
  document.getElementById("sim-decline-code").value = p.decline_code;
  document.getElementById("sim-amount").value = p.amount;
  document.getElementById("sim-segment").value = p.segment;
  document.getElementById("sim-fraud-score").value = p.fraud_score;
  document.getElementById("sim-time-of-day").value = p.time_of_day;
  document.getElementById("sim-whatsapp-consent").checked = p.whatsapp_consent;
  document.getElementById("sim-opt-out").checked = p.opt_out;
}

function initSimulator() {
  const runBtn = document.getElementById("btn-run-simulation");
  if (!runBtn) return;

  runBtn.addEventListener("click", async () => {
    const term = document.getElementById("trace-terminal-feed");
    const pill = document.getElementById("trace-status-pill");

    pill.className = "badge badge-warning";
    pill.innerText = "Executing Agent Loop...";
    term.innerHTML = `<div class="trace-line" style="color: var(--text-dim);">&gt; Ingesting simulated webhook event...</div>`;

    const payload = {
      event_type: document.getElementById("sim-event-type").value,
      decline_code: document.getElementById("sim-decline-code").value,
      amount: Number(document.getElementById("sim-amount").value),
      customer_segment: document.getElementById("sim-segment").value,
      fraud_score: Number(document.getElementById("sim-fraud-score").value),
      time_of_day: document.getElementById("sim-time-of-day").value,
      whatsapp_consent: document.getElementById("sim-whatsapp-consent").checked,
      opt_out: document.getElementById("sim-opt-out").checked
    };

    try {
      const res = await fetch("/api/simulate-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Simulator returned error");
      const result = await res.json();

      pill.className = "badge badge-resolved";
      pill.innerText = `Finished: ${result.summary.final_state}`;

      // Animate line-by-line trace
      const logs = result.logs || [];
      let index = 0;
      term.innerHTML = "";

      const interval = setInterval(() => {
        if (index >= logs.length) {
          clearInterval(interval);
          term.innerHTML += `<div class="trace-line" style="color: var(--accent-emerald); font-weight: 700; margin-top: 10px;">[SUCCESS] Case reached terminal state: ${result.summary.final_state} (Recovered: ₹${result.summary.recovered_amount})</div>`;
          term.scrollTop = term.scrollHeight;
          fetchOverviewMetrics();
          fetchCases();
          return;
        }

        const l = logs[index];
        const time = new Date(l.timestamp).toLocaleTimeString();
        const detailStr = JSON.stringify(l.detail);
        const reason = l.detail?.decision_reason ? ` | <em>${l.detail.decision_reason}</em>` : "";

        term.innerHTML += `
          <div class="trace-line">
            <span class="trace-timestamp">[${time}]</span>
            <span class="trace-step step-${l.step}">[${l.step}]</span>
            <span>${detailStr.slice(0, 100)}...${reason}</span>
          </div>
        `;
        term.scrollTop = term.scrollHeight;
        index++;
      }, 180);

    } catch (err) {
      pill.className = "badge badge-escalated";
      pill.innerText = "Error";
      term.innerHTML += `<div class="trace-line" style="color: var(--accent-rose);">Failed: ${err.message}</div>`;
    }
  });
}

// ---------------------------------------------------------------------------
// Audit Trail Tab
// ---------------------------------------------------------------------------
async function fetchAuditLogs() {
  const tbody = document.getElementById("audit-table-body");
  const step = document.getElementById("audit-filter-step")?.value || "ALL";
  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">Fetching audit records...</td></tr>`;

  try {
    const res = await fetch(`/api/audit/logs?step=${step}&limit=60`);
    if (!res.ok) throw new Error("Failed to fetch logs");
    const data = await res.json();

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">No audit logs matching step ${step}.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const time = new Date(l.timestamp).toLocaleString();
      const reason = l.decision_reason || l.detail?.reason || "Standard system transition";

      return `
        <tr>
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-dim);">${time}</td>
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--accent-blue);">${l.case_id}</td>
          <td><span class="badge badge-act step-${l.step}">${l.step}</span></td>
          <td style="font-size: 12px; color: var(--text-primary); max-width: 380px;">${reason}</td>
          <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${JSON.stringify(l.detail)}
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--accent-rose);">Failed: ${err.message}</td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// Quick Replay Button
// ---------------------------------------------------------------------------
function initBatchButton() {
  const btn = document.getElementById("btn-quick-replay");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerText = "Replaying (223 Events)...";

    try {
      const res = await fetch("/batch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control_group_pct: 0.20, random_seed: 42 })
      });

      if (!res.ok) throw new Error("Replay failed");
      await fetchOverviewMetrics();
      await fetchCases();
      alert("Offline historical replay completed successfully across 223 events with 20% simulated baseline comparison.");
    } catch (err) {
      alert(`Replay error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerText = "Run Offline Replay";
    }
  });
}
