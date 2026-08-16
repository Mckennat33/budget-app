import { useEffect, useState } from 'react';

const currency = (value) => `$${Number(value || 0).toFixed(2)}`;

export default function Goals({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [reductionInput, setReductionInput] = useState('0');
  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [goalDate, setGoalDate] = useState('');

  const applyPayload = (payload) => {
    setData(payload);
    setReductionInput(String(payload.reductionPercent ?? 0));
  };

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
    return payload;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await request('/api/goals');
        if (active) applyPayload(payload);
      } catch (fetchError) {
        if (active) setError(fetchError.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const submit = async (path, options) => {
    setSaving(true);
    setError('');
    try {
      applyPayload(await request(path, options));
      return true;
    } catch (submitError) {
      setError(submitError.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = (event) => {
    event.preventDefault();
    submit('/api/goals/settings', {
      method: 'PUT',
      body: JSON.stringify({ reductionPercent: Number(reductionInput || 0) }),
    });
  };

  const addGoal = async (event) => {
    event.preventDefault();
    const ok = await submit('/api/goals/savings', {
      method: 'POST',
      body: JSON.stringify({
        name: goalName,
        targetAmount: Number(goalAmount),
        targetDate: goalDate || null,
      }),
    });
    if (ok) {
      setGoalName('');
      setGoalAmount('');
      setGoalDate('');
    }
  };

  const removeGoal = (id) => submit(`/api/goals/savings/${id}`, { method: 'DELETE' });

  if (loading) {
    return (
      <div className="page-panel">
        <h2>Goals</h2>
        <p>Loading your budget...</p>
      </div>
    );
  }

  const goals = data?.savingsGoals || [];
  const atGoalLimit = goals.length >= (data?.maxGoals ?? 2);

  return (
    <div className="page-panel goals-page">
      <section className="goals-header">
        <div>
          <h2>Goals</h2>
          <p className="goals-subtitle">
            {data?.hasData
              ? `Based on ${data.anchorLabel}, your most recent statement.`
              : 'Upload a statement to start building your budget.'}
          </p>
        </div>
      </section>

      {error && <div className="overview-error">{error}</div>}

      {/* Everything on this page derives from an uploaded statement, so without one the
          page would otherwise render as a bare heading with no explanation. */}
      {data && !data.hasData && (
        <section className="goals-card goals-empty">
          <div className="section-title">Nothing to budget yet</div>
          <p className="goals-help">
            Your allowance and scorecard are calculated from your bank statements, and
            none have been uploaded yet. Head to Overview and upload one to get started.
          </p>
          <ol className="goals-steps">
            <li>
              <b>One statement</b> gives you a spending allowance — a day, week and month
              figure for dining, shopping and everything in Other.
            </li>
            <li>
              <b>Two statements</b> add goal progress and the weekly scorecard, since both
              work by comparing a month against the one before it.
            </li>
          </ol>
          <p className="goals-note">
            You can still add savings goals below — they&rsquo;ll start tracking as soon as
            there&rsquo;s data to measure.
          </p>
        </section>
      )}

      {data?.hasData && (
        <section className="goals-card">
          <div className="section-title">Where the money goes</div>
          <table className="goals-ledger">
            <tbody>
              <tr>
                <td>Total spend</td>
                <td className="num">{currency(data.totalSpend)}</td>
              </tr>
              {data.fixedBreakdown.map((item) => (
                <tr key={item.label} className="dim">
                  <td>&nbsp;&nbsp;{item.label}</td>
                  <td className="num">−{currency(item.amount).slice(1)}</td>
                </tr>
              ))}
              <tr className="rule">
                <td>Discretionary</td>
                <td className="num">{currency(data.discretionary)}</td>
              </tr>
              {data.savingsCommitment > 0 && (
                <tr className="dim">
                  <td>&nbsp;&nbsp;Savings goals</td>
                  <td className="num">−{currency(data.savingsCommitment).slice(1)}</td>
                </tr>
              )}
              {data.reductionAmount > 0 && (
                <tr className="dim">
                  <td>&nbsp;&nbsp;Reduction ({data.reductionPercent}%)</td>
                  <td className="num">−{currency(data.reductionAmount).slice(1)}</td>
                </tr>
              )}
              <tr className="rule total">
                <td>Monthly target</td>
                <td className="num">{currency(data.monthlyTarget)}</td>
              </tr>
            </tbody>
          </table>

          {/* The day/week/month figures live in the allowance section below. Repeating
              them here on the wider discretionary base gave two different answers to
              "what can I spend this week", so this card stops at the target. */}
          <form className="goals-form goals-form-inline" onSubmit={saveSettings}>
            <label>
              <span>Aim to spend less by</span>
              <select value={reductionInput} onChange={(event) => setReductionInput(event.target.value)}>
                <option value="0">No reduction</option>
                <option value="5">5%</option>
                <option value="10">10%</option>
                <option value="15">15%</option>
                <option value="20">20%</option>
              </select>
            </label>
            <button type="submit" className="upload-button" disabled={saving}>
              {saving ? 'Saving...' : 'Apply'}
            </button>
          </form>
        </section>
      )}

      {data?.hasData && (
        <section className="goals-card">
          <div className="section-title">Your spending allowance</div>
          <p className="goals-help">
            Covers dining, shopping and everything in Other — the spending you actually
            choose week to week. Rent, utilities, loans, subscriptions and investing are
            already paid out before this number.
          </p>

          <div className="flex-allowance">
            <div className="flex-primary">
              <span className="k">A week</span>
              <span className="v">{currency(data.flexibleWeekly)}</span>
            </div>
            <div className="flex-side">
              <div className="flex-cell">
                <span className="k">A day</span>
                <span className="v">{currency(data.flexibleDaily)}</span>
              </div>
              <div className="flex-cell">
                <span className="k">A month</span>
                <span className="v">{currency(data.flexibleMonthly)}</span>
              </div>
            </div>
          </div>

          {data.flexibleBreakdown.length > 0 ? (
            <>
              <p className="goals-note">
                In {data.anchorLabel} these three came to {currency(data.flexibleSpend)}:
              </p>
              <div className="flex-split">
                {data.flexibleBreakdown.map((item) => (
                  <div key={item.name} className="flex-split-row">
                    <span className="name">{item.name}</span>
                    <span className="bar">
                      <span className="bar-fill" style={{ width: `${item.percent}%` }} />
                    </span>
                    <span className="amt">{currency(item.amount)}</span>
                    <span className="pct">{item.percent}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="goals-note">No dining, shopping or other spending in {data.anchorLabel}.</p>
          )}
        </section>
      )}

      {data?.hasData && (
        <section className="goals-card">
          <div className="section-title">Where {data.anchorLabel} landed</div>
          <p className="goals-help">
            What the month did with the money. This is separate from goal progress —
            a cheaper month shows up here as a wider gap.
          </p>
          <table className="goals-ledger">
            <tbody>
              <tr>
                <td>Income</td>
                <td className="num">{currency(data.monthIncome)}</td>
              </tr>
              <tr className="dim">
                <td>&nbsp;&nbsp;Spent</td>
                <td className="num">−{currency(data.totalSpend).slice(1)}</td>
              </tr>
              <tr className="dim">
                <td>&nbsp;&nbsp;Moved to savings</td>
                <td className="num">−{currency(data.savedThisMonth).slice(1)}</td>
              </tr>
              <tr className="rule total">
                <td>Left in checking</td>
                <td className={`num ${data.unallocated < 0 ? 'negative' : ''}`}>
                  {currency(data.unallocated)}
                </td>
              </tr>
            </tbody>
          </table>
          {data.unallocated > 0 && (
            <p className="goals-note">
              {currency(data.unallocated)} stayed in checking.
            </p>
          )}
        </section>
      )}

      <section className="goals-card">
        <div className="section-title">Savings goals</div>
        <p className="goals-help">
          Progress is money you didn&rsquo;t spend: come in under the previous month&rsquo;s
          discretionary spending and the difference goes to your goals. Nothing needs to
          leave your checking account.
          {goals.length > 1 && ' With two goals, it is split in proportion to their targets.'}
        </p>

        {data?.hasData && goals.length > 0 && (
          <p className="goals-note">
            {data.previousDiscretionary === null
              ? `${data.anchorLabel} is your only month of data, so there is nothing to compare it against yet. Upload another statement to start earning progress.`
              : data.freedThisMonth > 0
                ? `${data.anchorLabel}: you spent ${currency(data.discretionary)} against ${currency(data.previousDiscretionary)} the month before — ${currency(data.freedThisMonth)} went to your goals.`
                : `${data.anchorLabel}: you spent ${currency(data.discretionary)}, more than the ${currency(data.previousDiscretionary)} the month before, so nothing was added.`}
          </p>
        )}

        {goals.length === 0 && <p className="goals-note">No goals yet. Add one below.</p>}

        <div className="savings-list">
          {goals.map((goal) => (
            <article key={goal.id} className="savings-goal">
              <div className="savings-head">
                <div>
                  <div className="savings-name">{goal.name}</div>
                  <div className="savings-meta">
                    {currency(goal.saved)} of {currency(goal.targetAmount)}
                    {goal.monthsRemaining ? ` · ${goal.monthsRemaining} months left` : ' · no deadline'}
                  </div>
                </div>
                <button type="button" className="savings-remove" onClick={() => removeGoal(goal.id)} disabled={saving}>
                  Remove
                </button>
              </div>

              <div className="savings-track">
                <div className="savings-fill" style={{ width: `${goal.percentComplete}%` }} />
              </div>

              {goal.monthsRemaining ? (
                <div className="savings-rates">
                  <span><b>{currency(goal.perDay)}</b> a day</span>
                  <span><b>{currency(goal.perWeek)}</b> a week</span>
                  <span><b>{currency(goal.perMonth)}</b> a month</span>
                  <span>{goal.percentComplete}% complete</span>
                </div>
              ) : (
                <div className="savings-rates">
                  <span>Set a target date to get a weekly rate.</span>
                </div>
              )}

              {data?.hasData && goal.perMonth > data.discretionary && (
                <p className="savings-warning">
                  This needs {currency(goal.perMonth)} a month, more than the {currency(data.discretionary)} of
                  discretionary spending you had in {data.anchorLabel}. Push the date back or lower the target.
                </p>
              )}
            </article>
          ))}
        </div>

        {atGoalLimit ? (
          <p className="goals-note">You&rsquo;re tracking the maximum of {data.maxGoals} goals. Remove one to add another.</p>
        ) : (
          <form className="goals-form" onSubmit={addGoal}>
            <label>
              <span>What for</span>
              <input
                type="text"
                value={goalName}
                onChange={(event) => setGoalName(event.target.value)}
                placeholder="Flight to Denver"
              />
            </label>
            <label>
              <span>Target</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={goalAmount}
                onChange={(event) => setGoalAmount(event.target.value)}
                placeholder="400"
              />
            </label>
            <label>
              <span>By when</span>
              <input type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} />
            </label>
            <button type="submit" className="upload-button" disabled={saving}>Add goal</button>
          </form>
        )}
      </section>

      {data?.hasData && (
        <section className="goals-card">
          <div className="section-title">How {data.anchorLabel} went</div>
          <p className="goals-help">
            Discretionary spending week by week, against the allowance for those days.
          </p>
          <div className="scorecard">
            {data.scorecard.map((week) => (
              <div key={week.label} className={`scorecard-week ${week.over ? 'over' : 'under'}`}>
                <span className="wk">{week.label}</span>
                <span className="amt">{currency(week.spent)}</span>
                <span className="delta">
                  {week.over ? '+' : '−'}{currency(Math.abs(week.delta)).slice(1)} {week.over ? 'over' : 'under'}
                </span>
                <span className="range">Days {week.range}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
