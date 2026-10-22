// Real API + real Python AI + real SDK + real Express app: outage -> incident, end to end.
import express from 'express';
import { io } from 'socket.io-client';
import { Pulse } from '../../sdk/pulse.mjs';
const API = 'http://localhost:4000', J = { 'content-type': 'application/json' };
const post = async (p, b, h = {}) => (await fetch(API + p, { method: 'POST', headers: { ...J, ...h }, body: JSON.stringify(b) })).json();
const get = async (p, tok) => (await fetch(API + p, { headers: { Authorization: 'Bearer ' + tok } })).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const su = await post('/api/auth/signup', { orgName: 'E2E Org', name: 'E2E Owner', email: 'e2e@x.com', password: 'Passw0rd!' }), tok = su.accessToken, pid = su.project.id, key = su.project.key;
console.log('signup: project', su.project.name, '| key', key.slice(0, 8) + '...');
const events = []; const sock = io(API, { transports: ['websocket'] });
await new Promise(r => sock.on('connect', r)); sock.emit('join', { token: tok, pid }); ['incident', 'live', 'issue'].forEach(e => sock.on(e, d => events.push(e)));
const pulse = new Pulse({ key, url: API, service: 'e2e-app', release: 'v1.0.0', flushMs: 500 });
const app = express(); app.use(pulse.middleware());
app.get('/ok', (_q, r) => r.send('ok')); app.get('/boom', (_q, _r) => { throw new Error('Cannot read properties of undefined (reading id)') });
app.use(pulse.errorHandler()); app.use((_e, _q, r, _n) => r.status(500).send('err'));
const srv = app.listen(0); const port = srv.address().port;
for (let i = 0; i < 30; i++) await fetch(`http://localhost:${port}/ok`); for (let i = 0; i < 5; i++) await fetch(`http://localhost:${port}/boom`); await pulse.flush();
const now = Date.now(), batch = [], rnd = () => Math.random();
for (let b = 0; b < 80; b++) for (let i = 0; i < 40; i++) { const t = now - 900_000 + b * 10_000 + i * 200; batch.push({ type: 'request', t, method: 'GET', route: '/ok', status: rnd() < 0.008 ? 500 : 200, ms: 30 + rnd() * 40, release: 'v1.0.0' }) }
for (let b = 0; b < 4; b++) for (let i = 0; i < 40; i++) { const t = now - 50_000 + b * 10_000 + i * 200; const bad = i % 2 === 0; batch.push({ type: 'request', t, method: 'POST', route: '/api/checkout', status: bad ? 500 : 200, ms: bad ? 900 : 60 }); if (bad) batch.push({ type: 'log', t, level: 'error', message: `Error: connect ECONNREFUSED 10.0.2.15:5432 (order ${i})`, service: 'e2e-app' }) }
await fetch(`${API}/api/ingest/deploy`, { method: 'POST', headers: { ...J, 'x-pulse-key': key }, body: JSON.stringify({ version: 'v1.0.1', note: 'e2e deploy' }) });
for (let i = 0; i < batch.length; i += 500) { const r = await fetch(`${API}/api/ingest`, { method: 'POST', headers: { ...J, 'x-pulse-key': key }, body: JSON.stringify({ events: batch.slice(i, i + 500) }) }); if (!r.ok) console.log('ingest failed', r.status, await r.text()) }
let inc = null; for (let i = 0; i < 20 && !inc; i++) { await sleep(1000); inc = (await get(`/api/p/${pid}/incidents`, tok)).find(x => x.status === 'open') }
const ov = await get(`/api/p/${pid}/overview?minutes=15`, tok), issues = await get(`/api/p/${pid}/issues`, tok);
console.log('overview: requests', ov.kpis.req, '| error rate', (ov.kpis.errRate * 100).toFixed(1) + '%', '| p95', Math.round(ov.kpis.p95) + 'ms', '| routes', ov.routes.map(r => r.route).join(', '));
console.log('issues:', issues.map(i => i.count + 'x ' + i.title.slice(0, 48)).join(' | '));
if (inc) { const det = await get(`/api/p/${pid}/incidents/${inc.id}`, tok); console.log('INCIDENT:', inc.severity, '|', inc.title, '| ml score', inc.ml ?? 'n/a'); console.log('  summary:', inc.summary); console.log('  hint:', inc.hints[0]); console.log('  similar past incidents:', det.similar.length, '| series points:', det.series.length) } else console.log('NO INCIDENT OPENED');
const iss = await get(`/api/p/${pid}/issues/${issues[0].id}`, tok); console.log('issue detail: similar source =', iss.source, '| similar:', iss.similar.length);
console.log('sockets received:', [...new Set(events)].join(', '));
const ai = await get(`/api/p/${pid}/ai`, tok); console.log('ai health:', JSON.stringify(ai.health), '| insights:', ai.insights.length);
await pulse.close(); srv.close(); sock.close(); process.exit(0);
