import { useState } from 'react';

function App() {
  const [message, setMessage] = useState('Upload a bank statement to compare months.');

  return (
    <div className="app-shell">
      <header>
        <h1>Budget App</h1>
        <p>Upload your bank statements and compare month-over-month finances.</p>
      </header>

      <main>
        <section className="upload-card">
          <p>{message}</p>
          <label className="file-input-label">
            Select CSV file
            <input type="file" accept=".csv" />
          </label>
        </section>
      </main>
    </div>
  );
}

export default App;
