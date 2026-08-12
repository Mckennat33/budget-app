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
  const monthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  const statementDate = `Statement prepared on ${new Date().toLocaleString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const [spend, setSpend] = useState(0);
  const [spendChange, setSpendChange] = useState(0);
  const [income, setIncome] = useState(0);
  const [incomeChange, setIncomeChange] = useState(0);
  const [categories, setCategories] = useState(defaultCategories);
  const [trendData, setTrendData] = useState(defaultTrendData);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const fetchOverview = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    setStatusMessage('');

    try {
      const response = await fetch('/api/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Unable to load overview data.');
      }

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
        };
      });

      setCategories(nextCategories);
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to load overview data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchOverview();
    }
  }, [token]);

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
        throw new Error(data.error || 'Upload failed.');
      }
      setStatusMessage(`Uploaded ${data.count} transactions successfully.`);
      await fetchOverview();
    } catch (uploadError) {
      setError(uploadError.message || 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const trendValues = trendData.map((item) => item.value);
  const maxTrendValue = Math.max(...trendValues, 1);
  const chartWidth = 560;
  const chartHeight = 140;
  const pointX = (index) => (index / (trendData.length - 1)) * chartWidth;
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
          <button
            type="button"
            className="upload-button"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload statement'}
          </button>
        </div>
      </section>

      {error && <div className="overview-error">{error}</div>}
      {statusMessage && <div className="overview-status">{statusMessage}</div>}

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
            <span>{spendChange}%</span> compared to last week
          </div>
        </article>

        <article className="summary-card">
          <div className="summary-card__title">Total income</div>
          <div className="summary-card__amount">${income.toFixed(2)}</div>
          <div className="summary-card__detail">
            <span>{incomeChange}%</span> compared to last month
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

            return (
              <div key={category.name} className="category-item">
                <div className="category-name">{category.name}</div>

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
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
