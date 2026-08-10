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

  return (
    <div className="overview-page page-panel">
      <section className="overview-header">
        <div>
          <p className="overview-month">{monthLabel}</p>
          <h1>Monthly statement summary</h1>
          <p className="overview-date">{statementDate}</p>
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
