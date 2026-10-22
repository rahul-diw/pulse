import { useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { TLink } from '../components/nav';
import { Status, Empty } from '../components/ui';
import { usePoll, ago, clock, fmtNum } from '../util';
import { canAck } from '../store';
import type { Ctx } from './AppLayout';
export function IssueList() {
  const { pid } = useOutletContext<Ctx>(), [tab, setTab] = useState('open'), { data } = usePoll(() => api('GET', `/p/${pid}/issues`), 4000, [pid]), all: any[] = data || [], list = all.filter(i => tab === 'all' || i.status === tab);
  return (
    <div><div className="chips">{['open', 'resolved', 'ignored', 'all'].map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t} <small>{t === 'all' ? all.length : all.filter(i => i.status === t).length}</small></button>)}</div>
      <div className="card tw"><table><thead><tr><th>Issue</th><th>Level</th><th>Service</th><th>Events</th><th>Last seen</th><th>Status</th></tr></thead><tbody>{list.map(i => <tr key={i.id} className="clk"><td><TLink to={`/app/${pid}/issues/${i.id}`} data-cur="Open"><span className="mono">{i.title}</span>{i.regressed && <span className="tg warn">regressed</span>}</TLink></td><td><span className={'lvb ' + i.level}>{i.level}</span></td><td className="m mono">{i.service}</td><td>{fmtNum(i.count)}</td><td className="m">{ago(i.lastSeen)}</td><td><Status s={i.status} /></td></tr>)}</tbody></table>{!list.length && <p className="m" style={{ padding: 20 }}>Nothing here. Errors are grouped automatically as they arrive.</p>}</div></div>
  );
}
export function IssueDetail() {
  const { pid, role } = useOutletContext<Ctx>(), { iid } = useParams(), [d, setD] = useState<any>(null), [err, setErr] = useState('');
  useEffect(() => { setD(null); api('GET', `/p/${pid}/issues/${iid}`).then(setD).catch(e => setErr(e.message)) }, [pid, iid]);
  if (err) return <div><h2 className="big sm">Not found.</h2><p className="m">{err}</p></div>; if (!d) return <div className="skel" />;
  const is = d.issue, max = Math.max(...d.trend.map((x: any) => x.n), 1), set = async (status: string) => setD({ ...d, issue: await api('PATCH', `/p/${pid}/issues/${iid}`, { status }) });
  return (
    <div className="detail"><TLink to={`/app/${pid}/issues`} className="mono m">&larr; All issues</TLink>
      <div className="dh"><div><span className={'lvb ' + is.level}>{is.level}</span> <Status s={is.status} />{is.regressed && <span className="tg warn">regression</span>}<h2 className="mono ttl">{is.title}</h2><p className="m">{is.service} &middot; {fmtNum(is.count)} events &middot; first seen {ago(is.firstSeen)} &middot; last seen {ago(is.lastSeen)}</p></div>
        {canAck(role) && <div className="acts">{is.status !== 'resolved' && <button className="btn pr" onClick={() => set('resolved')}>Resolve</button>}{is.status !== 'ignored' && <button className="btn" onClick={() => set('ignored')}>Ignore</button>}{is.status !== 'open' && <button className="btn" onClick={() => set('open')}>Reopen</button>}</div>}</div>
      <div className="grid2"><div className="card"><h3>Events, last hour</h3><div className="bars">{d.trend.map((x: any, i: number) => <div key={i} className="bcol"><u style={{ height: Math.max(3, (x.n / max) * 100) + '%', animationDelay: i * 40 + 'ms' }} /><span className="mono m">{x.n}</span></div>)}</div></div>
        <div className="card"><h3>What this probably means</h3>{d.hints.length ? d.hints.map((h: string) => <p key={h} className="hint">{h}</p>) : <p className="m">No known pattern. Read the sample below and check the code path.</p>}</div></div>
      <div className="card"><h3>Latest events</h3>{d.samples.map((l: any) => <div key={l.id} className="lg error"><span className="mono m">{clock(l.t)}</span><span className="mono m svc">{l.service}</span><span className="msg">{l.message}</span>{l.meta && <pre>{JSON.stringify(l.meta, null, 2)}</pre>}</div>)}</div>
      {d.similar.length > 0 && <section className="rec"><div className="rech"><h3>Similar issues</h3><span className="m">Ranked by text similarity ({d.source === 'python' ? 'Python TF-IDF model' : 'built-in model'})</span></div><div className="recs">{d.similar.map((s: any) => <TLink key={s.issue.id} to={`/app/${pid}/issues/${s.issue.id}`} className="card rc" data-cur="Open"><span className="mono">{s.issue.title}</span><span className="m">{fmtNum(s.issue.count)} events &middot; {Math.round(s.score * 100)}% similar</span></TLink>)}</div></section>}
    </div>
  );
}
