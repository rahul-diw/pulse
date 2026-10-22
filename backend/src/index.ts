import http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config';
import { createCore } from '../../shared/core';
import { memoryStore } from '../../shared/store';
import { seedDemo, DEMO_KEY } from '../../shared/seed';
import { mongoStore } from './store-mongo';
import { nodeDeps } from './deps';
import { createApp } from './app';
const store = config.mongoUri ? await mongoStore(config.mongoUri) : memoryStore();
const server = http.createServer(), io = new Server(server, { cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') } });
const deps = nodeDeps((room, ev, d) => { io.to(room).emit(ev, d) }), core = createCore(store, deps);
if (config.seedDemo && !(await store.col('orgs').count())) { const t = Date.now(); await seedDemo(store, deps, core); console.log(`Seeded demo project in ${Date.now() - t}ms (owner@pulse.dev / Demo@123, key ${DEMO_KEY})`) }
io.on('connection', s => { s.on('join', async (m: { token?: string; pid?: string }) => { if (m?.token && m.pid && (await core.canJoin(m.token, m.pid))) s.join('p:' + m.pid) }) });
server.on('request', createApp(core));
const safe = (f: () => Promise<unknown>) => () => { f().catch(e => console.error(e)) };
setInterval(safe(() => core.tick()), 2000).unref(); setInterval(safe(() => core.watchdog()), 5000).unref(); setInterval(safe(() => core.runMonitors()), 20_000).unref(); setInterval(safe(() => core.cleanup()), 600_000).unref();
server.listen(config.port, () => console.log(`Pulse API on :${config.port} | db=${store.kind} | ai=${config.aiUrl}`));
