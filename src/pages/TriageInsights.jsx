import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const fetchLimit = 300;

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const groupBy = (rows, keyFn) => {
  const buckets = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  });
  return Array.from(buckets.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

const computeSummary = (rows) => {
  const total = rows.length;

  if (total === 0) {
    return {
      total,
      todayCount: 0,
      uniqueTopics: 0,
      matchRate: null,
      byType: [],
      byTopic: [],
      byDay: []
    };
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const todayCount = rows.filter((row) => row.request_date === todayISO).length;
  const uniqueTopics = new Set(rows.map((row) => row.topic || 'Unknown')).size;
  const matchRate =
    rows.filter((row) => {
      const value = (row.match || '').toString().toLowerCase();
      return ['yes', 'matched', 'true', '1'].includes(value);
    }).length / total;

  const byType = groupBy(rows, (row) => row.type || 'Unclassified').slice(0, 6);
  const byTopic = groupBy(rows, (row) => row.topic || 'Unspecified').slice(0, 8);

  const byDayMap = new Map();
  rows.forEach((row) => {
    const dateValue = row.request_date;
    if (!dateValue) return;
    const count = byDayMap.get(dateValue) ?? 0;
    byDayMap.set(dateValue, count + 1);
  });

  const byDay = Array.from(byDayMap.entries())
    .map(([date, count]) => ({ date, count, dateValue: toDate(date) }))
    .filter((entry) => entry.dateValue != null)
    .sort((a, b) => a.dateValue.getTime() - b.dateValue.getTime())
    .slice(-14);

  return {
    total,
    todayCount,
    uniqueTopics,
    matchRate: matchRate * 100,
    byType,
    byTopic,
    byDay
  };
};

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
};

function TriageInsights() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: []
  });

  const fetchRequests = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const { data, error } = await supabase
      .from('triage_requests')
      .select('row_hash, request_date, request_time, type, topic, match, created_by')
      .order('request_date', { ascending: false })
      .order('request_time', { ascending: false })
      .limit(fetchLimit);

    if (error) {
      setState({
        loading: false,
        error: error.message ?? 'Failed to load triage requests',
        rows: []
      });
      return;
    }

    setState({
      loading: false,
      error: null,
      rows: data ?? []
    });
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const summary = useMemo(() => computeSummary(state.rows), [state.rows]);

  const dayChart = useMemo(() => {
    if (!summary.byDay.length) return null;
    const max = Math.max(...summary.byDay.map((entry) => entry.count));
    return {
      max,
      rows: summary.byDay
    };
  }, [summary.byDay]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Triage demand monitor</h1>
          <p className="subtitle">
            Understand request volume, the mix of clinical topics and completion rates
            across recent submissions.
          </p>
        </div>
        <button className="refresh-button" onClick={fetchRequests} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {state.error && <div className="alert error">Error: {state.error}</div>}
      {!state.error && state.loading && (
        <div className="alert info">Loading triage request history…</div>
      )}

      {!state.loading && !state.error && (
        <>
          <section className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Requests analysed</span>
              <span className="metric-value">{summary.total}</span>
              <span className="metric-subtext">
                Latest {summary.total ? summary.total : '—'} submissions in Supabase
              </span>
            </div>

            <div className="metric-card">
              <span className="metric-label">Logged today</span>
              <span className="metric-value">{summary.todayCount}</span>
              <span className="metric-subtext">Matching today’s date</span>
            </div>

            <div className="metric-card success">
              <span className="metric-label">Topics covered</span>
              <span className="metric-value">{summary.uniqueTopics}</span>
              <span className="metric-subtext">Distinct topics captured across the sample</span>
            </div>

            <div className="metric-card warning">
              <span className="metric-label">Matched/triaged</span>
              <span className="metric-value">{formatPercent(summary.matchRate)}</span>
              <span className="metric-subtext">
                Based on `match` flag returned with each request
              </span>
            </div>
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Top request types</h2>
                <span className="card-meta">
                  Proportion of the most common request classifications
                </span>
              </header>
              {summary.byType.length === 0 ? (
                <div className="empty">No request types available.</div>
              ) : (
                <div className="bar-chart">
                  {summary.byType.map((item) => (
                    <div className="bar-row" key={item.label}>
                      <div className="bar-label">{item.label}</div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${Math.min(Math.max((item.count / summary.total) * 100, 3), 100)}%`
                          }}
                        />
                      </div>
                      <div className="bar-value">
                        {formatPercent((item.count / summary.total) * 100)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <header className="card-header">
                <h2>Topic spotlight</h2>
                <span className="card-meta">
                  Highest-volume presentation topics across the same window
                </span>
              </header>
              {summary.byTopic.length === 0 ? (
                <div className="empty">No topics recorded.</div>
              ) : (
                <ul className="leaderboard">
                  {summary.byTopic.map((item) => (
                    <li key={item.label}>
                      <span className="leaderboard-name">{item.label}</span>
                      <span className="leaderboard-meta">
                        {item.count} request{item.count === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card">
            <header className="card-header">
              <h2>Daily volume trend</h2>
              <span className="card-meta">
                Rolling history of requests (latest {summary.byDay.length} days)
              </span>
            </header>
            {dayChart ? (
              <div className="density-chart">
                {dayChart.rows.map((entry) => (
                  <div className="density-row" key={entry.date}>
                    <span className="density-date">
                      {entry.dateValue.toLocaleDateString('en-GB', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                    <div className="density-track">
                      <div
                        className="density-fill"
                        style={{
                          width: `${Math.min((entry.count / dayChart.max) * 100, 100)}%`
                        }}
                      />
                    </div>
                    <span className="density-count">{entry.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No dated request information available.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default TriageInsights;
