import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const sampleLimit = 400;

const secondsToDuration = (seconds) => {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
};

const computeMetrics = (rows) => {
  const total = rows.length;
  if (total === 0) {
    return {
      total,
      inboundShare: null,
      avgTalk: null,
      avgQueue: null,
      completionRate: null,
      byOutcome: [],
      agentPerformance: []
    };
  }

  let inbound = 0;
  let talkTotal = 0;
  let talkCount = 0;
  let queueTotal = 0;
  let queueCount = 0;
  let completedCount = 0;

  const outcomeBuckets = new Map();
  const agentBuckets = new Map();

  rows.forEach((row) => {
    if (row.direction === 'INBOUND') inbound += 1;

    const talk = Number(row.talk_sec);
    if (Number.isFinite(talk) && talk >= 0) {
      talkTotal += talk;
      talkCount += 1;
    }

    const queue = Number(row.queue_sec);
    if (Number.isFinite(queue) && queue >= 0) {
      queueTotal += queue;
      queueCount += 1;
    }

    const outcome = row.outcome || 'Uncategorised';
    outcomeBuckets.set(outcome, (outcomeBuckets.get(outcome) ?? 0) + 1);

    const agent = row.agent_user_name || 'Unassigned';
    if (!agentBuckets.has(agent)) {
      agentBuckets.set(agent, {
        agent,
        calls: 0,
        talkTotal: 0,
        talkCount: 0,
        queueTotal: 0,
        queueCount: 0,
        outcomes: new Map()
      });
    }
    const bucket = agentBuckets.get(agent);
    bucket.calls += 1;
    if (Number.isFinite(talk) && talk >= 0) {
      bucket.talkTotal += talk;
      bucket.talkCount += 1;
    }
    if (Number.isFinite(queue) && queue >= 0) {
      bucket.queueTotal += queue;
      bucket.queueCount += 1;
    }
    bucket.outcomes.set(outcome, (bucket.outcomes.get(outcome) ?? 0) + 1);

    if ((row.status || '').toLowerCase() === 'completed') {
      completedCount += 1;
    }
  });

  const inboundShare = (inbound / total) * 100;
  const avgTalk = talkCount > 0 ? talkTotal / talkCount : null;
  const avgQueue = queueCount > 0 ? queueTotal / queueCount : null;
  const completionRate = (completedCount / total) * 100;

  const byOutcome = Array.from(outcomeBuckets.entries())
    .map(([label, count]) => ({
      label,
      count,
      percent: (count / total) * 100
    }))
    .sort((a, b) => b.count - a.count);

  const agentPerformance = Array.from(agentBuckets.values())
    .map((bucket) => ({
      agent: bucket.agent,
      calls: bucket.calls,
      avgTalk: bucket.talkCount > 0 ? bucket.talkTotal / bucket.talkCount : null,
      avgQueue: bucket.queueCount > 0 ? bucket.queueTotal / bucket.queueCount : null,
      topOutcome: Array.from(bucket.outcomes.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count }))[0] ?? { label: '—', count: 0 }
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    total,
    inboundShare,
    avgTalk,
    avgQueue,
    completionRate,
    byOutcome,
    agentPerformance
  };
};

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
};

function CallQualityInsights() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    rows: []
  });

  const fetchCalls = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const { data, error } = await supabase
      .from('call_logs_allfields')
      .select(
        'id, started_at, direction, outcome, status, talk_sec, queue_sec, hold_sec, agent_user_name, duration_total_sec'
      )
      .order('started_at', { ascending: false })
      .limit(sampleLimit);

    if (error) {
      setState({
        loading: false,
        error: error.message ?? 'Failed to load call logs',
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
    fetchCalls();
  }, [fetchCalls]);

  const metrics = useMemo(() => computeMetrics(state.rows), [state.rows]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Call quality review</h1>
          <p className="subtitle">
            Latest {sampleLimit} calls with focus on talk time, queue exposure and agent
            throughput.
          </p>
        </div>
        <button className="refresh-button" onClick={fetchCalls} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {state.error && <div className="alert error">Error: {state.error}</div>}
      {!state.error && state.loading && (
        <div className="alert info">Loading recent call quality metrics…</div>
      )}

      {!state.loading && !state.error && (
        <>
          <section className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Calls analysed</span>
              <span className="metric-value">{metrics.total}</span>
              <span className="metric-subtext">Latest records returned by Supabase</span>
            </div>

            <div className="metric-card success">
              <span className="metric-label">Inbound share</span>
              <span className="metric-value">{formatPercent(metrics.inboundShare)}</span>
              <span className="metric-subtext">Proportion of calls marked as INBOUND</span>
            </div>

            <div className="metric-card">
              <span className="metric-label">Avg talk time</span>
              <span className="metric-value">{secondsToDuration(metrics.avgTalk)}</span>
              <span className="metric-subtext">Across calls with a recorded talk_sec</span>
            </div>

            <div className="metric-card warning">
              <span className="metric-label">Avg queue time</span>
              <span className="metric-value">{secondsToDuration(metrics.avgQueue)}</span>
              <span className="metric-subtext">Queue exposure before answer</span>
            </div>

            <div className="metric-card">
              <span className="metric-label">Completion rate</span>
              <span className="metric-value">
                {formatPercent(metrics.completionRate)}
              </span>
              <span className="metric-subtext">
                Calls marked with status = completed in sample
              </span>
            </div>
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Outcome mix</h2>
                <span className="card-meta">Distribution of outcomes in the analysed set</span>
              </header>
              {metrics.byOutcome.length === 0 ? (
                <div className="empty">No outcome information available.</div>
              ) : (
                <div className="bar-chart">
                  {metrics.byOutcome.map((item) => (
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

            <div className="card">
              <header className="card-header">
                <h2>Agent throughput</h2>
                <span className="card-meta">
                  Top performers by call volume, with talk/queue averages
                </span>
              </header>
              {metrics.agentPerformance.length === 0 ? (
                <div className="empty">No agent activity recorded.</div>
              ) : (
                <table className="insight-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Calls</th>
                      <th>Avg talk</th>
                      <th>Avg queue</th>
                      <th>Most common outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.agentPerformance.slice(0, 12).map((agent) => (
                      <tr key={agent.agent}>
                        <td>{agent.agent}</td>
                        <td>{agent.calls}</td>
                        <td>{secondsToDuration(agent.avgTalk)}</td>
                        <td>{secondsToDuration(agent.avgQueue)}</td>
                        <td>
                          {agent.topOutcome.label}{' '}
                          {agent.topOutcome.count
                            ? `(${agent.topOutcome.count})`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default CallQualityInsights;
