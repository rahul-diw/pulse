#!/bin/sh
# End-to-end: real API + real Python AI service + real SDK + real Express app + Socket.IO
cd "$(dirname "$0")/.."
(cd ai-service && python3 -m uvicorn app.main:app --port 8000 >/tmp/ai.log 2>&1) &
(cd backend && SEED_DEMO=false AI_URL=http://127.0.0.1:8000 PORT=4000 npx tsx src/index.ts >/tmp/be.log 2>&1) &
for i in $(seq 1 25); do curl -s localhost:4000/api/health >/dev/null && curl -s localhost:8000/health >/dev/null && break; sleep 1; done
cd backend && node scripts/e2e.mjs 2>&1 | cut -c1-300
pkill -f "tsx src/index.ts"; pkill -f "uvicorn app.main"; true
