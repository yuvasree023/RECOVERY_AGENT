"""Historical Batch Runner & A/B Simulation for Recover AI Agent.

Replays all 223 historical events through the autonomous ReAct Agent Loop:
- Chronological event ordering
- 20% seeded randomized control group split
- Tracks financial metrics: Gross Recovered, Cost, Net Yield, Incremental Lift, ROI
- Validates 0 compliance violations across the entire run
- Generates and writes BatchReport.json
"""

import csv
import json
import os
import random
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

from models import Customer, EventRecord, OutcomeRecord, ChannelCostRecord, RecoveryCase, AuditLog, CaseState
from agent_loop import AgentRunner


def load_dataset(data_dir: str = "data"):
    customers: Dict[str, Customer] = {}
    cust_path = os.path.join(data_dir, "customers.csv")
    if os.path.exists(cust_path):
        with open(cust_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                cid = r["customer_id"]
                if cid not in customers:
                    customers[cid] = Customer(
                        customer_id=cid,
                        segment=r.get("segment", "Low"),
                        ltv=float(r.get("ltv", 0.0)),
                        whatsapp_consent=r.get("whatsapp_consent", "false").lower() == "true",
                        opt_out_status=r.get("opt_out_status", "false").lower() == "true",
                    )

    events: List[EventRecord] = []
    evt_path = os.path.join(data_dir, "events.csv")
    if os.path.exists(evt_path):
        with open(evt_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                ts_str = r.get("timestamp", "")
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                except Exception:
                    ts = datetime(2024, 10, 1)

                events.append(EventRecord(
                    event_id=r["event_id"],
                    customer_id=r["customer_id"],
                    event_type=r.get("event_type", "UPI_PAYMENT_FAIL"),
                    amount=float(r.get("amount", 0.0)),
                    status=r.get("status", "FAILED"),
                    timestamp=ts,
                    decline_code=r.get("decline_code", "NETWORK_TIMEOUT"),
                    attempt_number=int(r.get("attempt_number", 1)),
                    fraud_score=float(r.get("fraud_score", 0.0)),
                    retry_cooldown_hours=int(r.get("retry_cooldown_hours", 2)),
                    ptp_date=r.get("ptp_date") or None,
                ))

    outcomes: Dict[str, OutcomeRecord] = {}
    out_path = os.path.join(data_dir, "outcomes.csv")
    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                eid = r["event_id"]
                res_ts_str = r.get("resolution_timestamp")
                res_ts = None
                if res_ts_str:
                    try:
                        res_ts = datetime.fromisoformat(res_ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    except Exception:
                        pass

                outcomes[eid] = OutcomeRecord(
                    event_id=eid,
                    resolved=r.get("resolved", "false").lower() == "true",
                    resolution_channel=r.get("resolution_channel") or None,
                    resolved_amount=float(r.get("resolved_amount", 0.0)),
                    resolution_timestamp=res_ts,
                )

    return customers, events, outcomes


def run_batch_simulation(
    data_dir: str = "data",
    control_pct: float = 0.20,
    random_seed: int = 42,
    output_file: str = "batch_report.json"
) -> Dict[str, Any]:
    customers, events, outcomes = load_dataset(data_dir)

    # Sort chronologically
    events.sort(key=lambda e: e.timestamp)
    total_events = len(events)

    # Deterministic control group sampling
    rng = random.Random(random_seed)
    indices = list(range(total_events))
    rng.shuffle(indices)
    control_count = int(round(total_events * control_pct))
    control_indices = set(indices[:control_count])

    runner = AgentRunner(data_dir=data_dir)
    cases: List[RecoveryCase] = []
    audit_logs: List[AuditLog] = []

    for idx, evt in enumerate(events):
        is_ctrl = idx in control_indices
        cust = customers.get(evt.customer_id, Customer(
            customer_id=evt.customer_id, segment="Low", ltv=0.0, whatsapp_consent=False, opt_out_status=False
        ))
        outcome = outcomes.get(evt.event_id)

        case = RecoveryCase(
            case_id=str(uuid.uuid4()),
            event_id=evt.event_id,
            customer_id=evt.customer_id,
            current_state=CaseState.INIT,
            current_attempt=0,
            max_attempts=3,
            loop_iterations=0,
            max_loop_iterations=4,
            is_control_group=is_ctrl,
            total_recovered_amount=0.0,
            total_cost_incurred=0.0,
        )

        runner.run_case(case, evt, cust, outcome, audit_sink=audit_logs)
        cases.append(case)

    # Metric calculations
    treatment_cases = [c for c in cases if not c.is_control_group]
    control_cases = [c for c in cases if c.is_control_group]

    n_treat = len(treatment_cases)
    t_resolved = [c for c in treatment_cases if c.current_state == CaseState.RESOLVED]
    t_rate = len(t_resolved) / n_treat if n_treat > 0 else 0.0

    gross_recovered = sum(c.total_recovered_amount for c in treatment_cases)
    total_cost = sum(c.total_cost_incurred for c in treatment_cases)
    net_recovered = gross_recovered - total_cost

    n_ctrl = len(control_cases)
    c_resolved = [c for c in control_cases if c.current_state == CaseState.RESOLVED]
    c_rate = len(c_resolved) / n_ctrl if n_ctrl > 0 else 0.0

    incremental_lift = (t_rate - c_rate) * 100.0
    roi_multiple = (net_recovered / total_cost) if total_cost > 0 else 0.0

    # Compliance check: Scan audit logs for violations
    compliance_violations = 0
    case_map = {c.case_id: c for c in cases}
    for log in audit_logs:
        if log.step.value == "ACT":
            c = case_map.get(log.case_id)
            if c and c.is_control_group:
                compliance_violations += 1
            cust = customers.get(c.customer_id if c else "")
            if cust and cust.opt_out_status:
                compliance_violations += 1

    # Breakdown by decline code
    decline_breakdown: Dict[str, Dict[str, Any]] = {}
    evt_map = {e.event_id: e for e in events}

    for c in treatment_cases:
        e = evt_map.get(c.event_id)
        code = e.decline_code if e else "UNKNOWN"
        if code not in decline_breakdown:
            decline_breakdown[code] = {
                "total": 0, "resolved": 0, "recovered": 0.0, "cost": 0.0, "resolution_rate": 0.0, "net_recovered": 0.0
            }
        b = decline_breakdown[code]
        b["total"] += 1
        if c.current_state == CaseState.RESOLVED:
            b["resolved"] += 1
            b["recovered"] += c.total_recovered_amount
        b["cost"] += c.total_cost_incurred

    for k, v in decline_breakdown.items():
        v["resolution_rate"] = round(v["resolved"] / v["total"], 4) if v["total"] > 0 else 0.0
        v["net_recovered"] = round(v["recovered"] - v["cost"], 2)
        v["recovered"] = round(v["recovered"], 2)
        v["cost"] = round(v["cost"], 2)

    # Breakdown by Playbook
    playbook_breakdown: Dict[str, Dict[str, Any]] = {
        "Payment Failure Recovery (UPI/SUB)": {"total": 0, "resolved": 0, "recovered": 0.0, "cost": 0.0, "resolution_rate": 0.0, "net_recovered": 0.0},
        "Checkout Drop-off Recovery (CART)": {"total": 0, "resolved": 0, "recovered": 0.0, "cost": 0.0, "resolution_rate": 0.0, "net_recovered": 0.0},
    }

    for c in treatment_cases:
        e = evt_map.get(c.event_id)
        pb = "Checkout Drop-off Recovery (CART)" if (e and e.event_type == "CART_ABANDON") else "Payment Failure Recovery (UPI/SUB)"
        b = playbook_breakdown[pb]
        b["total"] += 1
        if c.current_state == CaseState.RESOLVED:
            b["resolved"] += 1
            b["recovered"] += c.total_recovered_amount
        b["cost"] += c.total_cost_incurred

    for k, v in playbook_breakdown.items():
        v["resolution_rate"] = round(v["resolved"] / v["total"], 4) if v["total"] > 0 else 0.0
        v["net_recovered"] = round(v["recovered"] - v["cost"], 2)
        v["recovered"] = round(v["recovered"], 2)
        v["cost"] = round(v["cost"], 2)

    t_terminated = [c for c in treatment_cases if c.current_state == CaseState.TERMINATED]
    t_escalated = [c for c in treatment_cases if c.current_state == CaseState.ESCALATED]

    report = {
        "batch_summary": {
            "total_events_processed": total_events,
            "treatment_cases_count": n_treat,
            "control_cases_count": n_ctrl,
            "treatment_resolution_rate": round(t_rate, 4),
            "control_resolution_rate": round(c_rate, 4),
            "incremental_lift_percentage_points": round(incremental_lift, 2),
            "gross_recovered_amount": round(gross_recovered, 2),
            "total_cost_incurred": round(total_cost, 2),
            "net_recovered_amount": round(net_recovered, 2),
            "roi_multiple": round(roi_multiple, 1),
            "compliance_violations_count": compliance_violations,
            "escalation_rate": round(len(t_escalated) / n_treat, 4) if n_treat > 0 else 0.0,
            "termination_rate": round(len(t_terminated) / n_treat, 4) if n_treat > 0 else 0.0,
        },
        "breakdown_by_decline_code": decline_breakdown,
        "breakdown_by_playbook": playbook_breakdown,
    }

    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

    return report


if __name__ == "__main__":
    print("Executing Recover AI Agent Batch Replay Simulation...")
    rep = run_batch_simulation()
    print("=" * 60)
    print("BATCH REPLAY RESULTS:")
    print(f"Total Events Processed: {rep['batch_summary']['total_events_processed']}")
    print(f"Treatment Cases: {rep['batch_summary']['treatment_cases_count']} | Control: {rep['batch_summary']['control_cases_count']}")
    print(f"Gross Recovered: ₹{rep['batch_summary']['gross_recovered_amount']:,.2f}")
    print(f"Total Cost Incurred: ₹{rep['batch_summary']['total_cost_incurred']:,.2f}")
    print(f"Net Recovered: ₹{rep['batch_summary']['net_recovered_amount']:,.2f}")
    print(f"Incremental Lift: {rep['batch_summary']['incremental_lift_percentage_points']:+.2f}%")
    print(f"ROI Multiple: {rep['batch_summary']['roi_multiple']:,.1f}x")
    print(f"Compliance Violations: {rep['batch_summary']['compliance_violations_count']}")
    print("=" * 60)
