import { useSyncExternalStore } from 'react';
export interface Me { id: string; name: string; email: string; role: 'owner' | 'admin' | 'member' | 'viewer'; oid: string }
interface State { token: string; refresh: string; user: Me | null }
const KEY = 'pulse-state-v1', fresh = (): State => ({ token: '', refresh: '', user: null });
function load(): State { try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return fresh() } }
let state = load(); const subs = new Set<() => void>();
export const get = () => state;
export function set(p: Partial<State>) { state = { ...state, ...p }; try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* blocked */ } subs.forEach(f => f()) }
export function useStore<T>(sel: (s: State) => T): T { return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => sel(state)) }
export const setAuth = (r: { user: Me; accessToken: string; refreshToken: string }) => set({ user: r.user, token: r.accessToken, refresh: r.refreshToken });
export const logout = () => set({ user: null, token: '', refresh: '' });
export const canWrite = (r?: string) => r === 'owner' || r === 'admin', canAck = (r?: string) => r === 'owner' || r === 'admin' || r === 'member';
