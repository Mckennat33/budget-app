import { useEffect, useState } from 'react';
import Overview from './pages/Overview';
import Transactions from './pages/Transactions';
import Categories from './pages/Categories';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import Account from './pages/Account';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';

function App() {
  const [currentPage, setCurrentPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('authToken') || '');
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    async function restoreUser() {
      if (!token || user) return;
      try {
        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          localStorage.removeItem('authToken');
          setToken('');
          setUser(null);
          return;
        }
        const data = await response.json();
        setUser({ email: data.user.email, name: data.user.name });
      } catch (error) {
        console.error('Unable to restore user session:', error);
      }
    }

    restoreUser();
  }, [token, user]);

  const pages = [
    { key: 'overview', label: 'Overview', component: <Overview token={token} /> },
    { key: 'transactions', label: 'Transactions', component: <Transactions /> },
    { key: 'categories', label: 'Categories', component: <Categories /> },
    { key: 'goals', label: 'Goals', component: <Goals /> },
    { key: 'reports', label: 'Reports', component: <Reports /> },
    { key: 'settings', label: 'Account', component: <Account token={token} /> },
  ];

  if (!user) {
    const AuthForm = isRegistering ? SignUp : SignIn;
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="auth-toggle">
            <button
              type="button"
              className={!isRegistering ? 'auth-tab active' : 'auth-tab'}
              onClick={() => setIsRegistering(false)}
            >
              Sign in
            </button>
            <button
              type="button"
              className={isRegistering ? 'auth-tab active' : 'auth-tab'}
              onClick={() => setIsRegistering(true)}
            >
              Sign up
            </button>
          </div>
          <AuthForm
            onLogin={({ email, name, token: authToken }) => {
              localStorage.setItem('authToken', authToken);
              setUser({ email, name });
              setToken(authToken);
            }}
          />
        </div>
      </div>
    );
  }

  const activePage = pages.find((page) => page.key === currentPage)?.component;

  return (
    <div className="app-shell">
      <header>
        <div className="brand-row">
          <div>
            <h1>Budget App</h1>
            <p>Welcome back, {user.name || user.email}</p>
          </div>
          <button
            className="logout-button"
            onClick={() => {
              localStorage.removeItem('authToken');
              setUser(null);
              setToken('');
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <nav className="nav-grid">
        {pages.map((page) => (
          <button
            type="button"
            key={page.key}
            className={page.key === currentPage ? 'nav-item active' : 'nav-item'}
            onClick={() => setCurrentPage(page.key)}
          >
            {page.label}
          </button>
        ))}
      </nav>

      <main>{activePage}</main>
    </div>
  );
}

export default App;
