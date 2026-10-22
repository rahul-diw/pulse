"""Pulse AI service: multivariate anomaly scoring (Isolation Forest) and similar-issue search (TF-IDF)."""
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sklearn.ensemble import IsolationForest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

app = FastAPI(title="Pulse AI service", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "pulse-ai", "version": app.version}


class Point(BaseModel):
    req: float
    err: float
    p95: float


class AnomalyReq(BaseModel):
    series: list[Point]


@app.post("/anomaly")
def anomaly(r: AnomalyReq):
    """Fit an Isolation Forest on the baseline (everything but the last 3 buckets) over [error rate, log latency, traffic]
    and score the most recent buckets. score ~0.4 is normal, above ~0.6 is clearly unusual."""
    n = len(r.series)
    if n < 30:
        return {"score": None, "reason": "not enough history"}
    X = np.array([[p.err / p.req if p.req else 0.0, np.log1p(p.p95), p.req] for p in r.series], dtype=float)
    model = IsolationForest(n_estimators=120, contamination="auto", random_state=0).fit(X[:-3])
    s = -model.score_samples(X[-3:])
    return {"score": round(float(s.mean()), 3), "per_bucket": [round(float(v), 3) for v in s]}


class Doc(BaseModel):
    id: str
    text: str


class SimilarReq(BaseModel):
    query: str
    docs: list[Doc]
    k: int = Field(4, ge=1, le=20)


@app.post("/similar")
def similar(r: SimilarReq):
    if not r.docs:
        return {"similar": []}
    vec = TfidfVectorizer(token_pattern=r"[A-Za-z][A-Za-z0-9]{2,}", sublinear_tf=True)
    X = vec.fit_transform([d.text for d in r.docs] + [r.query])
    sims = cosine_similarity(X[-1], X[:-1]).ravel()
    order = np.argsort(-sims)[: r.k]
    return {"similar": [{"id": r.docs[i].id, "score": round(float(sims[i]), 4)} for i in order if sims[i] > 0.05]}
