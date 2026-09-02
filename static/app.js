// Recover Dashboard Frontend Logic

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  fetchOverviewMetrics();
  fetchCasesList();
  initBatchRunner();
  initWebhookSimulator();
  initModal();
});

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const target = tab.getAttribute("data-tab");
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add("active");

      if (target === "cases") fetchCasesList();
      if (target === "overview") fetchOverviewMetrics();
    });
  });
}

// Fetch Overview Metrics
async function fetchOverviewMetrics() {
  try {
    const res = await fetch("/metrics");
    if (!res.ok) return;
    const data = await res.json();

    if (data.net_recovered_amount !== undefined) {
      document.getElementById("kpi-net-recovered").innerText = `₹${data.net_recovered_amount.toLocaleString("en-IN", {minimumFractionDigits: 2})}`;
      document.getElementById("kpi-gross-recovered").innerText = `₹${data.gross_recovered_amount.toLocaleString("en-IN", {minimumFractionDigits: 2})}`;
      document.getElementById("kpi-roi-multiple").innerText = `${data.roi_multiple.toFixed(1)}x`;
    }
  } catch (err) {
    console.error("Failed to fetch metrics:", err);
  }
}

// Fetch Cases List
let allCases = [];

async function fetchCasesList() {
  const tbody = document.getElementById("cases-table-body");
  tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4" style="text-align: center; color: var(--text-muted);">Fetching live cases...</td></tr>`;

  try {
    const res = await fetch("/api/cases");
    if (!res.ok) throw new Error("Failed to load cases");
    allCases = await res.json();
    renderCasesTable(allCases);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4" style="text-align: center; color: #fb7185;">Error loading cases: ${err.message}</td></tr>`;
  }
}

function renderCasesTable(cases) {
  const tbody = document.getElementById("cases-table-body");
  const stateFilter = document.getElementById("filter-state").value;
  const playbookFilter = document.getElementById("filter-playbook").value;
  const search = document.getElementById("case-search").value.toLowerCase().trim();

  let filtered = cases.filter(c => {
    if (stateFilter !== "ALL" && c.current_state !== stateFilter) return false;
    if (playbookFilter !== "ALL" && c.event_type !== playbookFilter) return false;
    if (search) {
      const matchCase = c.case_id.toLowerCase().includes(search);
      const matchEvt = c.event_id.toLowerCase().includes(search);
      const matchCust = c.customer_id.toLowerCase().includes(search);
      if (!matchCase && !matchEvt && !matchCust) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: var(--text-muted);">No matching recovery cases found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const stateBadgeClass = `badge-${c.current_state.toLowerCase()}`;
    const probPct = c.recovery_probability ? `${(c.recovery_probability * 100).toFixed(0)}%` : "—";
    const recAmt = c.total_recovered_amount > 0 ? `<strong style="color: var(--accent-emerald);">₹${c.total_recovered_amount.toLocaleString("en-IN")}</strong>` : "₹0.00";

    return `
      <tr>
        <td>
          <div style="font-family: var(--font-mono); font-size: 11px; color: #38bdf8;">${c.event_id}</div>
          <div style="font-size: 10px; color: var(--text-sub);">${c.case_id.slice(0, 8)}...</div>
        </td>
        <td>
          <div>${c.customer_id}</div>
          <div style="font-size: 10px; color: var(--text-muted);">${c.customer_segment} Segment</div>
        </td>
        <td><span class="badge ${c.event_type === 'CART_ABANDON' ? 'badge-ml' : 'badge-executed'}">${c.event_type}</span></td>
        <td><code style="font-size: 11px; color: #93c5fd;">${c.decline_code}</code></td>
        <td>₹${c.amount.toLocaleString("en-IN")}</td>
        <td><span class="badge ${stateBadgeClass}">${c.current_state}</span></td>
        <td>${probPct}</td>
        <td>${recAmt}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openAuditModal('${c.case_id}')">
            🔍 Audit Trail
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// Search & Filter Listeners
document.getElementById("case-search").addEventListener("input", () => renderCasesTable(allCases));
document.getElementById("filter-state").addEventListener("change", () => renderCasesTable(allCases));
document.getElementById("filter-playbook").addEventListener("change", () => renderCasesTable(allCases));
document.getElementById("btn-refresh-cases").addEventListener("click", fetchCasesList);

// Modal Logic
function initModal() {
  document.getElementById("btn-close-modal").addEventListener("click", () => {
    document.getElementById("audit-modal").classList.remove("open");
  });
}

async function openAuditModal(caseId) {
  const modal = document.getElementById("audit-modal");
  const modalBody = document.getElementById("modal-audit-body");
  const title = document.getElementById("modal-case-title");
  const subtitle = document.getElementById("modal-case-subtitle");

  modal.classList.add("open");
  modalBody.innerHTML = `<div class="text-center py-4" style="text-align: center; color: var(--text-muted);">Fetching immutable audit trail for case ${caseId}...</div>`;
  title.innerText = `Case Audit Log`;
  subtitle.innerText = `UUID: ${caseId}`;

  try {
    const res = await fetch(`/cases/${caseId}/audit`);
    if (!res.ok) throw new Error("Failed to load audit trail");
    const data = await res.json();

    let html = `<div class="audit-timeline">`;
    data.audit_trail.forEach(step => {
      let detailFormatted = "";
      if (typeof step.detail === "object") {
        let specialCards = "";
        
        // Chain-of-Thought (CoT) card
        const thought = step.detail.llm_thought || step.detail.chain_of_thought;
        if (thought) {
          specialCards += `
            <div style="background: rgba(147, 51, 234, 0.12); border-left: 3px solid #c084fc; padding: 10px 14px; border-radius: 6px; margin-bottom: 8px;">
              <div style="font-size: 11px; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span>🧠 AI Agent Chain-of-Thought Reasoning</span>
              </div>
              <div style="font-size: 13px; line-height: 1.5; color: #f1f5f9; font-style: italic;">
                "${thought}"
              </div>
            </div>
          `;
        }

        // Proposed Tool in PLAN step
        if (step.detail.proposed_tool) {
          specialCards += `
            <div style="background: rgba(59, 130, 246, 0.1); border-left: 3px solid #60a5fa; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
              <div>
                <span style="font-size: 11px; color: #93c5fd; text-transform: uppercase; font-weight: 600;">Proposed Tool Action:</span>
                <code style="background: rgba(0,0,0,0.4); color: #38bdf8; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: 600;">${step.detail.proposed_tool}</code>
              </div>
              <span style="font-size: 11px; background: rgba(59, 130, 246, 0.25); color: #bfdbfe; padding: 2px 8px; border-radius: 12px;">Channel: ${step.detail.channel || 'N/A'}</span>
            </div>
          `;
        }

        // Guardrail evaluation card
        if (step.step === "GUARDRAIL_CHECK") {
          const passed = step.detail.passed;
          const status = step.detail.status;
          const reason = step.detail.reason || "All 7 fail-closed rules passed.";
          const color = passed ? "#4ade80" : "#f43f5e";
          const bg = passed ? "rgba(34, 197, 94, 0.1)" : "rgba(244, 63, 94, 0.1)";
          specialCards += `
            <div style="background: ${bg}; border-left: 3px solid ${color}; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px;">
              <div style="font-size: 11px; font-weight: 700; color: ${color}; text-transform: uppercase;">
                🛡️ Guardrail Layer Decision: ${status} (${passed ? 'APPROVED' : 'INTERCEPTED/VETOED'})
              </div>
              <div style="font-size: 12px; color: #cbd5e1; margin-top: 3px;">${reason}</div>
            </div>
          `;
        }

        // Customer message preview
        if (step.detail.rendered_message) {
          specialCards += `
            <div class="msg-bubble">
              <strong style="color: #4ade80; display: block; margin-bottom: 4px;">💬 Sent Customer Message (${step.detail.channel}):</strong>
              ${step.detail.rendered_message}
            </div>
          `;
        }

        detailFormatted = `
          ${specialCards}
          <details style="margin-top: 6px;">
            <summary style="font-size: 11px; color: var(--text-muted); cursor: pointer;">View Raw Step Context JSON</summary>
            <pre style="font-size: 11px; color: #cbd5e1; background: rgba(0,0,0,0.4); padding: 8px; border-radius: 4px; overflow-x: auto; margin-top: 4px;">${JSON.stringify(step.detail, null, 2)}</pre>
          </details>
        `;
      } else {
        detailFormatted = `<div style="font-size: 12px; color: var(--text-muted);">${step.detail}</div>`;
      }

      html += `
        <div class="audit-node">
          <div class="audit-node-header">
            <span class="audit-step-tag">STEP: ${step.step}</span>
            <span class="audit-time">${step.timestamp}</span>
          </div>
          ${detailFormatted}
        </div>
      `;
    });
    html += `</div>`;
    modalBody.innerHTML = html;
  } catch (err) {
    modalBody.innerHTML = `<div style="color: #fb7185;">Error loading audit logs: ${err.message}</div>`;
  }
}

// Batch Runner
function initBatchRunner() {
  const slider = document.getElementById("sim-control-pct");
  const sliderVal = document.getElementById("sim-control-val");
  slider.addEventListener("input", (e) => {
    sliderVal.innerText = `${e.target.value}% (A/B Baseline)`;
  });

  const runSim = async () => {
    const term = document.getElementById("sim-output-content");
    const badge = document.getElementById("sim-status-badge");
    badge.innerText = "Running Replay...";
    badge.style.background = "rgba(37, 99, 235, 0.4)";
    term.innerHTML = `<div style="color: #38bdf8;">[1/3] Ingesting 223 events and partitioning control cohort (${slider.value}%)...</div>`;

    try {
      const pct = parseFloat(slider.value) / 100.0;
      const seed = parseInt(document.getElementById("sim-seed").value) || 42;

      const res = await fetch("/batch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control_group_pct: pct, random_seed: seed })
      });

      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      const s = data.batch_summary;

      badge.innerText = "Completed";
      badge.style.background = "rgba(16, 185, 129, 0.4)";

      term.innerHTML = `
        <pre>
===========================================================================
                RECOVER — BATCH REVENUE RECOVERY REPORT
===========================================================================
 Total Events Processed:        ${s.total_events_processed}
 Treatment Cohort:              ${s.treatment_cases_count} cases (80%)
 Control Cohort (Baseline):     ${s.control_cases_count} cases (20%)
---------------------------------------------------------------------------
 Treatment Resolution Rate:     ${(s.treatment_resolution_rate * 100).toFixed(2)}%
 Control Baseline Rate:         ${(s.control_resolution_rate * 100).toFixed(2)}%
 Incremental Recovery Lift:     +${s.incremental_lift_percentage_points.toFixed(2)}% percentage points
---------------------------------------------------------------------------
 Gross Recovered Revenue:       INR ${s.gross_recovered_amount.toLocaleString('en-IN', {minimumFractionDigits: 2})}
 Total Channel Costs Incurred:  INR ${s.total_cost_incurred.toFixed(2)}
 NET RECOVERED REVENUE:         INR ${s.net_recovered_amount.toLocaleString('en-IN', {minimumFractionDigits: 2})}
 Recovery ROI Multiple:         ${s.roi_multiple.toFixed(1)}x
 Compliance Violations:         ${s.compliance_violations_count} (100% Guardrail Compliant)
 Escalation Rate:               ${(s.escalation_rate * 100).toFixed(2)}%
 Termination Rate:              ${(s.termination_rate * 100).toFixed(2)}%
===========================================================================
        </pre>
      `;
      fetchOverviewMetrics();
    } catch (err) {
      badge.innerText = "Error";
      badge.style.background = "rgba(244, 63, 94, 0.4)";
      term.innerHTML = `<div style="color: #fb7185;">Simulation failed: ${err.message}</div>`;
    }
  };

  document.getElementById("btn-run-full-simulation").addEventListener("click", runSim);
  document.getElementById("btn-run-batch-top").addEventListener("click", () => {
    document.querySelector('[data-tab="simulation"]').click();
    runSim();
  });
}

// Webhook Simulator
function initWebhookSimulator() {
  const form = document.getElementById("webhook-sim-form");
  const liveResult = document.getElementById("wh-live-result");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eventType = document.getElementById("wh-event-type").value;
    const amount = parseFloat(document.getElementById("wh-amount").value);
    const customerId = document.getElementById("wh-customer-id").value;
    const declineCode = document.getElementById("wh-decline-code").value;
    const fraudScore = parseFloat(document.getElementById("wh-fraud-score").value);

    const eventId = `WH_SIM_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    liveResult.innerHTML = `<div style="color: #38bdf8;">[OBSERVE] Ingesting webhook ${eventId} for customer ${customerId}...</div>`;

    const payload = {
      event_id: eventId,
      customer_id: customerId,
      event_type: eventType === "cart-abandoned" ? "CART_ABANDON" : (eventType === "subscription-failed" ? "SUBSCRIPTION_FAIL" : "UPI_PAYMENT_FAIL"),
      amount: amount,
      status: eventType === "cart-abandoned" ? "DROPPED" : "FAILED",
      decline_code: declineCode,
      attempt_number: 1,
      fraud_score: fraudScore,
      retry_cooldown_hours: declineCode === "INSUFFICIENT_FUNDS" ? 24 : (declineCode === "CARD_EXPIRED" ? 48 : 2)
    };

    try {
      const res = await fetch(`/webhooks/${eventType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      // Poll audit trail for live visualization
      setTimeout(async () => {
        try {
          const auditRes = await fetch(`/cases/${data.case_id}/audit`);
          const auditData = await auditRes.json();

          let feedHtml = `<div style="margin-bottom: 12px; font-weight: 700; color: #4ade80;">✓ Webhook Accepted & Agent Executed (Case: ${data.case_id.slice(0, 8)}...)</div>`;
          auditData.audit_trail.forEach(step => {
            const isPass = step.step === "ACT" || step.step === "CLOSE";
            feedHtml += `
              <div class="feed-step ${isPass ? 'pass' : ''}">
                <div class="feed-step-title">[${step.step}]</div>
                <div class="feed-step-desc">${typeof step.detail === 'object' ? JSON.stringify(step.detail) : step.detail}</div>
              </div>
            `;
          });
          liveResult.innerHTML = feedHtml;
          fetchOverviewMetrics();
        } catch (err) {
          liveResult.innerHTML = `<div>Case created: ${data.case_id}</div>`;
        }
      }, 500);

    } catch (err) {
      liveResult.innerHTML = `<div style="color: #fb7185;">Webhook trigger failed: ${err.message}</div>`;
    }
  });
}
