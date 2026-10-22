import numpy as np
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def series(n=63, spike=0):
    rng = np.random.default_rng(1)
    out = [{"req": float(rng.poisson(80)), "err": float(rng.binomial(80, 0.008)), "p95": float(rng.normal(110, 8))} for _ in range(n)]
    for i in range(spike):
        out[-1 - i] = {"req": 80.0, "err": 24.0, "p95": 640.0}
    return out


def test_health():
    assert c.get("/health").json()["status"] == "ok"


def test_anomaly_scores_spike_higher_than_normal():
    normal = c.post("/anomaly", json={"series": series()}).json()["score"]
    spiky = c.post("/anomaly", json={"series": series(spike=3)}).json()["score"]
    assert spiky > normal + 0.1 and spiky > 0.55


def test_anomaly_needs_history():
    assert c.post("/anomaly", json={"series": series(10)}).json()["score"] is None


def test_similar_finds_related_error_titles():
    docs = [{"id": "a", "text": "Error: connect ECONNREFUSED <n>.<n>.<n>:<n> (database)"}, {"id": "b", "text": "Payment gateway timeout after <n>ms"}, {"id": "c", "text": "SyntaxError: Unexpected token < in JSON at position <n>"}]
    r = c.post("/similar", json={"query": "Error: connect ECONNREFUSED redis cache", "docs": docs, "k": 2}).json()["similar"]
    assert r and r[0]["id"] == "a"


def test_similar_empty():
    assert c.post("/similar", json={"query": "x", "docs": []}).json()["similar"] == []
