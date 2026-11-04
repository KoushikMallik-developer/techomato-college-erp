import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { Alert, Button, Input, useAction } from '../../components/ui';
import { useCtx } from '../../app/AuthProvider';
import BrandMark from '../../components/BrandMark';
import { ThemeToggle } from '../../components/widgets';
import { loginEmail } from '../../lib/calc';

export default function Login() {
  const { error: accountError } = useCtx();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, done, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(() => signInWithEmailAndPassword(auth, loginEmail(email), password));
  };
  const reset = () =>
    run(() => sendPasswordResetEmail(auth, loginEmail(email)),'If that email has an account, a reset link is on its way.');

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="login-top"><Link to="/">← Back to home</Link><ThemeToggle /></div>
        <BrandMark size={36} />
        <h1>Techomato Colleges</h1>
        <p className="muted">Sign in with the email your college gave you.</p>
        <Alert kind="error">{error || accountError}</Alert>
        <Alert kind="ok">{done}</Alert>
        <div className="form-grid" style={{ flexDirection: 'column' }}>
          <Input label="Email or username" autoComplete="username" required value={email} onChange={setEmail} />
          <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <Button onClick={reset} disabled={busy || !email}>Forgot password? Email me a reset link</Button>
        </div>
      </form>
    </div>
  );
}
