import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { usePoll, clock } from '../util';
import type { Ctx } from './AppLayout';
const LV = ['debug', 'info', 'warn', 'error', 'fatal'];
export default function Logs() {
  const { pid } = useOutletContext<Ctx>(), [levels, setLevels] = useState<string[]>(['info', 'warn', 'error', 'fatal']), [q, setQ] = useState(''), [svc, setSvc] = useState(''), [paused, setPaused] = useState(false), [open, setOpen] = useState<string | null>(null), [frozen, setFrozen] = useState<any[] | null>(null);
  const qs = `level=${levels.join(',')}${q ? '&q=' + encodeURIComponent(q) : ''}${svc ? '&service=' + svc : ''}&limit=120`, { data } = usePoll(() => api('GET', `/p/${pid}/logs?${qs}`), 2000, [pid, qs]);
  const rows: any[] = (paused ? frozen : data) || [], services = [...new Set((data || []).map((l: any) => l.service))];
  return (
    <div><div className="bar2"><div className="chips">{LV.map(l => <button key={l} className={'lv ' + l + (levels.includes(l) ? ' on' : '')} onClick={() => setLevels(levels.includes(l) ? levels.filter(x => x !== l) : [...levels, l])}>{l}</button>)}</div>
      <input placeholder="Search messages" value={q} onChange={e => setQ(e.target.value)} aria-label="Search logs" /><select value={svc} onChange={e => setSvc(e.target.value)} aria-label="Service"><option value="">All services</option>{services.map((s: any) => <option key={s}>{s}</option>)}</select>
      <button className="btn sm" onClick={() => { setFrozen(data); setPaused(!paused) }}>{paused ? 'Resume stream' : 'Pause'}</button><span className="live mono">{!paused && <i className="live-dot" />}{paused ? 'PAUSED' : 'STREAMING'}</span></div>
      <div className="logs card">{rows.map(l => <div key={l.id} className={'lg ' + l.level} onClick={() => setOpen(open === l.id ? null : l.id)}><span className="mono m">{clock(l.t)}</span><span className={'lvb ' + l.level}>{l.level}</span><span className="mono m svc">{l.service}</span><span className="msg">{l.message}</span>{open === l.id && <pre>{JSON.stringify({ id: l.id, release: l.release, fingerprint: l.fp, ...l.meta }, null, 2)}</pre>}</div>)}{!rows.length && <p className="m" style={{ padding: 20 }}>No logs match.</p>}</div></div>
  );
}
