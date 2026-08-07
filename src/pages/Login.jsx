export default function Login({ onLogin }) {
  return (
    <div className="login-shell">
      <div className="login-card">
        <h2>Login to Budget App</h2>
        <p>Enter your email and password to continue.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.target;
            const email = form.email.value.trim();
            const password = form.password.value.trim();
            if (!email || !password) return;
            onLogin({ email });
          }}
        >
          <label>
            Email
            <input name="email" type="email" placeholder="you@example.com" required />
          </label>
          <label>
            Password
            <input name="password" type="password" placeholder="••••••••" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}
