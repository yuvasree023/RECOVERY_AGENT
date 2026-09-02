"""Machine Learning Recovery Scorer for Recover AI Agent.

Trains a LogisticRegression model using time-based split:
- Train: Aug–Nov 2024
- Test/Validation: Dec 2024–Jan 2025

Features:
- Numeric: ltv, attempt_number (Standardized)
- Categorical One-Hot: segment (High, Medium, Low), decline_code, event_type
Target:
- resolved (0 or 1)
"""

import csv
import math
import os
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple


class RecoveryScorer:
    def __init__(self, data_dir: str = "data"):
        self.data_dir = data_dir
        self.is_trained = False
        self.weights: List[float] = []
        self.bias: float = 0.0
        self.means = [0.0, 0.0]  # ltv, attempt_number
        self.stds = [1.0, 1.0]
        self.feature_names: List[str] = []

    def _extract_features(
        self, segment: str, ltv: float, decline_code: str, attempt_number: int, event_type: str
    ) -> List[float]:
        # Numeric normalization
        norm_ltv = (ltv - self.means[0]) / self.stds[0] if self.stds[0] > 0 else 0.0
        norm_att = (attempt_number - self.means[1]) / self.stds[1] if self.stds[1] > 0 else 0.0

        vec = [norm_ltv, norm_att]

        # One-hot categories
        segments = ["High", "Medium", "Low"]
        declines = ["NETWORK_TIMEOUT", "INSUFFICIENT_FUNDS", "CARD_EXPIRED", "HIGH_SHIPPING_COST"]
        event_types = ["UPI_PAYMENT_FAIL", "CART_ABANDON", "SUBSCRIPTION_FAIL"]

        for s in segments:
            vec.append(1.0 if segment == s else 0.0)
        for d in declines:
            vec.append(1.0 if decline_code == d else 0.0)
        for e in event_types:
            vec.append(1.0 if event_type == e else 0.0)

        return vec

    def train(self):
        """Train model using time-based train/test split at 2024-12-01."""
        cust_path = os.path.join(self.data_dir, "customers.csv")
        evt_path = os.path.join(self.data_dir, "events.csv")
        out_path = os.path.join(self.data_dir, "outcomes.csv")

        customers: Dict[str, Dict[str, Any]] = {}
        if os.path.exists(cust_path):
            with open(cust_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    customers[r["customer_id"]] = {
                        "segment": r.get("segment", "Low"),
                        "ltv": float(r.get("ltv", 0.0)),
                    }

        outcomes: Dict[str, bool] = {}
        if os.path.exists(out_path):
            with open(out_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    outcomes[r["event_id"]] = r.get("resolved", "false").lower() == "true"

        split_date = datetime(2024, 12, 1, 0, 0, 0)
        train_samples = []

        if os.path.exists(evt_path):
            with open(evt_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    ts_str = r.get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    except Exception:
                        ts = datetime(2024, 10, 1)

                    if ts < split_date:
                        cid = r["customer_id"]
                        eid = r["event_id"]
                        cust = customers.get(cid, {"segment": "Low", "ltv": 0.0})
                        resolved = outcomes.get(eid, False)

                        train_samples.append({
                            "segment": cust["segment"],
                            "ltv": cust["ltv"],
                            "decline_code": r.get("decline_code", "NETWORK_TIMEOUT"),
                            "attempt_number": int(r.get("attempt_number", 1)),
                            "event_type": r.get("event_type", "UPI_PAYMENT_FAIL"),
                            "y": 1.0 if resolved else 0.0,
                        })

        if not train_samples:
            self.is_trained = True
            return

        ltvs = [s["ltv"] for s in train_samples]
        atts = [s["attempt_number"] for s in train_samples]
        self.means[0] = sum(ltvs) / len(ltvs)
        self.means[1] = sum(atts) / len(atts)
        self.stds[0] = math.sqrt(sum((x - self.means[0]) ** 2 for x in ltvs) / len(ltvs)) or 1.0
        self.stds[1] = math.sqrt(sum((x - self.means[1]) ** 2 for x in atts) / len(atts)) or 1.0

        X = []
        y = []
        for s in train_samples:
            X.append(self._extract_features(s["segment"], s["ltv"], s["decline_code"], s["attempt_number"], s["event_type"]))
            y.append(s["y"])

        n_features = len(X[0])
        self.weights = [0.0] * n_features
        self.bias = 0.0

        # Gradient Descent with L2 regularization
        lr = 0.05
        l2 = 0.01
        epochs = 600
        m = len(X)

        for _ in range(epochs):
            grad_w = [0.0] * n_features
            grad_b = 0.0
            for i in range(m):
                z = self.bias + sum(self.weights[j] * X[i][j] for j in range(n_features))
                z = max(-25.0, min(25.0, z))
                pred = 1.0 / (1.0 + math.exp(-z))
                err = pred - y[i]

                for j in range(n_features):
                    grad_w[j] += (err * X[i][j]) / m
                grad_b += err / m

            for j in range(n_features):
                self.weights[j] -= lr * (grad_w[j] + l2 * self.weights[j])
            self.bias -= lr * grad_b

        self.is_trained = True

    def predict(self, segment: str, ltv: float, decline_code: str, attempt_number: int, event_type: str) -> float:
        if not self.is_trained:
            self.train()

        vec = self._extract_features(segment, ltv, decline_code, attempt_number, event_type)
        z = self.bias + sum(self.weights[j] * vec[j] for j in range(len(vec)))
        z = max(-25.0, min(25.0, z))
        prob = 1.0 / (1.0 + math.exp(-z))
        return round(prob, 4)


_global_scorer: Optional[RecoveryScorer] = None


def get_scorer(data_dir: str = "data") -> RecoveryScorer:
    global _global_scorer
    if _global_scorer is None:
        _global_scorer = RecoveryScorer(data_dir)
        _global_scorer.train()
    return _global_scorer


def predict_recovery_probability(case_context: Dict[str, Any], data_dir: str = "data") -> float:
    """Convenience function to predict recovery probability from case dictionary/context."""
    scorer = get_scorer(data_dir)
    return scorer.predict(
        segment=case_context.get("segment", case_context.get("customer_segment", "Low")),
        ltv=float(case_context.get("ltv", 0.0)),
        decline_code=case_context.get("decline_code", "NETWORK_TIMEOUT"),
        attempt_number=int(case_context.get("attempt_number", case_context.get("current_attempt", 0)) + 1),
        event_type=case_context.get("event_type", "UPI_PAYMENT_FAIL"),
    )
