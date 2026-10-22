import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { TLink, useGo } from '../components/nav';
import { setAuth } from '../store';
export default function Auth({ signup = false }: { signup?: boolean }) {
  const [sp] = useSearchParams(), go = useGo(), [f, setF] = useState({ orgName: '', name: '', email: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api('POST', signup ? '/auth/signup' : '/auth/login', f); setAuth(r); go(signup ? `/app/${r.project.id}/settings` : sp.get('next') || '/app') } catch (x: any) { setErr(x.message) } setBusy(false) };
  const demo = async (email: string, password: string) => { setErr(''); try { setAuth(await api('POST', '/auth/login', { email, password })); go('/app') } catch (x: any) { setErr(x.message) } };
  return (
    <div className="page auth"><div className="tag mono">{signup ? 'Create your workspace' : 'Welcome back'}</div><h1 className="big">{signup ? 'Start monitoring.' : 'Log in.'}</h1>
      <form onSubmit={submit}>{signup && <><input required minLength={2} placeholder="Company or team name" value={f.orgName} onChange={e => setF({ ...f, orgName: e.target.value })} /><input required minLength={2} placeholder="Your name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></>}
        <input required type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" /><input required type="password" minLength={signup ? 8 : 1} placeholder={signup ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete={signup ? 'new-password' : 'current-password'} />
        {err && <p className="err">{err}</p>}<button className="btn pr" disabled={busy}>{signup ? 'Create workspace' : 'Log in'}</button></form>
      <p className="m">{signup ? 'Already have an account?' : 'New to Pulse?'} <TLink to={signup ? '/login' : '/signup'} className="ul">{signup ? 'Log in' : 'Create a workspace'}</TLink></p>
      {!signup && <div className="demo"><span className="mono m">Try the live demo as</span><button className="btn" onClick={() => demo('owner@pulse.dev', 'Demo@123')}>Owner</button><button className="btn" onClick={() => demo('viewer@pulse.dev', 'Viewer@123')}>Viewer (read-only)</button></div>}
    </div>
  );
}
