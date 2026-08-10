import { useEffect, useState } from 'react';

export default function Account({ token }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      setError('');
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Unable to load account info.');
          return;
        }
        setProfile(data.user);
      } catch (err) {
        setError('Network error: unable to load account info.');
      }
    }

    if (token) {
      loadProfile();
    }
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);

    const form = event.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;

    if (!name || !email) {
      setError('Name and email are required.');
      setSaving(false);
      return;
    }

    if (newPassword && !currentPassword) {
      setError('Enter your current password to update to a new password.');
      setSaving(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, email, currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to update account.');
        return;
      }
      setProfile(data.user);
      setMessage('Account updated successfully.');
      form.currentPassword.value = '';
      form.newPassword.value = '';
    } catch (err) {
      setError('Network error: unable to update account.');
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="page-panel">
        <h2>Account</h2>
        <p>You must be signed in to update profile and password settings.</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page-panel">
        <h2>Account</h2>
        <p>Loading account info…</p>
      </div>
    );
  }

  return (
    <div className="page-panel">
      <h2>Account</h2>
      <p>Update your profile details and reset your password.</p>
      {error && <div className="auth-error">{error}</div>}
      {message && <div className="auth-success">{message}</div>}
      <form className="account-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input name="name" type="text" defaultValue={profile.name || ''} required />
        </label>
        <label>
          Email
          <input name="email" type="email" defaultValue={profile.email || ''} required />
        </label>
        <label>
          Current password
          <input name="currentPassword" type="password" placeholder="Current password" />
        </label>
        <label>
          New password
          <input name="newPassword" type="password" placeholder="Leave blank to keep current password" />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
