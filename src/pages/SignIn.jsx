import { useState } from 'react';

export default function SignIn({ onLogin }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const form = event.target;
    const email = form.email.value.trim();
    const password = form.password.value.trim();
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to sign in.');
        return;
      }

      onLogin({ email: data.user.email, token: data.token });
    } catch (err) {
      setError('Network error: unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>Sign in</h2>
      <p>Use your account credentials to sign in.</p>
      {error && <div className="auth-error">{error}</div>}
      <label>
        Email
        <input name="email" type="email" placeholder="you@example.com" required />
      </label>
      <label>
        Password
        <input name="password" type="password" placeholder="••••••••" required />
      </label>
      <button type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
