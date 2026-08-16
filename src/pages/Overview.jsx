import { useEffect, useRef, useState } from 'react';

const defaultCategories = [
  { name: 'Dining Takeout', amount: 0, change: 0 },
  { name: 'Shopping', amount: 0, change: 0 },
  { name: 'Other', amount: 0, change: 0 },
  { name: 'Groceries', amount: 0, change: 0 },
  { name: 'Transport', amount: 0, change: 0 },
  { name: 'Subscriptions', amount: 0, change: 0 },
  { name: 'Rent & Utilities', amount: 0, change: 0 },
  { name: 'Health & Fitness', amount: 0, change: 0 },
  { name: 'Investing', amount: 0, change: 0 },
];

const defaultTrendData = [
  { label: 'Mar', value: 0 },
  { label: 'Apr', value: 0 },
  { label: 'May', value: 0 },
  { label: 'Jun', value: 0 },
  { label: 'Jul', value: 0 },
  { label: 'Aug', value: 0 },
];

export default function Overview({ token }) {
  const statementDate = `Statement prepared on ${new Date().toLocaleString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const [spend, setSpend] = useState(0);
  const [spendChange, setSpendChange] = useState(0);
  const [income, setIncome] = useState(0);
  const [incomeChange, setIncomeChange] = useState(0);
  const [categories, setCategories] = useState(defaultCategories);
  const [trendData, setTrendData] = useState(defaultTrendData);
  const [monthOptions, setMonthOptions] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  // Default to the latest month so the summary cards show month-over-month, not all-time.
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [uploadDebug, setUploadDebug] = useState(null);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [statements, setStatements] = useState([]);
  const [removing, setRemoving] = useState(null);
  const fileInputRef = useRef(null);

  const fetchOverview = async () => {
    setLoading(true);
    setError('');
    setStatusMessage('');
    setUploadDebug(null);

    async function applyData(data) {
      setSpend(data.totalSpend ?? 0);
      setIncome(data.totalIncome ?? 0);
      setSpendChange(data.spendChange ?? 0);
      setIncomeChange(data.incomeChange ?? 0);
      setTrendData(Array.isArray(data.trendData) ? data.trendData : defaultTrendData);

      const nextCategories = defaultCategories.map((category) => {
        const found = Array.isArray(data.categories)
          ? data.categories.find((item) => item.name === category.name)
          : null;
        return {
          ...category,
          amount: found?.amount ?? 0,
          change: found?.change ?? 0,
          items: Array.isArray(found?.items) ? found.items : [],
        };
      });

      setCategories(nextCategories);
      if (Array.isArray(data.monthOptions)) {
        setMonthOptions(data.monthOptions);
        if (!selectedMonth && data.anchorMonth) {
          setSelectedMonth(data.anchorMonth.slice(0, 7));
        }
      }
    }

    try {
      // Try authenticated endpoint if we have a token
      // build query params: prefer all=true for quick verification, otherwise use selectedMonth
      const params = new URLSearchParams();
      if (showAll) params.set('all', 'true');
      else if (selectedMonth) params.set('month', selectedMonth);

      // Try authenticated endpoint if we have a token
      if (token) {
        const response = await fetch(`/api/overview?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (response.ok) {
          await applyData(data);
          return;
        }
        console.warn('Authenticated overview fetch failed, falling back to debug:', data?.error);
      }

      // Dev fallback (server exposes /api/overview/debug when not in production)
      const debugResp = await fetch(`/api/overview/debug?${params.toString()}`);
      const debugData = await debugResp.json();
      if (debugResp.ok) {
        await applyData(debugData);
      } else {
        throw new Error(debugData.error || 'Unable to load overview data.');
      }
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to load overview data.');
    } finally {
      setLoading(false);
    }
  };

  const fetchStatements = async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/statements', { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.ok) {
        setStatements([...(data.statements || []), ...(data.legacyMonths || [])]);
      }
    } catch {
      // The list is supplementary; a failure here should not break the page.
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [token, showAll, selectedMonth]);

  useEffect(() => {
    fetchStatements();
  }, [token]);

  const removeStatement = async (entry) => {
    const confirmed = window.confirm(
      `Remove ${entry.label}? This deletes the ${entry.transactionCount} transactions it added.`
    );
    if (!confirmed) return;

    setRemoving(entry.id);
    setError('');
    try {
      const path = entry.kind === 'month'
        ? `/api/statements/month/${entry.id}`
        : `/api/statements/${entry.id}`;
      const response = await fetch(path, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to remove that statement.');
      setStatusMessage(`Removed ${data.removed} transactions.`);
      await fetchStatements();
      await fetchOverview();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setRemoving(null);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['application/pdf', 'text/csv'];
    const allowedExtensions = ['.pdf', '.csv'];
    const filename = file.name.toLowerCase();
    const hasValidType = allowedTypes.includes(file.type);
    const hasValidExtension = allowedExtensions.some((ext) => filename.endsWith(ext));

    if (!hasValidType && !hasValidExtension) {
      setError('Unsupported file type. Please upload a PDF or CSV statement.');
      event.target.value = '';
      return;
    }

    setUploading(true);
    setError('');
    setStatusMessage('');

    const formData = new FormData();
    formData.append('statement', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setUploadDebug(data.debug || null);
        throw new Error(data.error || 'Upload failed.');
      }
      setStatusMessage(`Uploaded ${data.count} transactions successfully.`);
      setUploadDebug(null);
      await fetchOverview();
    } catch (uploadError) {
      setError(uploadError.message || 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  // Header label follows the period actually being reported on, not today's date.
  const monthLabel = showAll
    ? 'All time'
    : selectedMonth
      ? new Date(`${selectedMonth}-01T00:00:00`).toLocaleString('default', { month: 'long', year: 'numeric' })
      : new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const comparisonLabel = showAll ? 'across all statements' : 'compared to last month';

  const trendValues = trendData.map((item) => item.value);
  const maxTrendValue = Math.max(...trendValues, 1);
  const chartWidth = 560;
  const chartHeight = 140;
  const pointX = (index) => (trendData.length > 1 ? (index / (trendData.length - 1)) * chartWidth : 0);
  const pointY = (value) => chartHeight - (value / maxTrendValue) * chartHeight;
  const trendPoints = trendData.map((item, index) => `${pointX(index)},${pointY(item.value)}`);

  return (
    <div className="overview-page page-panel">
      <section className="overview-header">
        <div>
          <p className="overview-month">{monthLabel}</p>
          <h1>Monthly statement summary</h1>
          <p className="overview-date">{statementDate}</p>
        </div>
        <div className="overview-header-actions">
          <input
            type="file"
            hidden
            ref={fileInputRef}
            accept=".csv,text/csv,application/pdf,.pdf"
            onChange={handleFileChange}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setShowAll(false); }}
              style={{ padding: '6px 8px' }}
            >
              <option value="">Select month</option>
              {monthOptions.map((m) => (
                <option key={m.start} value={m.start.slice(0, 7)}>{m.label} {m.start.slice(0, 4)}</option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> All time
            </label>
            <button
            type="button"
            className="upload-button"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload statement'}
          </button>
          </div>
        </div>
      </section>

      {error && <div className="overview-error">{error}</div>}
      {statusMessage && <div className="overview-status">{statusMessage}</div>}
      {uploadDebug && (
        <pre className="overview-error" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {JSON.stringify(uploadDebug, null, 2)}
        </pre>
      )}

      <section className="overview-trend">
        <div className="trend-title-row">
          <div>
            <div className="section-title">Spending trend</div>
            <p className="trend-description">Last 6 months of account spending.</p>
          </div>
          <div className="trend-summary">
            {loading ? 'Loading trend...' : 'Trend updated from your latest upload.'}
          </div>
        </div>

        <div className="trend-chart-card">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="trend-chart-svg" aria-label="Spending trend chart">
            <g className="trend-grid-lines">
              {[0, 1, 2, 3].map((row) => {
                const y = (row / 3) * chartHeight;
                return <line key={row} x1={0} y1={y} x2={chartWidth} y2={y} />;
              })}
            </g>
            <polyline points={trendPoints.join(' ')} className="trend-line" fill="none" />
            {trendData.map((point, index) => (
              <circle key={point.label} cx={pointX(index)} cy={pointY(point.value)} r="4" className="trend-point" />
            ))}
          </svg>
          <div className="trend-labels">
            {trendData.map((item) => (
              <div key={item.label} className="trend-label">{item.label}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="overview-summary-grid">
        <article className="summary-card">
          <div className="summary-card__title">Total spend</div>
          <div className="summary-card__amount">${spend.toFixed(2)}</div>
          <div className="summary-card__detail">
            <span>{spendChange}%</span> {comparisonLabel}
          </div>
        </article>

        <article className="summary-card">
          <div className="summary-card__title">Total income</div>
          <div className="summary-card__amount">${income.toFixed(2)}</div>
          <div className="summary-card__detail">
            <span>{incomeChange}%</span> {comparisonLabel}
          </div>
        </article>
      </section>

      <section className="overview-categories">
        <div className="section-title">Top categories</div>
        <div className="category-list">
          {categories.map((category) => {
            const progressValue = Math.min(Math.abs(category.change), 100);
            const isMore = category.change > 0;
            const progressLabel = category.change === 0
              ? 'No change'
              : isMore
                ? `${category.change}% more than last month`
                : `${Math.abs(category.change)}% less than last month`;

            const items = category.items || [];
            const isOpen = expandedCategory === category.name;

            return (
              <div key={category.name} className="category-block">
                <button
                  type="button"
                  className="category-item"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedCategory(isOpen ? null : category.name)}
                >
                  <div className="category-name">
                    <span className={`category-caret ${isOpen ? 'open' : ''}`} aria-hidden="true">▸</span>
                    {category.name}
                    {items.length > 0 && <span className="category-count">{items.length}</span>}
                  </div>

                  <div className="category-progress">
                    <div className={`progress-track ${isMore ? 'progress-more' : category.change < 0 ? 'progress-less' : 'progress-neutral'}`}>
                      <div className="progress-fill" style={{ width: `${progressValue}%` }} />
                    </div>
                    <div className="progress-text">{progressLabel}</div>
                  </div>

                  <div className="category-amount-cell">
                    <div className="category-amount-row">
                      <span className="category-amount">${category.amount.toFixed(2)}</span>
                      <span className={`category-change category-change-right ${isMore ? 'more' : category.change < 0 ? 'less' : ''}`}>
                        {category.change > 0 ? `+${category.change}%` : `${category.change}%`}
                      </span>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="category-details">
                    {items.length === 0 ? (
                      <p className="category-details-empty">No charges in this category for {monthLabel}.</p>
                    ) : (
                      <table className="category-details-table">
                        <tbody>
                          {items.map((item, index) => (
                            <tr key={`${item.date}-${item.description}-${index}`}>
                              <td className="detail-date">
                                {new Date(`${item.date}T00:00:00`).toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                              </td>
                              <td className="detail-description">{item.description}</td>
                              <td className="detail-amount">${item.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {statements.length > 0 && (
        <section className="overview-categories">
          <div className="section-title">Uploaded statements</div>
          <p className="statement-help">
            Removing a statement deletes the transactions it brought in.
          </p>
          <div className="statement-list">
            {statements.map((entry) => (
              <div key={`${entry.kind}-${entry.id}`} className="statement-row">
                <div className="statement-info">
                  <span className="statement-label">{entry.label}</span>
                  <span className="statement-meta">
                    {entry.transactionCount} transactions
                    {entry.periodStart && entry.periodEnd && (
                      <> · {entry.periodStart} to {entry.periodEnd}</>
                    )}
                    {entry.kind === 'month' && <> · uploaded before statement tracking</>}
                  </span>
                </div>
                <button
                  type="button"
                  className="statement-remove"
                  onClick={() => removeStatement(entry)}
                  disabled={removing === entry.id}
                >
                  {removing === entry.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
    }