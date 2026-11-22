import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react';

export interface AuthPayload {
  user: { id: string; username: string; email: string; displayName: string; avatarUrl: string; createdAt: string };
  nexconn: { appKey: string; areaCode: string; userId: string; token: string };
}
type AuthPath = '/api/auth/login' | '/api/auth/register';
type AuthField = 'identifier' | 'username' | 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<AuthField, string>>;
interface Props { error: string; busy: boolean; onAuthenticate: (path: AuthPath, data: Record<string, string>) => Promise<void> }

export function LoginPage({ error, busy, onAuthenticate }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fields, setFields] = useState({ identifier: '', username: '', email: '', password: '', confirm: '' });
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const update = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = key === 'username' || key === 'identifier' ? event.target.value.replace(/\s/g, '') : event.target.value;
    setFields((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFormError(''); setFieldErrors({});
    if (mode === 'register' && fields.password !== fields.confirm) { setFieldErrors({ confirm: 'Passwords do not match.' }); return; }
    try {
      if (mode === 'login') await onAuthenticate('/api/auth/login', { identifier: fields.identifier, password: fields.password });
      else await onAuthenticate('/api/auth/register', { username: fields.username, email: fields.email, password: fields.password });
    } catch (cause) {
      const failure = cause as Error & { fieldErrors?: FieldErrors };
      if (failure.fieldErrors && Object.keys(failure.fieldErrors).length) setFieldErrors(failure.fieldErrors);
      else setFormError(failure instanceof Error ? failure.message : 'Unable to continue.');
    }
  };

  return <main className="auth-page">
    <header className="auth-topbar"><a className="auth-brand" href="#home"><img src="/nexconn-logo.png" alt="" /><span>Nexconn</span></a><span className="auth-topbar__label">Private messaging</span></header>
    <div className="auth-layout">
      <section className="auth-intro"><div className="auth-intro__eyebrow"><span /> Nexconn Chat</div><h1>Your conversations,<br /><em>connected.</em></h1><p>Find people and keep your one-to-one conversations in one place.</p>
        <div className="auth-feature"><span><MessageCircle size={18} /></span><div><strong>Direct conversations</strong><small>Start a private chat with a registered user.</small></div></div>
        <div className="auth-feature"><span><ShieldCheck size={18} /></span><div><strong>Your account stays protected</strong><small>Secure sign in with your own account.</small></div></div>
        <div className="auth-feature"><span><Smartphone size={18} /></span><div><strong>Ready on every screen</strong><small>Use Nexconn on desktop, tablet, or mobile.</small></div></div>
      </section>
      <section className="auth-card" aria-labelledby="signin-title">
        <div className="auth-card__heading"><div className="auth-card__mark"><img src="/nexconn-logo.png" alt="" /></div><div><h2 id="signin-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{mode === 'login' ? 'Sign in to your Nexconn account' : 'Join Nexconn to start messaging'}</p></div></div>
        <div className="auth-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setFormError(''); setFieldErrors({}); }}>Log in</button><button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setFormError(''); setFieldErrors({}); }}>Create account</button></div>
        <form onSubmit={submit} noValidate className="auth-form">
          {mode === 'login' ? <Field id="login-identifier" label="Username or email" error={fieldErrors.identifier} hint="Usernames have no spaces. Passwords are case-sensitive."><input id="login-identifier" name="identifier" required autoComplete="username" value={fields.identifier} onChange={update('identifier')} placeholder="Username or email" aria-invalid={Boolean(fieldErrors.identifier)} aria-describedby={fieldErrors.identifier ? 'login-identifier-error' : 'login-identifier-hint'} /></Field> : <>
            <Field id="register-username" label="Username" error={fieldErrors.username} hint="3–24 characters. Letters, numbers, dots, underscores, and hyphens; no spaces. Spaces are removed as you type."><input id="register-username" name="username" required minLength={3} maxLength={24} autoComplete="username" value={fields.username} onChange={update('username')} placeholder="Choose a username" aria-invalid={Boolean(fieldErrors.username)} aria-describedby={fieldErrors.username ? 'register-username-error' : 'register-username-hint'} /></Field>
            <Field id="register-email" label="Email" error={fieldErrors.email}><input id="register-email" name="email" required type="email" autoComplete="email" value={fields.email} onChange={update('email')} placeholder="you@example.com" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'register-email-error' : undefined} /></Field>
          </>}
          <Field id={`${mode}-password`} label="Password" error={fieldErrors.password} hint={mode === 'register' ? '10 characters minimum, 72 UTF-8 bytes maximum. Any characters are allowed; passwords are case-sensitive.' : 'Passwords are case-sensitive.'}><input id={`${mode}-password`} name="password" required type="password" minLength={mode === 'register' ? 10 : undefined} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={fields.password} onChange={update('password')} placeholder={mode === 'register' ? 'At least 10 characters' : 'Your password'} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? `${mode}-password-error` : `${mode}-password-hint`} /></Field>
          {mode === 'register' && <Field id="register-confirm" label="Confirm password" error={fieldErrors.confirm}><input id="register-confirm" name="confirmPassword" required type="password" autoComplete="new-password" value={fields.confirm} onChange={update('confirm')} placeholder="Enter your password again" aria-invalid={Boolean(fieldErrors.confirm)} aria-describedby={fieldErrors.confirm ? 'register-confirm-error' : undefined} /></Field>}
          {(formError || error) && <div className="auth-error" role="alert"><AlertCircle size={16} />{formError || error}</div>}
          <button type="submit" disabled={busy} className="auth-submit">{busy ? <><Loader2 size={17} className="auth-spinner" /> Please wait…</> : mode === 'login' ? 'Log in securely' : 'Create account'}</button>
        </form>
        <p className="auth-help">Your Nexconn connection is set up securely by the service. You do not need a developer key.</p>
      </section>
    </div><footer className="auth-footer">Nexconn · Secure real-time messaging</footer>
  </main>;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <div className="auth-field"><label htmlFor={id}>{label}</label><div className="auth-field__control auth-field__control--plain">{children}</div>{hint && <p className="auth-field__hint" id={`${id}-hint`}>{hint}</p>}{error && <p className="auth-field__error" id={`${id}-error`} role="alert"><AlertCircle size={14} />{error}</p>}</div>;
}
