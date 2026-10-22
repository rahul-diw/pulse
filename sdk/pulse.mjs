/**
 * Pulse SDK: zero dependencies, batches events, never throws into your app.
 *   import { Pulse } from './pulse.mjs';
 *   const pulse = new Pulse({ key: 'pk_...', url: 'https://your-pulse-api', service: 'api', release: 'v1.2.0' });
 *   app.use(pulse.middleware());            // Express: records every request (method, route, status, latency)
 *   app.use(pulse.errorHandler());          // put after your routes: captures exceptions as error logs
 *   pulse.log('info', 'order placed', { id: 42 }); pulse.metric('queue.depth', 12); await pulse.deploy('v1.2.0');
 */
export class Pulse {
  #q = []; #timer = null;
  constructor({ key, url = 'http://localhost:4000', service = 'app', release, flushMs = 2000, maxBatch = 200, debug = false } = {}) {
    if (!key) throw new Error('Pulse: key is required');
    Object.assign(this, { key, url: url.replace(/\/$/, ''), service, release, maxBatch, debug });
    this.#timer = setInterval(() => this.flush(), flushMs); this.#timer.unref?.();
  }
  #push(e) { this.#q.push({ service: this.service, release: this.release, ...e }); if (this.#q.length >= this.maxBatch) this.flush() }
  request({ method, route, status, ms, t }) { this.#push({ type: 'request', method, route, status, ms, ...(t ? { t } : {}) }) }
  log(level, message, meta, t) { this.#push({ type: 'log', level, message: String(message), ...(meta ? { meta } : {}), ...(t ? { t } : {}) }) }
  info(m, meta) { this.log('info', m, meta) } warn(m, meta) { this.log('warn', m, meta) } error(m, meta) { this.log('error', m, meta) }
  captureException(err, meta = {}) { this.log('error', `${err?.name || 'Error'}: ${err?.message || err}`, { ...meta, stack: String(err?.stack || '').split('\n').slice(0, 6).join('\n') }) }
  metric(name, value, t) { this.#q.push({ type: 'metric', name, value, ...(t ? { t } : {}) }) }
  async deploy(version, note = '') { return this.#post('/api/ingest/deploy', { version, note }) }
  async flush() {
    if (!this.#q.length) return; const events = this.#q.splice(0, 500);
    const ok = await this.#post('/api/ingest', { events }); if (!ok) { this.#q.unshift(...events.slice(0, 1000 - this.#q.length)) }
    if (this.#q.length) setImmediate(() => this.flush());
  }
  async #post(path, body) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try { const r = await fetch(this.url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pulse-key': this.key }, body: JSON.stringify(body), signal: ctl.signal }); if (!r.ok && this.debug) console.warn('[pulse]', r.status, await r.text()); return r.ok } catch (e) { if (this.debug) console.warn('[pulse]', e.message); return false } finally { clearTimeout(t) }
  }
  middleware() { return (req, res, next) => { const s = process.hrtime.bigint(); res.on('finish', () => { const route = (req.route && (req.baseUrl || '') + req.route.path) || 'unmatched'; this.request({ method: req.method, route, status: res.statusCode, ms: Number(process.hrtime.bigint() - s) / 1e6 }) }); next() } }
  errorHandler() { return (err, req, _res, next) => { this.captureException(err, { route: req.path }); next(err) } }
  async close() { clearInterval(this.#timer); await this.flush() }
}
