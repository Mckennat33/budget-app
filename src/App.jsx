import { useState } from 'react';
import Overview from './pages/Overview';
import Transactions from './pages/Transactions';
import Categories from './pages/Categories';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import SignIn from './pages/SignIn';

const pages = [
  { key: 'overview', label: 'Overview', component: <Overview /> },
  { key: 'transactions', label: 'Transactions', component: <Transactions /> },
  { key: 'categories', label: 'Categories', component: <Categories /> },
  { key: 'goals', label: 'Goals', component: <Goals /> },
  { key: 'reports', label: 'Reports', component: <Reports /> },
  { key: 'settings', label: 'Settings', component: <Settings /> },
];

function App() {
  const [currentPage, setCurrentPage] = useState('overview');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');

  if (!user) {
    return (
      <SignIn
        onLogin={({ email, token: authToken }) => {
          setUser({ email });
          setToken(authToken);
        }}
      />
    );
  }

  const activePage = pages.find((page) => page.key === currentPage)?.component;

  return (
    <div className="app-shell">
      <header>
        <div className="brand-row">
          <div>
            <h1>Budget App</h1>
            <p>Welcome back, {user.email}</p>
          </div>
          <button
            className="logout-button"
            onClick={() => {
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
