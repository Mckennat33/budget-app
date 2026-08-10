export default function Overview() {
  const monthLabel = 'November 2026';
  const statementDate = 'Statement prepared on Nov 1, 2026';
  const spend = 0;
  const spendChange = 0;
  const income = 0;
  const incomeChange = 0;
  const categories = [
    { name: 'Dining Takeout', amount: 0, change: 0 },
    { name: 'Shopping', amount: 0, change: 0 },
    { name: 'Other', amount: 0, change: 0 },
    { name: 'Groceries', amount: 0, change: 0 },
    { name: 'Transport', amount: 0, change: 0 },
    { name: 'Subscriptions', amount: 0, change: 0 },
    { name: 'Rent & Utilities', amount: 0, change: 0 },
    { name: 'Health & Fitness', amount: 0, change: 0 },
  ];

  const trendData = [
    { label: 'Mar', value: 0 },
    { label: 'Apr', value: 0 },
    { label: 'May', value: 0 },
    { label: 'Jun', value: 0 },
    { label: 'Jul', value: 0 },
    { label: 'Aug', value: 0 },
  ];

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
      </section>

      <section className="overview-trend">
        <div className="trend-title-row">
          <div>
            <div className="section-title">Spending trend</div>
            <p className="trend-description">Last 6 months of account spending.</p>
          </div>
          <div className="trend-summary">Current trend is steady with no spending history.</div>
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
