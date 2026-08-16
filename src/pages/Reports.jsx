import { useEffect, useState } from 'react';

const currency = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function Reports({ token }) {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState('waste');
  const [month, setMonth] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/reports', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json();
        if (response.ok) setReports(payload.reports || []);
      } catch {
        // The picker falls back to the one report we know exists.
      }
    })();
  }, [token]);

  const runReport = async (monthOverride) => {
    setRunning(true);
    setError('');
    try {
      const target = monthOverride ?? month;
      const query = target ? `?month=${target}` : '';
      const response = await fetch(`/api/reports/${selected}${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to run this report.');
      setResult(payload);
      if (payload.month) setMonth(payload.month);
    } catch (runError) {
      setError(runError.message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const options = reports.length > 0
    ? reports
    : [{ id: 'waste', name: 'Where am I wasting money', description: 'Finds the spending most worth cutting.', available: true }];

  return (
    <div className="page-panel reports-page">
      <section>
        <h2>Reports</h2>
        <p className="reports-subtitle">Run an analysis over your statements.</p>
      </section>

      {error && <div className="overview-error">{error}</div>}

      <section className="report-picker">
        {options.map((report) => (
          <button
            type="button"
            key={report.id}
            className={`report-option ${selected === report.id ? 'selected' : ''} ${report.available ? '' : 'unavailable'}`}
            onClick={() => report.available && setSelected(report.id)}
            disabled={!report.available}
            aria-pressed={selected === report.id}
          >
            <span className="report-option-name">
              {report.name}
              {!report.available && <span className="report-soon">Coming soon</span>}
            </span>
            <span className="report-option-desc">{report.description}</span>
          </button>
        ))}
      </section>

      <section className="report-run">
        {result?.availableMonths?.length > 0 && (
          <label className="report-month">
            <span>Month</span>
            <select
              value={month}
              onChange={(event) => { setMonth(event.target.value); runReport(event.target.value); }}
            >
              {result.availableMonths.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="upload-button" onClick={() => runReport()} disabled={running}>
          {running ? 'Running...' : 'Run report'}
        </button>
      </section>

      {result && !result.hasData && (
        <section className="goals-card">
          <div className="section-title">No statements yet</div>
          <p className="goals-help">
            This report reads your uploaded statements. Upload one from the Overview page
            and run it again.
          </p>
        </section>
      )}

      {result?.hasData && (
        <>
          <section className="report-headline">
            <div className="report-headline-figure">
              <span className="k">Worth cutting</span>
              <span className="v">{currency(result.potentialSaving)}</span>
              <span className="sub">a month</span>
            </div>
            <div className="report-headline-note">
              <p>
                Out of {currency(result.reviewedTotal)} reviewed in {result.monthLabel}. Rent,
                loan payments and investing are left out — they aren&rsquo;t waste.
              </p>
              {result.potentialSaving > 0 && (
                <p className="report-annual">
                  That&rsquo;s {currency(result.potentialSaving * 12)} over a year.
                </p>
              )}
            </div>
          </section>

          <section className="goals-card">
            <div className="section-title">What to look at first</div>
            {result.opportunities.length === 0 ? (
              <p className="goals-help">
                Nothing stood out this month — no repeat merchants, rising costs or fees
                worth flagging.
              </p>
            ) : (
              <ol className="opportunity-list">
                {result.opportunities.map((item, index) => (
                  <li key={`${item.title}-${index}`} className="opportunity">
                    <div className="opportunity-head">
                      <span className={`opportunity-kind kind-${item.kind.toLowerCase()}`}>{item.kind}</span>
                      <span className="opportunity-title">{item.title}</span>
                      <span className="opportunity-saving">{currency(item.saving)}</span>
                    </div>
                    <p className="opportunity-detail">{item.detail}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="goals-card">
            <div className="section-title">Where the money went in {result.monthLabel}</div>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Category</th>
                    <th className="num">Visits</th>
                    <th className="num">Average</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.topMerchants.map((entry) => (
                    <tr key={entry.name}>
                      <td>{entry.name}</td>
                      <td className="muted">{entry.category}</td>
                      <td className="num">{entry.visits}</td>
                      <td className="num">{currency(entry.average)}</td>
                      <td className="num strong">{currency(entry.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {result.recurring.length > 0 && (
            <section className="goals-card">
              <div className="section-title">Charges that repeat every month</div>
              <p className="goals-help">
                Seen in three or more months at a steady amount. These are the easiest to
                forget you&rsquo;re paying for.
              </p>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Charge</th>
                      <th className="num">Months</th>
                      <th className="num">Monthly</th>
                      <th className="num">A year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.recurring.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td className="num">{item.months}</td>
                        <td className="num">{currency(item.monthly)}</td>
                        <td className="num strong">{currency(item.annual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
