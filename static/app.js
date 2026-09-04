// RECOVER — Frontend Orchestrator & Prodify Dashboard Engine
// Styled in the minimal Prodify light aesthetic with soft purple accents

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initGlobalSearch();
  initOverviewCharts();
  initOverviewActions();
  initAgentHero();
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
// ---------------------------------------------------------------------------
// Hero Centerpiece: Live Agent Reasoning Loop Player (Matching image.png)
// ---------------------------------------------------------------------------

const HERO_ICONS = {
  clock: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  calendar: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  cart: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`,
  exit: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
  stopwatch: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>`,
  user: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
  trend: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
  tag: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`,
  message: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
  gift: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>`,
  tool: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
  phone: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
  file: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
  percent: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"></line><circle cx="6.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle></svg>`,
  timer: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 10"></polyline></svg>`,
  shield: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
  check: `<svg class="step-row-icon" style="color: #10B981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  alert: `<svg class="step-row-icon" style="color: #F59E0B;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  send: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`,
  hash: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`,
  card: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
  mouse: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`,
  dollar: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
  flag: `<svg class="step-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`,
  eye: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  brain: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"></path></svg>`,
  plan: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
  guardrail: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
  act: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  outcome: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
};

const HERO_SCENARIOS = [
  {
    id: "CASE-1043",
    type: "CART_ABANDON",
    typeLabel: "Checkout Abandonment",
    amount: 2300,
    customer: "CUST_1022 (Returning Buyer)",
    status: "ACT",
    statusLabel: "Recovering",
    statusCls: "badge-blue",
    steps: [
      {
        num: 1,
        name: "OBSERVE",
        headerTitle: "1. OBSERVE",
        headerIcon: HERO_ICONS.eye,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:10 AM" },
          { icon: HERO_ICONS.calendar, text: "event type: <strong>CART_ABANDON</strong>" },
          { icon: HERO_ICONS.cart, text: "cart value: <strong>₹2,300</strong>" },
          { icon: HERO_ICONS.exit, text: "exit step: <strong>SHIPPING_RATE_SELECT</strong>" },
          { icon: HERO_ICONS.stopwatch, text: "session duration: <strong>4m 12s</strong>" },
          { icon: HERO_ICONS.user, text: "customer: <strong>CUST_1022 (Returning Buyer)</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Customer abandoned checkout while selecting shipping rate. High intent signal detected."
      },
      {
        num: 2,
        name: "REASON",
        headerTitle: "2. REASON",
        headerIcon: HERO_ICONS.brain,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:11 AM" },
          { icon: HERO_ICONS.trend, text: "intent score: <strong>0.82 (High Intent)</strong>" },
          { icon: HERO_ICONS.user, text: "customer segment: <strong>Returning Buyer (2 prior purchases)</strong>" },
          { icon: HERO_ICONS.tag, text: "price sensitivity: <strong>Express Shipping Charges</strong>" },
          { icon: HERO_ICONS.message, text: "eligible channels: <strong>WHATSAPP, SMS</strong>" },
          { icon: HERO_ICONS.gift, text: "recommended action: <strong>Offer Free Express Shipping</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Segment analysis indicates friction caused by unexpected express shipping fee. Strong purchase intent justifies targeted shipping incentive."
      },
      {
        num: 3,
        name: "PLAN",
        headerTitle: "3. PLAN",
        headerIcon: HERO_ICONS.plan,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:12 AM" },
          { icon: HERO_ICONS.tool, text: "proposed tool: <strong>offer_recovery_discount</strong>" },
          { icon: HERO_ICONS.phone, text: "channel enum: <strong>WHATSAPP_BUSINESS_API</strong>" },
          { icon: HERO_ICONS.file, text: "template ID: <strong>CART_RECOVERY_EXPRESS_WA</strong>" },
          { icon: HERO_ICONS.percent, text: "bounded discount: <strong>DISCOUNT_5_PCT</strong>" },
          { icon: HERO_ICONS.timer, text: "expires in: <strong>2 hours</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Agent formulated structured recovery proposal adhering strictly to bounded schema: WhatsApp channel with 5% free-shipping coupon valid for 2 hours."
      },
      {
        num: 4,
        name: "GUARDRAIL CHECK",
        headerTitle: "4. GUARDRAIL CHECK",
        headerIcon: HERO_ICONS.guardrail,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:12 AM" },
          { icon: HERO_ICONS.shield, text: "guardrail evaluation: <strong>9 of 9 rules evaluated</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #1 (Consent & Opt-in): <strong>PASSED — WhatsApp opt-in active</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #2 (Discount Cap): <strong>PASSED — 5% &le; 10% policy threshold</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #3 (Contact Frequency): <strong>PASSED — 0 messages in last 48h</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #4 (DND Curfew): <strong>PASSED — 09:58 AM within 09:00–21:00</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Deterministic 9-rule compliance engine verified all constraints. All frequency caps, opt-ins, and discount thresholds passed without veto."
      },
      {
        num: 5,
        name: "ACT",
        headerTitle: "5. ACT",
        headerIcon: HERO_ICONS.act,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:13 AM" },
          { icon: HERO_ICONS.send, text: "dispatched action: <strong>send_whatsapp_template</strong>" },
          { icon: HERO_ICONS.message, text: "channel: <strong>Meta WhatsApp Cloud API</strong>" },
          { icon: HERO_ICONS.hash, text: "message ID: <strong>wamid.HBgLOTE2M...829A</strong>" },
          { icon: HERO_ICONS.check, text: "delivery status: <strong>DELIVERED</strong>" },
          { icon: HERO_ICONS.card, text: "API cost: <strong>₹0.85</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Interactive WhatsApp recovery notification dispatched with 1-tap checkout resume link and pre-applied free shipping code."
      },
      {
        num: 6,
        name: "OBSERVE OUTCOME",
        headerTitle: "6. OBSERVE OUTCOME",
        headerIcon: HERO_ICONS.outcome,
        rows: [
          { icon: HERO_ICONS.clock, text: "09:58:25 AM" },
          { icon: HERO_ICONS.mouse, text: "interaction event: <strong>recovery_link_clicked</strong>" },
          { icon: HERO_ICONS.check, text: "payment status: <strong>PAYMENT_COMPLETED</strong>" },
          { icon: HERO_ICONS.dollar, text: "recovered revenue: <strong>₹2,300</strong>" },
          { icon: HERO_ICONS.trend, text: "net ROI: <strong>₹2,299.15 (2,700x ROI)</strong>" },
          { icon: HERO_ICONS.flag, text: "terminal state: <strong>RESOLVED_RECOVERED</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Customer clicked link within 12 seconds and authorized payment via UPI. ₹2,300 recovered with net ROI of 2,700x relative to dispatch cost."
      }
    ]
  },
  {
    id: "CASE-1042",
    type: "UPI_PAYMENT_FAIL",
    typeLabel: "Payment Failure",
    amount: 3499,
    customer: "CUST_051 (High LTV)",
    status: "RESOLVED",
    statusLabel: "Recovered",
    statusCls: "badge-teal",
    steps: [
      {
        num: 1,
        name: "OBSERVE",
        headerTitle: "1. OBSERVE",
        headerIcon: HERO_ICONS.eye,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:02 AM" },
          { icon: HERO_ICONS.calendar, text: "event type: <strong>UPI_PAYMENT_FAIL</strong>" },
          { icon: HERO_ICONS.card, text: "gateway: <strong>Razorpay / NPCI</strong>" },
          { icon: HERO_ICONS.alert, text: "decline code: <strong>NETWORK_TIMEOUT</strong>" },
          { icon: HERO_ICONS.dollar, text: "customer LTV: <strong>₹48,200</strong>" },
          { icon: HERO_ICONS.user, text: "customer: <strong>CUST_051 (High LTV)</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Involuntary decline received on NPCI switch due to transient bank timeout. Buyer intent remains completely intact."
      },
      {
        num: 2,
        name: "REASON",
        headerTitle: "2. REASON",
        headerIcon: HERO_ICONS.brain,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:03 AM" },
          { icon: HERO_ICONS.trend, text: "hypothesis: <strong>Transient switch latency, zero intent degradation</strong>" },
          { icon: HERO_ICONS.message, text: "eligible channels: <strong>WHATSAPP, SMS, SILENT_RETRY</strong>" },
          { icon: HERO_ICONS.tool, text: "policy cap: <strong>Max 3 retry attempts within 4 hours</strong>" },
          { icon: HERO_ICONS.gift, text: "target action: <strong>schedule_payment_retry (T+15m)</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "High LTV buyer with pristine payment history. Agent evaluates silent backup route retry to avoid customer friction."
      },
      {
        num: 3,
        name: "PLAN",
        headerTitle: "3. PLAN",
        headerIcon: HERO_ICONS.plan,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:04 AM" },
          { icon: HERO_ICONS.tool, text: "proposed tool: <strong>schedule_payment_retry</strong>" },
          { icon: HERO_ICONS.phone, text: "channel: <strong>AUTO_BANKING_SWITCH</strong>" },
          { icon: HERO_ICONS.timer, text: "backoff minutes: <strong>15 mins</strong>" },
          { icon: HERO_ICONS.percent, text: "discount enum: <strong>NONE</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Agent proposes automated switch retry with exponential backoff, adhering strictly to bounded tool declarations."
      },
      {
        num: 4,
        name: "GUARDRAIL CHECK",
        headerTitle: "4. GUARDRAIL CHECK",
        headerIcon: HERO_ICONS.guardrail,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:04 AM" },
          { icon: HERO_ICONS.shield, text: "guardrail evaluation: <strong>9 of 9 rules evaluated</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #4 (DND Curfew): <strong>PASSED — 10:31 AM daytime</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #5 (Rate Limiter): <strong>PASSED — Attempt 1 of 3</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #8 (Idempotency): <strong>PASSED — Key verified</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Deterministic compliance engine confirms idempotency key uniqueness and rate limits before executing bank call."
      },
      {
        num: 5,
        name: "ACT",
        headerTitle: "5. ACT",
        headerIcon: HERO_ICONS.act,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:06 AM" },
          { icon: HERO_ICONS.send, text: "dispatched action: <strong>schedule_payment_retry</strong>" },
          { icon: HERO_ICONS.card, text: "route: <strong>HDFC_DIRECT_SWITCH</strong>" },
          { icon: HERO_ICONS.hash, text: "idempotency key: <strong>rec_retry_1042_c8f3</strong>" },
          { icon: HERO_ICONS.check, text: "status: <strong>HTTP 202 ACCEPTED</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Dispatched silent idempotency-keyed payment retry to backup payment route without disturbing the customer."
      },
      {
        num: 6,
        name: "OBSERVE OUTCOME",
        headerTitle: "6. OBSERVE OUTCOME",
        headerIcon: HERO_ICONS.outcome,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:31:12 AM" },
          { icon: HERO_ICONS.calendar, text: "gateway event: <strong>payment.captured</strong>" },
          { icon: HERO_ICONS.dollar, text: "recovered amount: <strong>₹3,499</strong>" },
          { icon: HERO_ICONS.card, text: "net cost: <strong>₹0.00 (Silent API)</strong>" },
          { icon: HERO_ICONS.flag, text: "terminal state: <strong>RESOLVED_CAPTURED</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Webhook confirmed payment captured automatically on backup switch. ₹3,499 recovered with zero customer intervention."
      }
    ]
  },
  {
    id: "INV-9021",
    type: "INVOICE_OVERDUE",
    typeLabel: "Invoice Overdue",
    amount: 85000,
    customer: "ACME Corp (Enterprise Tier)",
    status: "ESCALATED",
    statusLabel: "Escalated",
    statusCls: "badge-rose",
    steps: [
      {
        num: 1,
        name: "OBSERVE",
        headerTitle: "1. OBSERVE",
        headerIcon: HERO_ICONS.eye,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:01 AM" },
          { icon: HERO_ICONS.file, text: "invoice ID: <strong>INV-9021</strong>" },
          { icon: HERO_ICONS.user, text: "client: <strong>ACME Corp (Enterprise Tier)</strong>" },
          { icon: HERO_ICONS.calendar, text: "due date: <strong>14 days overdue</strong>" },
          { icon: HERO_ICONS.dollar, text: "amount: <strong>₹85,000</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Enterprise Net-30 invoice overdue by 14 days without an active Promise-to-Pay on file."
      },
      {
        num: 2,
        name: "REASON",
        headerTitle: "2. REASON",
        headerIcon: HERO_ICONS.brain,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:02 AM" },
          { icon: HERO_ICONS.trend, text: "account risk: <strong>PO Mismatch suspected</strong>" },
          { icon: HERO_ICONS.user, text: "account relationship: <strong>Strategic Key Account ($120k ARR)</strong>" },
          { icon: HERO_ICONS.tool, text: "recommendation: <strong>Human escalation required (>₹50,000)</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Invoice exceeds automated threshold. Account relationship requires sensitive human desk intervention."
      },
      {
        num: 3,
        name: "PLAN",
        headerTitle: "3. PLAN",
        headerIcon: HERO_ICONS.plan,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:03 AM" },
          { icon: HERO_ICONS.tool, text: "proposed tool: <strong>escalate_to_human</strong>" },
          { icon: HERO_ICONS.user, text: "assignee: <strong>Enterprise AE Desk (Priya Sharma)</strong>" },
          { icon: HERO_ICONS.file, text: "brief: <strong>PO reconciliation dossier generated</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Agent proposes escalation to designated Enterprise AE rather than automated spam outreach."
      },
      {
        num: 4,
        name: "GUARDRAIL CHECK",
        headerTitle: "4. GUARDRAIL CHECK",
        headerIcon: HERO_ICONS.guardrail,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:03 AM" },
          { icon: HERO_ICONS.shield, text: "guardrail evaluation: <strong>9 of 9 rules evaluated</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #7 (Enterprise Threshold): <strong>ENFORCED — Human-in-the-Loop</strong>" },
          { icon: HERO_ICONS.check, text: "Rule #9 (Escalation Routing): <strong>PASSED — Assigned to Priya Sharma</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Deterministic Rule #7 strictly forbids automated outreach above ₹50,000. Human desk routing verified."
      },
      {
        num: 5,
        name: "ACT",
        headerTitle: "5. ACT",
        headerIcon: HERO_ICONS.act,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:05 AM" },
          { icon: HERO_ICONS.send, text: "action: <strong>create_crm_escalation_ticket</strong>" },
          { icon: HERO_ICONS.hash, text: "ticket ID: <strong>TICK-8841 (Priority: High)</strong>" },
          { icon: HERO_ICONS.timer, text: "SLA: <strong>60 minutes</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Created priority ticket in CRM with full context brief & reconciliation dossier for Account Executive."
      },
      {
        num: 6,
        name: "OBSERVE OUTCOME",
        headerTitle: "6. OBSERVE OUTCOME",
        headerIcon: HERO_ICONS.outcome,
        rows: [
          { icon: HERO_ICONS.clock, text: "10:35:15 AM" },
          { icon: HERO_ICONS.check, text: "escalation state: <strong>ACKNOWLEDGED_BY_AE</strong>" },
          { icon: HERO_ICONS.trend, text: "risk mitigated: <strong>Relationship protected, 0 brand churn</strong>" },
          { icon: HERO_ICONS.flag, text: "terminal state: <strong>ESCALATED_MANAGED</strong>" }
        ],
        calloutTitle: "What happened?",
        calloutDesc: "Account Executive acknowledged ticket. Client confirmed corrected PO number and scheduled PTP."
      }
    ]
  }
];

let heroCurrentScenarioIdx = 0;
let heroCurrentStepIdx = 0;
let heroAutoCycleTimer = null;

function initAgentHero() {
  const replayBtn = document.getElementById("btn-hero-replay");
  const inspectBtn = document.getElementById("btn-hero-inspect");
  const autoToggle = document.getElementById("hero-toggle-autocycle");
  const newRecoveryBtn = document.getElementById("btn-new-recovery");
  const viewReportsBtn = document.getElementById("btn-view-reports");
  const loginBtn = document.getElementById("btn-topbar-login");

  // Replay another case button
  replayBtn?.addEventListener("click", () => {
    heroCurrentScenarioIdx = (heroCurrentScenarioIdx + 1) % HERO_SCENARIOS.length;
    heroCurrentStepIdx = 0;
    renderHeroScenario(heroCurrentScenarioIdx, 0);
    resetAutoCycle();
  });

  // Inspect drawer button
  inspectBtn?.addEventListener("click", () => {
    const sc = HERO_SCENARIOS[heroCurrentScenarioIdx];
    if (sc) openCaseDrawer(sc.id);
  });

  // Action buttons
  newRecoveryBtn?.addEventListener("click", () => {
    switchTab("simulator");
  });

  viewReportsBtn?.addEventListener("click", () => {
    switchTab("reports");
  });

  loginBtn?.addEventListener("click", () => {
    showToast("You are currently logged in as Courtney Henry (Admin)");
  });

  // Stepper node click listeners
  const stepNodes = document.querySelectorAll(".hero-step-node");
  stepNodes.forEach((node) => {
    node.addEventListener("click", () => {
      const stepIdx = parseInt(node.getAttribute("data-step"), 10);
      if (!isNaN(stepIdx)) {
        heroCurrentStepIdx = stepIdx;
        renderActiveStep(heroCurrentScenarioIdx, heroCurrentStepIdx);
        resetAutoCycle();
      }
    });
  });

  // Auto-cycle toggle
  autoToggle?.addEventListener("change", () => {
    if (autoToggle.checked) {
      startAutoCycle();
    } else {
      stopAutoCycle();
    }
  });

  // Initial render matching image.png (Scenario 0, Step 0 = OBSERVE)
  renderHeroScenario(0, 0);
  startAutoCycle();
}

function renderHeroScenario(scenarioIndex, stepIndex = 0) {
  const sc = HERO_SCENARIOS[scenarioIndex];
  if (!sc) return;

  // Update metadata bar
  const metaCaseId = document.getElementById("hero-meta-case-id");
  const metaEventType = document.getElementById("hero-meta-event-type");
  const metaAmount = document.getElementById("hero-meta-amount");
  const metaCustomer = document.getElementById("hero-meta-customer");
  const metaStatus = document.getElementById("hero-meta-status");

  if (metaCaseId) metaCaseId.innerText = sc.id;
  if (metaEventType) metaEventType.innerText = sc.typeLabel;
  if (metaAmount) metaAmount.innerText = `₹${Number(sc.amount).toLocaleString("en-IN")}`;
  if (metaCustomer) metaCustomer.innerText = sc.customer;
  if (metaStatus) {
    metaStatus.className = `badge ${sc.statusCls}`;
    metaStatus.innerText = `State: ${sc.status}`;
  }

  heroCurrentStepIdx = stepIndex;
  renderActiveStep(scenarioIndex, stepIndex);
}

function renderActiveStep(scenarioIndex, stepIndex) {
  const sc = HERO_SCENARIOS[scenarioIndex];
  if (!sc || !sc.steps || !sc.steps[stepIndex]) return;

  const step = sc.steps[stepIndex];

  // Update Stepper Ribbon
  const stepNodes = document.querySelectorAll(".hero-step-node");
  stepNodes.forEach((node, idx) => {
    if (idx === stepIndex) {
      node.classList.add("active");
      node.classList.remove("completed");
    } else if (idx < stepIndex) {
      node.classList.remove("active");
      node.classList.add("completed");
    } else {
      node.classList.remove("active");
      node.classList.remove("completed");
    }
  });

  // Render into #hero-active-step-card matching image.png
  const cardContainer = document.getElementById("hero-active-step-card");
  if (!cardContainer) return;

  const rowsHtml = step.rows.map(r => `
    <div class="step-detail-row">
      ${r.icon}
      <span class="step-row-text">${r.text}</span>
    </div>
  `).join("");

  cardContainer.innerHTML = `
    <div class="active-step-header">
      ${step.headerIcon}
      <span class="active-step-title">${step.headerTitle}</span>
    </div>
    <div class="active-step-body">
      <div class="step-detail-left">
        ${rowsHtml}
      </div>
      <div class="step-detail-right">
        <div class="step-callout-card">
          <div class="step-callout-title">${step.calloutTitle}</div>
          <div class="step-callout-desc">${step.calloutDesc}</div>
        </div>
      </div>
    </div>
  `;
}

function startAutoCycle() {
  stopAutoCycle();
  heroAutoCycleTimer = setInterval(() => {
    const autoToggle = document.getElementById("hero-toggle-autocycle");
    if (activeTab === "overview" && autoToggle && autoToggle.checked) {
      const sc = HERO_SCENARIOS[heroCurrentScenarioIdx];
      if (!sc || !sc.steps) return;

      // Advance to next step, or if at last step, advance to next scenario
      if (heroCurrentStepIdx < sc.steps.length - 1) {
        heroCurrentStepIdx++;
        renderActiveStep(heroCurrentScenarioIdx, heroCurrentStepIdx);
      } else {
        heroCurrentScenarioIdx = (heroCurrentScenarioIdx + 1) % HERO_SCENARIOS.length;
        heroCurrentStepIdx = 0;
        renderHeroScenario(heroCurrentScenarioIdx, 0);
      }
    }
  }, 4000);
}

function stopAutoCycle() {
  if (heroAutoCycleTimer) {
    clearInterval(heroAutoCycleTimer);
    heroAutoCycleTimer = null;
  }
}

function resetAutoCycle() {
  const autoToggle = document.getElementById("hero-toggle-autocycle");
  if (autoToggle && autoToggle.checked) {
    startAutoCycle();
  }
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
