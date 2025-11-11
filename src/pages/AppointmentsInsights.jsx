import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const appointmentSelect = [
  'session_holder:"Full Name of the Session Holder of the Session"',
  'day_of_week:"Day of Week"',
  'session_start:"Session\'s Session Start"',
  'session_end:"Session\'s Session End"',
  'appointment_date:"Appointment Date"',
  'appointment_time:"Appointment Time"',
  'slot_type:"Slot Type"',
  'slot_duration:"Slot Duration"',
  'availability:"Availability"',
  'dna:"DNA"',
  'consultation_time:"Consultation Time"'
].join(', ');

const tables = [
  { key: 'today', name: 'Apps_Today', label: 'Today’s schedule' },
  { key: 'next', name: 'Apps_Next_3_Months', label: 'Next 3 months' },
  { key: 'prev', name: 'Apps_Prev_3_Months', label: 'Previous 3 months' }
];

const normalise = (value) =>
  typeof value === 'string' ? value.trim() : value;

const toMinutes = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const computeSummary = (datasets) => {
  const allRows = tables.flatMap((table) => datasets[table.key] ?? []);
  const totalSlots = allRows.length;

  if (totalSlots === 0) {
    return {
      totalSlots: 0,
      availableSlots: 0,
      dnaRate: null,
      avgDuration: null,
      slotTypeBreakdown: [],
      utilisationByHolder: [],
      sessionDensity: []
    };
  }

  let availableSlots = 0;
  let dnaCount = 0;
  let durationTotal = 0;
  let durationCount = 0;

  const slotTypeBuckets = new Map();
  const holderBuckets = new Map();
  const sessionBuckets = new Map();

  allRows.forEach((row) => {
    const availability = normalise(row.availability)?.toLowerCase();
    if (availability && availability.includes('avail')) {
      availableSlots += 1;
    }

    const dnaValue = normalise(row.dna)?.toLowerCase();
    if (dnaValue && ['yes', 'dna', 'true', '1'].includes(dnaValue)) {
      dnaCount += 1;
    }

    const slotDuration = toMinutes(row.slot_duration);
    if (slotDuration != null) {
      durationTotal += slotDuration;
      durationCount += 1;
    }

    const slotType = normalise(row.slot_type) || 'Uncategorised';
    slotTypeBuckets.set(slotType, (slotTypeBuckets.get(slotType) ?? 0) + 1);

    const holder = normalise(row.session_holder) || 'Unassigned';
    holderBuckets.set(holder, (holderBuckets.get(holder) ?? 0) + 1);

    const date = normalise(row.appointment_date) || 'Undated';
    sessionBuckets.set(date, (sessionBuckets.get(date) ?? 0) + 1);
  });

  const dnaRate = totalSlots ? (dnaCount / totalSlots) * 100 : null;
  const avgDuration = durationCount ? durationTotal / durationCount : null;

  const slotTypeBreakdown = Array.from(slotTypeBuckets.entries())
    .map(([label, count]) => ({
      label,
      count,
      percent: (count / totalSlots) * 100
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  const utilisationByHolder = Array.from(holderBuckets.entries())
    .map(([holder, count]) => ({
      holder,
      count,
      utilisation: (count / totalSlots) * 100
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const sessionDensity = Array.from(sessionBuckets.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .slice(0, 14);

  return {
    totalSlots,
    availableSlots,
    dnaRate,
    avgDuration,
    slotTypeBreakdown,
    utilisationByHolder,
    sessionDensity
  };
};

const formatPercent = (value) => {
  if (value == null) return '—';
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
};

const formatMinutes = (value) => {
  if (value == null) return '—';
  return `${Math.round(value)} mins`;
};

function AppointmentsInsights() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    datasets: tables.reduce((acc, table) => {
      acc[table.key] = [];
      return acc;
    }, {})
  });

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const results = await Promise.all(
        tables.map(async (table) => {
          const { data, error } = await supabase
            .from(table.name)
            .select(appointmentSelect);
          if (error) throw new Error(error.message ?? `Failed to load ${table.name}`);
          return { key: table.key, rows: data ?? [] };
        })
      );

      const datasets = results.reduce((acc, entry) => {
        acc[entry.key] = entry.rows;
        return acc;
      }, {});

      setState({
        loading: false,
        error: null,
        datasets
      });
    } catch (err) {
      setState({
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load appointment data',
        datasets: tables.reduce((acc, table) => {
          acc[table.key] = [];
          return acc;
        }, {})
      });
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = useMemo(() => computeSummary(state.datasets), [state.datasets]);

  const sessionDensityChart = useMemo(() => {
    if (!summary.sessionDensity.length) return null;
    const max = Math.max(...summary.sessionDensity.map((item) => item.count));
    return { max, rows: summary.sessionDensity };
  }, [summary.sessionDensity]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Appointments intelligence</h1>
          <p className="subtitle">
            Track supply, utilisation and demand signals across today, the next quarter
            and historical activity.
          </p>
        </div>
        <button className="refresh-button" onClick={fetchData} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {state.error && <div className="alert error">Error: {state.error}</div>}
      {!state.error && state.loading && (
        <div className="alert info">Loading appointment datasets…</div>
      )}

      {!state.loading && !state.error && (
        <>
          <section className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Slots analysed</span>
              <span className="metric-value">{summary.totalSlots}</span>
              <span className="metric-subtext">
                Combined sample across today, ±3 months
              </span>
            </div>

            <div className="metric-card success">
              <span className="metric-label">Available right now</span>
              <span className="metric-value">{summary.availableSlots}</span>
              <span className="metric-subtext">
                {summary.totalSlots
                  ? formatPercent((summary.availableSlots / summary.totalSlots) * 100)
                  : '—'}{' '}
                of reviewed slots
              </span>
            </div>

            <div className="metric-card warning">
              <span className="metric-label">DNA indicator</span>
              <span className="metric-value">{formatPercent(summary.dnaRate)}</span>
              <span className="metric-subtext">
                Share of slots marked as DNA in the period
              </span>
            </div>

            <div className="metric-card">
              <span className="metric-label">Avg slot duration</span>
              <span className="metric-value">{formatMinutes(summary.avgDuration)}</span>
              <span className="metric-subtext">
                Based on slots where a duration is recorded
              </span>
            </div>
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Session mix by table</h2>
                <span className="card-meta">
                  Raw counts ingested from Supabase appointment snapshots
                </span>
              </header>
              <div className="dataset-grid">
                {tables.map((table) => {
                  const rows = state.datasets[table.key] ?? [];
                  const available = rows.filter((row) => {
                    const availability = normalise(row.availability)?.toLowerCase();
                    return availability && availability.includes('avail');
                  }).length;
                  const future = rows.filter((row) => {
                    const availability = normalise(row.availability)?.toLowerCase();
                    return availability && availability.includes('future');
                  }).length;

                  return (
                    <div className="dataset-card" key={table.key}>
                      <h3>{table.label}</h3>
                      <div className="dataset-count">{rows.length}</div>
                      <p className="dataset-subtext">Slots retrieved</p>
                      <div className="dataset-meta">
                        <span>
                          Available now <strong>{available}</strong>
                        </span>
                        <span>
                          Future hold <strong>{future}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <header className="card-header">
                <h2>Slot types</h2>
                <span className="card-meta">Top seven slot taxonomies by share</span>
              </header>
              {summary.slotTypeBreakdown.length === 0 ? (
                <div className="empty">No slot types found.</div>
              ) : (
                <div className="bar-chart">
                  {summary.slotTypeBreakdown.map((item) => (
                    <div className="bar-row" key={item.label}>
                      <div className="bar-label">{item.label}</div>
                      <div className="bar-track">
                        <div
                          className="bar-fill accent"
                          style={{
                            width: `${Math.min(Math.max(item.percent, 3), 100)}%`
                          }}
                        />
                      </div>
                      <div className="bar-value">{formatPercent(item.percent)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Session holder utilisation</h2>
                <span className="card-meta">
                  Activity share across the most frequently scheduled session leads
                </span>
              </header>
              {summary.utilisationByHolder.length === 0 ? (
                <div className="empty">No session holders recorded.</div>
              ) : (
                <ul className="leaderboard">
                  {summary.utilisationByHolder.map((item) => (
                    <li key={item.holder}>
                      <span className="leaderboard-name">{item.holder}</span>
                      <span className="leaderboard-meta">
                        {item.count} slots · {formatPercent(item.utilisation)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <header className="card-header">
                <h2>Sessions per day</h2>
                <span className="card-meta">
                  Rolling sample of appointment counts by appointment date
                </span>
              </header>
              {sessionDensityChart ? (
                <div className="density-chart">
                  {sessionDensityChart.rows.map((item) => (
                    <div className="density-row" key={item.date}>
                      <span className="density-date">{item.date}</span>
                      <div className="density-track">
                        <div
                          className="density-fill"
                          style={{
                            width: `${Math.min(
                              (item.count / sessionDensityChart.max) * 100,
                              100
                            )}%`
                          }}
                        />
                      </div>
                      <span className="density-count">{item.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No appointment dates in scope.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AppointmentsInsights;
