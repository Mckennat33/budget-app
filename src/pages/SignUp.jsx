import { useState } from 'react';

export default function SignUp({ onLogin }) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    const form = event.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value.trim();
    if (!name || !email || !password) {
      setError('Name, email, and password are required.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to register.');
        return;
      }

      setMessage('Account created successfully.');
      onLogin({ email: data.user.email, name: data.user.name, token: data.token });
    } catch (err) {
      setError('Network error: unable to register.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>Create an account</h2>
      <p>Register to use the budget app and start tracking your finances.</p>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}
      <label>
        Name
        <input name="name" type="text" placeholder="Your name" required />
      </label>
      <label>
        Email
        <input name="email" type="email" placeholder="you@example.com" required />
      </label>
      <label>
        Password
        <input name="password" type="password" placeholder="••••••••" required />
      </label>
      <button type="submit" disabled={loading}>
        {loading ? 'Signing up…' : 'Sign up'}
      </button>
    </form>
  );
}
