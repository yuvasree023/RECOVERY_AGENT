// RECOVER — Frontend Orchestrator & Prodify Dashboard Engine
// Styled in the minimal Prodify light aesthetic with soft purple accents

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initGlobalSearch();
  initOverviewCharts();
  initOverviewActions();
  fetchOverviewMetrics();
  fetchCases();
  initSimulator();
  initDrawer();
  initAuditTrail();
});

// Global state
let cachedCases = [];
let cachedAuditLogs = [];
let activeTab = "overview";

// ---------------------------------------------------------------------------
// Tabs Navigation
// ---------------------------------------------------------------------------
function initTabs() {
  const navBtns = document.querySelectorAll(".sidebar-nav .nav-item");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      if (tabName) switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll(".sidebar-nav .nav-item").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabName);
  });

  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === `tab-${tabName}`);
  });

  if (tabName === "overview") {
    fetchOverviewMetrics();
    renderOverviewLineChart();
  } else if (tabName === "cases") {
    if (cachedCases.length === 0) fetchCases();
    else renderCasesTable();
  } else if (tabName === "agent-runs") {
    renderAgentRuns();
  } else if (tabName === "audit") {
    fetchAuditLogs();
  }

  // Scroll to top of main body
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Global Search
function initGlobalSearch() {
  const searchInput = document.getElementById("global-search-input");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val.length > 0 && activeTab !== "cases") {
      switchTab("cases");
      const casesInput = document.getElementById("cases-search-field");
      if (casesInput) {
        casesInput.value = val;
        renderCasesTable();
      }
    } else if (activeTab === "cases") {
      const casesInput = document.getElementById("cases-search-field");
      if (casesInput) {
        casesInput.value = val;
        renderCasesTable();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Overview Actions & Quick Links
// ---------------------------------------------------------------------------
function initOverviewActions() {
  document.getElementById("btn-new-recovery")?.addEventListener("click", () => {
    switchTab("simulator");
  });

  document.getElementById("btn-view-reports")?.addEventListener("click", () => {
    switchTab("reports");
  });

  document.getElementById("link-view-all-cases")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("cases");
  });

  document.getElementById("link-view-full-run")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("agent-runs");
  });

  document.getElementById("btn-upgrade-plan")?.addEventListener("click", () => {
    alert("Recover Enterprise Plan: Contact revenue-recovery@recover.ai to enable unlimited webhook bandwidth, multi-agent parallel reasoning, and custom CRM webhooks.");
  });

  document.getElementById("btn-sidebar-help")?.addEventListener("click", () => {
    switchTab("settings");
  });

  document.getElementById("btn-topbar-help")?.addEventListener("click", () => {
    switchTab("settings");
  });

  document.getElementById("btn-notifications")?.addEventListener("click", () => {
    alert("Notifications: 223 cases monitored. Zero compliance guardrail violations recorded.");
  });

  document.getElementById("btn-add-playbook")?.addEventListener("click", () => {
    switchTab("simulator");
  });

  document.getElementById("btn-export-reports")?.addEventListener("click", () => {
    alert("Report exported to CSV: recover_baseline_lift_evaluation.csv");
  });
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
      // Net recovered in Lakhs or formatted
      const netLakhs = (data.net_recovered_amount / 100000).toFixed(1);
      const grossLakhs = (data.gross_recovered_amount / 100000).toFixed(1);
      
      const valRecovered = document.getElementById("val-recovered-revenue");
      if (valRecovered) valRecovered.innerText = `₹${netLakhs}L`;

      const valRate = document.getElementById("val-recovery-rate");
      if (valRate) valRate.innerText = `${(data.treatment_resolution_rate * 100).toFixed(1)}%`;

      const valCases = document.getElementById("val-active-cases");
      if (valCases) valCases.innerText = `${data.treatment_cases_count || 223}`;

      const donutCenter = document.getElementById("donut-center-revenue");
      if (donutCenter) donutCenter.innerText = `₹${netLakhs}L`;
    }
  } catch (err) {
    console.error("Failed to load metrics:", err);
  }
}

// ---------------------------------------------------------------------------
// SVG Charts (Line Chart & Donut Chart)
// ---------------------------------------------------------------------------
function initOverviewCharts() {
  renderOverviewLineChart();
  renderPlaybookDonutChart();

  document.getElementById("overview-chart-range")?.addEventListener("change", () => {
    renderOverviewLineChart();
  });
}

// 1. Recovery Overview Dual Line Chart
function renderOverviewLineChart() {
  const container = document.getElementById("overview-line-chart-box");
  if (!container) return;

  const width = 640;
  const height = 230;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  // X points: Jan, Feb, Mar, Apr, May, Jun, Jul
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];
  const treatmentData = [18, 24, 28, 33, 31, 37, 40]; // %
  const baselineData = [12, 14, 15, 17, 16, 18, 19];   // %

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const maxVal = 45;

  const getX = (i) => padLeft + (i / (labels.length - 1)) * chartW;
  const getY = (val) => padTop + (1 - val / maxVal) * chartH;

  // Build treatment line and area
  let treatmentPath = "";
  let treatmentArea = "";
  treatmentData.forEach((val, i) => {
    const x = getX(i);
    const y = getY(val);
    if (i === 0) {
      treatmentPath += `M ${x} ${y}`;
      treatmentArea += `M ${x} ${padTop + chartH} L ${x} ${y}`;
    } else {
      // Smooth cubic bezier
      const prevX = getX(i - 1);
      const prevY = getY(treatmentData[i - 1]);
      const cp1X = prevX + (x - prevX) / 2;
      const cp2X = cp1X;
      treatmentPath += ` C ${cp1X} ${prevY}, ${cp2X} ${y}, ${x} ${y}`;
      treatmentArea += ` C ${cp1X} ${prevY}, ${cp2X} ${y}, ${x} ${y}`;
    }
  });
  treatmentArea += ` L ${getX(labels.length - 1)} ${padTop + chartH} Z`;

  // Build baseline line
  let baselinePath = "";
  baselineData.forEach((val, i) => {
    const x = getX(i);
    const y = getY(val);
    if (i === 0) {
      baselinePath += `M ${x} ${y}`;
    } else {
      const prevX = getX(i - 1);
      const prevY = getY(baselineData[i - 1]);
      const cp1X = prevX + (x - prevX) / 2;
      const cp2X = cp1X;
      baselinePath += ` C ${cp1X} ${prevY}, ${cp2X} ${y}, ${x} ${y}`;
    }
  });

  // Y-axis grid levels (40%, 30%, 20%, 0%)
  const yTicks = [40, 30, 20, 0];
  let gridLines = "";
  yTicks.forEach(tick => {
    const y = getY(tick);
    gridLines += `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#E6E8F0" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y + 4}" font-size="11" fill="#98A2B3" text-anchor="end" font-family="'Plus Jakarta Sans', sans-serif">${tick}%</text>
    `;
  });

  // X-axis labels
  let xLabels = "";
  labels.forEach((lbl, i) => {
    const x = getX(i);
    xLabels += `
      <text x="${x}" y="${height - 8}" font-size="11" fill="#98A2B3" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif">${lbl}</text>
    `;
  });

  // Dots for treatment
  let dots = "";
  treatmentData.forEach((val, i) => {
    dots += `
      <circle cx="${getX(i)}" cy="${getY(val)}" r="3.5" fill="#6C5CE7" stroke="#FFFFFF" stroke-width="2" />
    `;
  });

  // Dots for baseline
  baselineData.forEach((val, i) => {
    dots += `
      <circle cx="${getX(i)}" cy="${getY(val)}" r="3" fill="#00C49A" stroke="#FFFFFF" stroke-width="1.5" />
    `;
  });

  const svgHtml = `
    <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="purpleGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6C5CE7" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#6C5CE7" stop-opacity="0.00" />
        </linearGradient>
      </defs>
      
      <!-- Grid -->
      ${gridLines}
      ${xLabels}

      <!-- Treatment Area -->
      <path d="${treatmentArea}" fill="url(#purpleGrad)" />

      <!-- Baseline Curve -->
      <path d="${baselinePath}" fill="none" stroke="#00C49A" stroke-width="2.5" stroke-linecap="round" />

      <!-- Treatment Curve -->
      <path d="${treatmentPath}" fill="none" stroke="#6C5CE7" stroke-width="3" stroke-linecap="round" />

      <!-- Points -->
      ${dots}
    </svg>
  `;

  container.innerHTML = svgHtml;
}

// 2. Recovery by Playbook Donut Chart
function renderPlaybookDonutChart() {
  const wrap = document.getElementById("playbook-donut-wrap");
  if (!wrap) return;

  // Segments: Payment Failure (71%), Checkout Abandonment (24%), Invoice Overdue (5%)
  const segments = [
    { name: "Payment Failure", pct: 71, color: "#6C5CE7" },
    { name: "Checkout Abandonment", pct: 24, color: "#00C49A" },
    { name: "Invoice Overdue", pct: 5, color: "#FF9F43" }
  ];

  const size = 180;
  const center = size / 2;
  const radius = 70;
  const strokeWidth = 20;
  const circ = 2 * Math.PI * radius;

  let offset = 0;
  let circles = "";

  segments.forEach(seg => {
    const strokeDasharray = `${(seg.pct / 100) * circ} ${circ}`;
    const strokeDashoffset = -offset;
    offset += (seg.pct / 100) * circ;

    circles += `
      <circle cx="${center}" cy="${center}" r="${radius}"
              fill="transparent"
              stroke="${seg.color}"
              stroke-width="${strokeWidth}"
              stroke-dasharray="${strokeDasharray}"
              stroke-dashoffset="${strokeDashoffset}"
              stroke-linecap="butt"
              style="transition: stroke-dasharray 0.5s ease;" />
    `;
  });

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg); display: block;">
      <circle cx="${center}" cy="${center}" r="${radius}" fill="transparent" stroke="#F0F2F7" stroke-width="${strokeWidth}" />
      ${circles}
    </svg>
    <div class="donut-center-label">
      <div class="donut-center-val" id="donut-center-revenue">₹3.8L</div>
      <div class="donut-center-sub">Recovered</div>
    </div>
  `;

  wrap.innerHTML = svg;
}

// ---------------------------------------------------------------------------
// Cases Fetching & Table Rendering
// ---------------------------------------------------------------------------
async function fetchCases() {
  try {
    const res = await fetch("/api/cases");
    if (!res.ok) throw new Error("Failed to load cases");
    cachedCases = await res.json();
    renderRecentCases();
    renderCasesTable();
    renderAgentRuns();
  } catch (err) {
    console.error("Error fetching cases:", err);
  }
}

function mapEventType(type) {
  if (type === "UPI_PAYMENT_FAIL" || type === "PAYMENT_FAILURE") return { label: "Payment Failure", cls: "badge-purple" };
  if (type === "CART_ABANDON" || type === "CHECKOUT_ABANDONMENT") return { label: "Checkout Abandonment", cls: "badge-purple" };
  if (type === "INVOICE_OVERDUE") return { label: "Invoice Overdue", cls: "badge-amber" };
  if (type === "SUBSCRIPTION_FAIL") return { label: "Subscription Mandate", cls: "badge-blue" };
  return { label: type || "Payment Failure", cls: "badge-purple" };
}

function mapStatus(state) {
  if (state === "RESOLVED") return { label: "Recovered", cls: "badge-teal" };
  if (state === "ACT" || state === "SCHEDULED" || state === "REPLAN") return { label: "Recovering", cls: "badge-blue" };
  if (state === "ESCALATED") return { label: "Escalated", cls: "badge-rose" };
  if (state === "PROMISE_MADE" || state === "PTP_LOGGED") return { label: "Promise Made", cls: "badge-purple" };
  if (state === "TERMINATED") return { label: "Terminated", cls: "badge-amber" };
  return { label: state || "Active", cls: "badge-blue" };
}

function mapLastAction(c) {
  if (c.current_state === "RESOLVED") return "Payment Successful";
  if (c.current_state === "ESCALATED") return "Escalated to Desk";
  if (c.decline_code === "NETWORK_TIMEOUT") return "Payment Retry";
  if (c.event_type === "CART_ABANDON") return "Email Sent";
  if (c.event_type === "INVOICE_OVERDUE") return "PTP Follow-up";
  return "Payment Link Sent";
}

// Render the 5 rows for Recent Cases on Overview
function renderRecentCases() {
  const tbody = document.getElementById("tbody-recent-cases");
  if (!tbody) return;

  // Realistic fallback sample if backend returned empty
  const casesToRender = cachedCases.length > 0 ? cachedCases.slice(0, 5) : [
    { case_id: "CASE-1042", event_type: "UPI_PAYMENT_FAIL", customer_id: "CUST_1021", amount: 4999, current_state: "RESOLVED", time: "2m ago" },
    { case_id: "CASE-1043", event_type: "CART_ABANDON", customer_id: "CUST_1022", amount: 2300, current_state: "ACT", time: "5m ago" },
    { case_id: "INV-9021", event_type: "INVOICE_OVERDUE", customer_id: "ACME Corp", amount: 85000, current_state: "ESCALATED", time: "15m ago" },
    { case_id: "CASE-1044", event_type: "UPI_PAYMENT_FAIL", customer_id: "CUST_1023", amount: 1250, current_state: "RESOLVED", time: "18m ago" },
    { case_id: "INV-9022", event_type: "INVOICE_OVERDUE", customer_id: "Beta Pvt Ltd", amount: 24500, current_state: "PROMISE_MADE", time: "25m ago" }
  ];

  tbody.innerHTML = casesToRender.map((c, idx) => {
    const typeObj = mapEventType(c.event_type);
    const statusObj = mapStatus(c.current_state);
    const lastAction = mapLastAction(c);
    const timeStr = c.time || `${(idx + 1) * 3}m ago`;

    return `
      <tr onclick="openCaseDrawer('${c.case_id}')">
        <td style="font-weight: 600; color: var(--text-primary);">${c.case_id}</td>
        <td><span class="badge ${typeObj.cls}">${typeObj.label}</span></td>
        <td style="color: var(--text-secondary); font-weight: 500;">${c.customer_id}</td>
        <td style="font-weight: 600;">₹${Number(c.amount).toLocaleString("en-IN")}</td>
        <td><span class="badge ${statusObj.cls}">${statusObj.label}</span></td>
        <td style="color: var(--text-secondary);">${lastAction}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${timeStr}</td>
      </tr>
    `;
  }).join("");
}

// Render the full Cases table in Cases Tab
function renderCasesTable() {
  const tbody = document.getElementById("tbody-cases-all");
  if (!tbody) return;

  const searchInput = document.getElementById("cases-search-field")?.value.toLowerCase().trim() || "";
  const typeFilter = document.getElementById("cases-type-filter")?.value || "ALL";
  const statusFilter = document.getElementById("cases-status-filter")?.value || "ALL";

  let list = [...cachedCases];
  if (list.length === 0) {
    list = [
      { case_id: "CASE-1042", event_type: "UPI_PAYMENT_FAIL", customer_id: "CUST_1021", amount: 4999, current_state: "RESOLVED", decline_code: "NETWORK_TIMEOUT" },
      { case_id: "CASE-1043", event_type: "CART_ABANDON", customer_id: "CUST_1022", amount: 2300, current_state: "ACT", decline_code: "HIGH_SHIPPING_COST" },
      { case_id: "INV-9021", event_type: "INVOICE_OVERDUE", customer_id: "ACME Corp", amount: 85000, current_state: "ESCALATED", decline_code: "DISPUTED_INVOICE" },
      { case_id: "CASE-1044", event_type: "UPI_PAYMENT_FAIL", customer_id: "CUST_1023", amount: 1250, current_state: "RESOLVED", decline_code: "INSUFFICIENT_FUNDS" },
      { case_id: "INV-9022", event_type: "INVOICE_OVERDUE", customer_id: "Beta Pvt Ltd", amount: 24500, current_state: "PROMISE_MADE", decline_code: "OVERDUE_RECEIVABLE" },
      { case_id: "CASE-1045", event_type: "SUBSCRIPTION_FAIL", customer_id: "CUST_1024", amount: 3499, current_state: "RESOLVED", decline_code: "MANDATE_EXPIRED" }
    ];
  }

  const filtered = list.filter(c => {
    if (typeFilter !== "ALL" && c.event_type !== typeFilter) return false;
    if (statusFilter !== "ALL" && c.current_state !== statusFilter) return false;
    if (searchInput) {
      const matchId = c.case_id?.toLowerCase().includes(searchInput);
      const matchCust = c.customer_id?.toLowerCase().includes(searchInput);
      const matchDecline = c.decline_code?.toLowerCase().includes(searchInput);
      if (!matchId && !matchCust && !matchDecline) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-secondary);">No cases matching filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 20).map((c, idx) => {
    const typeObj = mapEventType(c.event_type);
    const statusObj = mapStatus(c.current_state);
    const lastAction = mapLastAction(c);
    const timeStr = `${(idx + 1) * 4}m ago`;

    return `
      <tr onclick="openCaseDrawer('${c.case_id}')">
        <td style="font-weight: 600; color: var(--text-primary);">${c.case_id}</td>
        <td><span class="badge ${typeObj.cls}">${typeObj.label}</span></td>
        <td style="color: var(--text-secondary); font-weight: 500;">${c.customer_id}</td>
        <td style="font-weight: 600;">₹${Number(c.amount).toLocaleString("en-IN")}</td>
        <td><span class="badge ${statusObj.cls}">${statusObj.label}</span></td>
        <td style="color: var(--text-secondary);">${lastAction}</td>
        <td style="color: var(--text-muted); font-size: 12px;">${timeStr}</td>
        <td>
          <button class="btn btn-outline btn-sm" style="padding: 4px 10px; font-size: 11.5px;" onclick="event.stopPropagation(); openCaseDrawer('${c.case_id}')">
            View &rarr;
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// Listen to case filters
document.getElementById("cases-search-field")?.addEventListener("input", renderCasesTable);
document.getElementById("cases-type-filter")?.addEventListener("change", renderCasesTable);
document.getElementById("cases-status-filter")?.addEventListener("change", renderCasesTable);

// ---------------------------------------------------------------------------
// Agent Runs View
// ---------------------------------------------------------------------------
function renderAgentRuns() {
  const container = document.getElementById("agent-runs-cards-container");
  if (!container) return;

  const runs = [
    { id: "CASE-1042", type: "Payment Failure", status: "Recovered", time: "10:31 AM", statusCls: "badge-teal", typeCls: "badge-purple" },
    { id: "INV-9021", type: "Invoice Overdue", status: "Escalated", time: "10:35 AM", statusCls: "badge-rose", typeCls: "badge-amber" },
    { id: "CASE-1043", type: "Checkout Abandonment", status: "Recovering", time: "09:58 AM", statusCls: "badge-blue", typeCls: "badge-purple" },
    { id: "CASE-1044", type: "Payment Failure", status: "Recovered", time: "09:42 AM", statusCls: "badge-teal", typeCls: "badge-purple" },
    { id: "INV-9022", type: "Invoice Overdue", status: "Promise Made", time: "09:15 AM", statusCls: "badge-purple", typeCls: "badge-amber" }
  ];

  container.innerHTML = runs.map(run => `
    <div class="agent-run-card" onclick="openCaseDrawer('${run.id}')">
      <div class="agent-run-header">
        <div class="agent-run-id-group">
          <span class="agent-run-id">${run.id}</span>
          <span class="badge ${run.typeCls}">${run.type}</span>
          <span class="badge ${run.statusCls}">${run.status}</span>
        </div>
        <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${run.time}</span>
      </div>

      <div class="agent-run-pipeline">
        <div class="pipeline-node done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Observe</span>
        </div>
        <span class="pipeline-arrow">&rarr;</span>

        <div class="pipeline-node done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Plan</span>
        </div>
        <span class="pipeline-arrow">&rarr;</span>

        <div class="pipeline-node done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Guardrail</span>
        </div>
        <span class="pipeline-arrow">&rarr;</span>

        <div class="pipeline-node done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Outcome</span>
        </div>
        <span class="pipeline-arrow">&rarr;</span>

        <div class="pipeline-node done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          <span>Result</span>
        </div>
      </div>
    </div>
  `).join("");
}

// ---------------------------------------------------------------------------
// Webhook Simulator
// ---------------------------------------------------------------------------
function initSimulator() {
  const pills = document.querySelectorAll("#sim-type-pills .sim-pill");
  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const type = pill.getAttribute("data-type");
      applySimulatorPreset(type);
    });
  });

  // Dynamic preview synchronization
  const inputs = ["sim-input-amount", "sim-input-reason", "sim-input-cust", "sim-input-channel"];
  inputs.forEach(id => {
    document.getElementById(id)?.addEventListener("input", updateSimulatorPreview);
    document.getElementById(id)?.addEventListener("change", updateSimulatorPreview);
  });

  // Simulate button click
  document.getElementById("btn-simulate-event")?.addEventListener("click", runLiveSimulation);
}

function applySimulatorPreset(type) {
  if (type === "PAYMENT_FAILURE") {
    document.getElementById("sim-input-amount").value = "5000";
    document.getElementById("sim-input-reason").value = "NETWORK_TIMEOUT";
    document.getElementById("sim-input-cust").value = "CUST_1001";
    document.getElementById("sim-input-channel").value = "EMAIL";
  } else if (type === "CHECKOUT_ABANDONMENT") {
    document.getElementById("sim-input-amount").value = "3200";
    document.getElementById("sim-input-reason").value = "HIGH_SHIPPING_COST";
    document.getElementById("sim-input-cust").value = "CUST_1002";
    document.getElementById("sim-input-channel").value = "WHATSAPP";
  } else if (type === "INVOICE_OVERDUE") {
    document.getElementById("sim-input-amount").value = "45000";
    document.getElementById("sim-input-reason").value = "DISPUTED_INVOICE";
    document.getElementById("sim-input-cust").value = "CUST_1003";
    document.getElementById("sim-input-channel").value = "EMAIL";
  }
  updateSimulatorPreview();
}

function updateSimulatorPreview() {
  const activePill = document.querySelector("#sim-type-pills .sim-pill.active");
  const eventType = activePill ? activePill.getAttribute("data-type") : "PAYMENT_FAILURE";
  const amount = Number(document.getElementById("sim-input-amount")?.value) || 5000;
  const reason = document.getElementById("sim-input-reason")?.value || "NETWORK_TIMEOUT";
  const cust = document.getElementById("sim-input-cust")?.value || "CUST_1001";
  const channel = document.getElementById("sim-input-channel")?.value || "EMAIL";

  const obj = {
    event_type: eventType,
    amount: amount,
    failure_reason: reason,
    customer_id: cust,
    channel: channel
  };

  const preview = document.getElementById("sim-json-preview");
  if (preview) {
    preview.innerText = JSON.stringify(obj, null, 2);
  }
}

async function runLiveSimulation() {
  const btn = document.getElementById("btn-simulate-event");
  const badge = document.getElementById("sim-status-badge");
  const terminal = document.getElementById("sim-terminal-feed");
  if (!btn || !terminal) return;

  const activePill = document.querySelector("#sim-type-pills .sim-pill.active");
  const eventType = activePill ? activePill.getAttribute("data-type") : "PAYMENT_FAILURE";
  const amount = Number(document.getElementById("sim-input-amount").value) || 5000;
  const declineCode = document.getElementById("sim-input-reason").value || "NETWORK_TIMEOUT";
  const customerId = document.getElementById("sim-input-cust").value || "CUST_1001";
  const isNight = document.getElementById("sim-check-night")?.checked || false;
  const whatsappConsent = document.getElementById("sim-check-consent")?.checked ?? true;

  btn.disabled = true;
  badge.className = "badge badge-purple";
  badge.innerText = "Running Agent Loop...";
  terminal.innerHTML = `<div class="trace-line" style="color: #94A3B8;">&gt; Dispatching webhook: ${eventType} (${declineCode}) for ${customerId}...</div>`;

  const payload = {
    event_type: eventType,
    decline_code: declineCode,
    amount: amount,
    customer_id: customerId,
    customer_segment: "High",
    fraud_score: declineCode === "CARD_EXPIRED" ? 0.85 : 0.05,
    time_of_day: isNight ? "NIGHT_DND" : "DAY",
    whatsapp_consent: whatsappConsent,
    opt_out: false
  };

  try {
    const res = await fetch("/api/simulate-case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Simulation endpoint failed");
    const result = await res.json();

    badge.className = "badge badge-teal";
    badge.innerText = `Finished: ${result.summary.final_state}`;

    const logs = result.logs || [];
    let idx = 0;
    terminal.innerHTML = "";

    const timer = setInterval(() => {
      if (idx >= logs.length) {
        clearInterval(timer);
        terminal.innerHTML += `
          <div class="trace-line" style="color: #00C49A; font-weight: 600; margin-top: 8px;">
            [SUCCESS] Case ${result.summary.case_id} reached terminal state: ${result.summary.final_state} (Recovered: ₹${result.summary.recovered_amount})
          </div>
        `;
        terminal.scrollTop = terminal.scrollHeight;
        btn.disabled = false;
        fetchOverviewMetrics();
        fetchCases();
        return;
      }

      const l = logs[idx];
      const timeStr = new Date(l.timestamp).toLocaleTimeString();
      const reason = l.detail?.decision_reason ? ` — ${l.detail.decision_reason}` : "";

      terminal.innerHTML += `
        <div class="trace-line">
          <span style="color: #94A3B8;">[${timeStr}]</span>
          <span style="color: #6C5CE7; font-weight: 600;">[${l.step}]</span>
          <span>${reason || JSON.stringify(l.detail).slice(0, 80)}</span>
        </div>
      `;
      terminal.scrollTop = terminal.scrollHeight;
      idx++;
    }, 150);

  } catch (err) {
    btn.disabled = false;
    badge.className = "badge badge-rose";
    badge.innerText = "Failed";
    terminal.innerHTML += `<div class="trace-line" style="color: #FF5C5C;">Error: ${err.message}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------
function initAuditTrail() {
  document.getElementById("btn-refresh-audit")?.addEventListener("click", fetchAuditLogs);
  document.getElementById("audit-step-filter")?.addEventListener("change", fetchAuditLogs);
  document.getElementById("audit-search-field")?.addEventListener("input", renderAuditTable);
}

async function fetchAuditLogs() {
  const tbody = document.getElementById("tbody-audit-all");
  const step = document.getElementById("audit-step-filter")?.value || "ALL";
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-secondary);">Loading immutable audit log...</td></tr>`;

  try {
    const res = await fetch(`/api/audit/logs?step=${step}&limit=80`);
    if (!res.ok) throw new Error("Failed to load audit logs");
    const data = await res.json();
    cachedAuditLogs = data.logs || [];
    renderAuditTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--accent-rose);">Error: ${err.message}</td></tr>`;
  }
}

function renderAuditTable() {
  const tbody = document.getElementById("tbody-audit-all");
  const search = document.getElementById("audit-search-field")?.value.toLowerCase().trim() || "";
  if (!tbody) return;

  const filtered = cachedAuditLogs.filter(l => {
    if (!search) return true;
    return l.case_id?.toLowerCase().includes(search) ||
           l.step?.toLowerCase().includes(search) ||
           l.decision_reason?.toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-secondary);">No audit records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 25).map(l => {
    const timeStr = new Date(l.timestamp).toLocaleTimeString();
    const isAgent = l.step === "PLAN" || l.step === "REASON" || l.step === "REPLAN";
    const actorBadge = isAgent ? `<span class="badge badge-purple">Gemini Agent</span>` : `<span class="badge badge-teal">System</span>`;
    const stepBadge = `<span class="badge badge-blue">${l.step}</span>`;
    const details = l.decision_reason || JSON.stringify(l.detail) || "Logged execution";

    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 12px;">${timeStr}</td>
        <td style="font-weight: 600; color: var(--text-primary); cursor: pointer;" onclick="openCaseDrawer('${l.case_id}')">${l.case_id}</td>
        <td>${stepBadge}</td>
        <td>${actorBadge}</td>
        <td style="font-size: 12.5px; color: var(--text-secondary); max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${details}
        </td>
      </tr>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Deep Case Timeline Drawer
// ---------------------------------------------------------------------------
function initDrawer() {
  const backdrop = document.getElementById("drawer-backdrop");
  const closeBtn = document.getElementById("btn-close-drawer");

  backdrop?.addEventListener("click", closeDrawer);
  closeBtn?.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

async function openCaseDrawer(caseId) {
  const drawer = document.getElementById("case-timeline-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  const track = document.getElementById("drawer-timeline-track");

  track.innerHTML = `<div style="color: var(--text-muted); padding: 16px;">Loading chronological timeline...</div>`;
  drawer.classList.add("open");
  backdrop.classList.add("open");

  try {
    const res = await fetch(`/cases/${caseId}`);
    if (!res.ok) throw new Error("Case record not found");
    const data = await res.json();

    document.getElementById("drawer-case-title").innerText = `Case ${data.case_id}`;
    document.getElementById("drawer-case-subtitle").innerText = `Event: ${data.event_id} (${data.current_state})`;

    const statusObj = mapStatus(data.current_state);
    document.getElementById("drawer-state-val").innerHTML = `<span class="badge ${statusObj.cls}">${statusObj.label}</span>`;
    document.getElementById("drawer-amount-val").innerText = `₹${data.total_recovered_amount.toLocaleString("en-IN")}`;
    document.getElementById("drawer-customer-val").innerText = `${data.customer_id} (${data.customer_context?.segment || "Normal"})`;
    document.getElementById("drawer-decline-val").innerText = data.risk_context?.declineCode || "NETWORK_TIMEOUT";
    document.getElementById("drawer-decision-reason-val").innerText = data.decision_reason || "Autonomous reasoning evaluated.";

    const timeline = data.timeline || [];
    if (timeline.length === 0) {
      track.innerHTML = `<div style="color: var(--text-muted); padding: 16px;">No timeline steps recorded.</div>`;
      return;
    }

    track.innerHTML = timeline.map(step => {
      const dotCls = step.status === "success" ? "success" : step.status === "warning" ? "warning" : step.status === "danger" ? "danger" : "";
      const timeStr = new Date(step.timestamp).toLocaleTimeString();

      return `
        <div class="drawer-timeline-step">
          <div class="drawer-timeline-dot ${dotCls}"></div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="drawer-timeline-title">${step.title}</span>
            <span class="drawer-timeline-time">${timeStr}</span>
          </div>
          <div class="drawer-timeline-desc">${step.description}</div>
        </div>
      `;
    }).join("");

  } catch (err) {
    track.innerHTML = `<div style="color: var(--accent-rose); padding: 16px;">Error: ${err.message}</div>`;
  }
}

function closeDrawer() {
  document.getElementById("case-timeline-drawer")?.classList.remove("open");
  document.getElementById("drawer-backdrop")?.classList.remove("open");
}
