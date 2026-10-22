import { get, set, logout } from './store';
import { demoCore } from './demo';
export const DEMO = import.meta.env.MODE === 'demo';
const BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (DEMO) { const [p, qs] = path.split('?'), core = await demoCore(), r = await core.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, token: get().token || undefined }); if (r.status >= 400) throw new Error(r.body.error || 'Request failed'); return r.body as T }
  const go = () => fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(get().token ? { Authorization: 'Bearer ' + get().token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let r = await go();
  if (r.status === 401 && get().refresh) { const rr = await fetch(BASE + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: get().refresh }) }); if (rr.ok) { set({ token: (await rr.json()).accessToken }); r = await go() } else logout() }
  const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Request failed'); return data as T;
}
