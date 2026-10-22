import { io, type Socket } from 'socket.io-client';
import { DEMO } from './api';
import { bindBus, demoCore } from './demo';
type CB = (d: any) => void;
const subs = new Map<string, Set<CB>>(); let sock: Socket | null = null, cur = { token: '', pid: '' };
const fire = (_r: string, e: string, d: unknown) => subs.get(e)?.forEach(f => f(d));
export function on(ev: string, cb: CB) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev)!.add(cb); return () => { subs.get(ev)!.delete(cb) } }
export function startRealtime() {
  if (DEMO) { bindBus(fire); demoCore(); return }
  if (sock) return; sock = io((import.meta.env.VITE_WS_URL as string | undefined) || undefined, { transports: ['websocket', 'polling'] });
  ['live', 'incident', 'issue', 'deploy', 'monitor', 'scenario'].forEach(e => sock!.on(e, d => fire('', e, d))); sock.on('connect', () => { if (cur.pid) sock!.emit('join', cur) });
}
/** Subscribe this tab to one project's live events. */
export function join(token: string, pid: string) { cur = { token, pid }; sock?.emit('join', cur) }
