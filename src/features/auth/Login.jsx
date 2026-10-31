import { useState } from 'react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { Alert, Button, Input, useAction } from '../../components/ui';
import { useCtx } from '../../app/AuthProvider';

export default function Login() {
  const { error: accountError } = useCtx();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, done, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(() => signInWithEmailAndPassword(auth, email.trim(), password));
  };
  const reset = () =>
    run(() => sendPasswordResetEmail(auth, email.trim()), 'If that email has an account, a reset link is on its way.');

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Techomato College ERP</h1>
        <p className="muted">Sign in with the email your college gave you.</p>
        <Alert kind="error">{error || accountError}</Alert>
        <Alert kind="ok">{done}</Alert>
        <div className="form-grid" style={{ flexDirection: 'column' }}>
          <Input label="Email" type="email" autoComplete="username" required value={email} onChange={setEmail} />
          <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <Button onClick={reset} disabled={busy || !email}>Forgot password? Email me a reset link</Button>
        </div>
      </form>
    </div>
  );
}
