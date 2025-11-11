import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const sampleLimit = 600;

const stopWords = new Set([
  'a',
  'about',
  'after',
  'all',
  'am',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'call',
  'called',
  'caller',
  'can',
  'clinic',
  'day',
  'do',
  'does',
  'for',
  'from',
  'get',
  'gp',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'him',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'like',
  'line',
  'me',
  'medical',
  'my',
  'need',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'patient',
  'please',
  'she',
  'so',
  'that',
  'the',
  'their',
  'them',
  'there',
  'they',
  'to',
  'up',
  'want',
  'was',
  'we',
  'what',
  'with',
  'you',
  'your'
]);

const dayParts = [
  { key: 'early', label: 'Early (07:00-09:59)', start: 7, end: 9 },
  { key: 'midmorning', label: 'Mid-morning (10:00-11:59)', start: 10, end: 11 },
  { key: 'lunch', label: 'Lunch (12:00-13:59)', start: 12, end: 13 },
  { key: 'afternoon', label: 'Afternoon (14:00-16:59)', start: 14, end: 16 },
  { key: 'late', label: 'Late (17:00-19:59)', start: 17, end: 19 }
];

const defaultReason = 'Unspecified';

const cleanReason = (value, fallback) => {
  if (value && value.trim()) return value.trim();
  if (fallback && fallback.trim()) return fallback.trim();
  return defaultReason;
};

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
};

const tokenise = (text) => {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));
};

const computeInsights = (rows) => {
  const total = rows.length;
  if (total === 0) {
    return {
      total,
      uniqueReasons: 0,
      appointmentShare: null,
      topReason: null,
      reasonCounts: [],
      dayPartBreakdown: [],
      reasonHeatmap: null,
      wordCloud: [],
      narrativeSamples: []
    };
  }

  const reasonBuckets = new Map();
  const heatmap = new Map();
  const dayPartStats = dayParts.map((part) => ({
    ...part,
    count: 0,
    reasons: new Map()
  }));

  let appointmentReasonCount = 0;
  let appointmentOfferedCount = 0;
  const narrativeCandidates = [];
  const wordBuckets = new Map();

  rows.forEach((row) => {
    const reason = cleanReason(row.reason_for_call, row.category);
    reasonBuckets.set(reason, (reasonBuckets.get(reason) ?? 0) + 1);

    if (reason === 'Appointment request') {
      appointmentReasonCount += 1;
      if (row.appointment_offered === true) {
        appointmentOfferedCount += 1;
      }
    }

    const started = row.started_at ? new Date(row.started_at) : null;
    const hour = started ? started.getHours() : null;
    if (hour != null) {
      if (!heatmap.has(reason)) {
        heatmap.set(reason, new Array(24).fill(0));
      }
      heatmap.get(reason)[hour] += 1;

      const part = dayPartStats.find(
        (segment) => hour >= segment.start && hour <= segment.end
      );
      if (part) {
        part.count += 1;
        part.reasons.set(reason, (part.reasons.get(reason) ?? 0) + 1);
      }
    }

    const text = `${row.summary_one_line ?? ''} ${row.outcome_summary ?? ''} ${
      row.reason_for_call ?? ''
    }`;
    tokenise(text).forEach((token) => {
      wordBuckets.set(token, (wordBuckets.get(token) ?? 0) + 1);
    });

    if (row.summary_one_line) {
      narrativeCandidates.push({
        id: row.id,
        summary: row.summary_one_line,
        reason
      });
    }
  });

  const reasonCounts = Array.from(reasonBuckets.entries())
    .map(([label, count]) => ({
      label,
      count,
      percent: (count / total) * 100
    }))
    .sort((a, b) => b.count - a.count);

  const topReason = reasonCounts[0] ?? null;

  const dayPartBreakdown = dayPartStats
    .filter((part) => part.count > 0)
    .map((part) => {
      const topReasons = Array.from(part.reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      return {
        key: part.key,
        label: part.label,
        count: part.count,
        share: (part.count / total) * 100,
        topReasons
      };
    })
    .sort((a, b) => b.count - a.count);

  const topReasonsForHeatmap = reasonCounts.slice(0, 5).map((item) => item.label);
  let maxHeat = 0;
  const heatmapData = topReasonsForHeatmap.map((reason) => {
    const data = heatmap.get(reason) ?? new Array(24).fill(0);
    maxHeat = Math.max(maxHeat, ...data);
    return { reason, data };
  });

  const wordCloud = Array.from(wordBuckets.entries())
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count)
    .filter((entry) => entry.count > 1)
    .slice(0, 40);
  const maxWord = wordCloud.length ? wordCloud[0].count : 0;

  const narratives = narrativeCandidates
    .sort((a, b) => a.summary.length - b.summary.length) // Highlight concise first
    .slice(0, 8);

  return {
    total,
    uniqueReasons: reasonBuckets.size,
    appointmentShare:
      appointmentReasonCount > 0
        ? (appointmentOfferedCount / appointmentReasonCount) * 100
        : null,
    appointmentReasonCount,
    topReason,
    reasonCounts,
    dayPartBreakdown,
    reasonHeatmap: {
      max: maxHeat,
      rows: heatmapData
    },
    wordCloud: { max: maxWord, words: wordCloud },
    narrativeSamples: narratives
  };
};

function WhyCallsInsights() {
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
        'id, started_at, reason_for_call, category, summary_one_line, outcome_summary, appointment_offered, asked_to_call_back_8am'
      )
      .order('started_at', { ascending: false })
      .limit(sampleLimit);

    if (error) {
      setState({
        loading: false,
        error: error.message ?? 'Failed to load call reasons',
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

  const insights = useMemo(() => computeInsights(state.rows), [state.rows]);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Why are people calling?</h1>
          <p className="subtitle">
            Exploring the latest {sampleLimit} calls to understand motivations, language
            and how reasons shift across the day.
          </p>
        </div>
        <button className="refresh-button" onClick={fetchCalls} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {state.error && <div className="alert error">Error: {state.error}</div>}
      {!state.error && state.loading && (
        <div className="alert info">Loading reason breakdown…</div>
      )}

      {!state.loading && !state.error && (
        <>
          <section className="metrics-grid">
            <div className="metric-card">
              <span className="metric-label">Calls analysed</span>
              <span className="metric-value">{insights.total}</span>
              <span className="metric-subtext">
                Latest entries from `call_logs_allfields`
              </span>
            </div>

            <div className="metric-card success">
              <span className="metric-label">Unique reasons</span>
              <span className="metric-value">{insights.uniqueReasons}</span>
              <span className="metric-subtext">
                Distinct values across reason_for_call / category
              </span>
            </div>

            <div className="metric-card warning">
              <span className="metric-label">Appointment request success</span>
              <span className="metric-value">
                {formatPercent(insights.appointmentShare)}
              </span>
              <span className="metric-subtext">
                {insights.appointmentReasonCount} requests tagged as “Appointment request”
              </span>
            </div>

            <div className="metric-card">
              <span className="metric-label">Top reason</span>
              <span className="metric-value">
                {insights.topReason ? insights.topReason.label : '—'}
              </span>
              <span className="metric-subtext">
                {insights.topReason
                  ? `${insights.topReason.count} calls · ${formatPercent(
                      insights.topReason.percent
                    )} share`
                  : 'No data yet'}
              </span>
            </div>
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Leading reasons</h2>
                <span className="card-meta">
                  Ranked by frequency across the analysed calls
                </span>
              </header>
              {insights.reasonCounts.length === 0 ? (
                <div className="empty">No reason codes available.</div>
              ) : (
                <div className="bar-chart">
                  {insights.reasonCounts.slice(0, 8).map((item) => (
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
                <h2>Daypart spotlight</h2>
                <span className="card-meta">
                  When peak demand hits and which reasons dominate
                </span>
              </header>
              {insights.dayPartBreakdown.length === 0 ? (
                <div className="empty">Not enough timestamp data.</div>
              ) : (
                <ul className="leaderboard">
                  {insights.dayPartBreakdown.map((part) => (
                    <li key={part.key}>
                      <span className="leaderboard-name">{part.label}</span>
                      <span className="leaderboard-meta">
                        {part.count} calls · {formatPercent(part.share)} share
                        <br />
                        {part.topReasons
                          .map(
                            (reason) =>
                              `${reason.reason} (${formatPercent(
                                (reason.count / part.count) * 100
                              )})`
                          )
                          .join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card">
            <header className="card-header">
              <h2>Reason heatmap</h2>
              <span className="card-meta">
                Hour-of-day pattern for the five most common reasons
              </span>
            </header>
            {insights.reasonHeatmap && insights.reasonHeatmap.max > 0 ? (
              <div className="heatmap-grid">
                <div className="heatmap-header">
                  <span className="heatmap-label">Reason</span>
                  <div className="heatmap-hours">
                    {Array.from({ length: 24 }).map((_, idx) => (
                      <span key={idx}>{idx.toString().padStart(2, '0')}</span>
                    ))}
                  </div>
                </div>
                {insights.reasonHeatmap.rows.map((row) => (
                  <div className="heatmap-row" key={row.reason}>
                    <span className="heatmap-label">{row.reason}</span>
                    <div className="heatmap-cells">
                      {row.data.map((value, hour) => {
                        const intensity = value
                          ? Math.min(value / insights.reasonHeatmap.max, 1)
                          : 0;
                        return (
                          <span
                            key={`${row.reason}-${hour}`}
                            className="heatmap-cell"
                            style={{
                              backgroundColor: intensity
                                ? `rgba(37,99,235,${0.12 + intensity * 0.68})`
                                : 'rgba(226,232,240,0.6)'
                            }}
                            aria-label={`${row.reason} at ${hour}:00 — ${value} calls`}
                          >
                            {value > 0 ? value : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No hourly pattern available.</div>
            )}
          </section>

          <section className="analytic-section">
            <div className="card">
              <header className="card-header">
                <h2>Language pulse</h2>
                <span className="card-meta">
                  Weighted keywords from reason text and one-line summaries
                </span>
              </header>
              {insights.wordCloud.words.length === 0 ? (
                <div className="empty">Not enough text content to analyse.</div>
              ) : (
                <div className="word-cloud">
                  {insights.wordCloud.words.map((word) => {
                    const weight = insights.wordCloud.max
                      ? (word.count / insights.wordCloud.max) * 1.2 + 0.8
                      : 1;
                    return (
                      <span
                        key={word.token}
                        style={{
                          fontSize: `${Math.max(0.75, weight)}rem`,
                          opacity: 0.6 + weight / 2
                        }}
                        title={`${word.token} · ${word.count} mentions`}
                      >
                        {word.token}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <header className="card-header">
                <h2>Representative calls</h2>
                <span className="card-meta">
                  Recent summaries to give colour to the quantitative story
                </span>
              </header>
              {insights.narrativeSamples.length === 0 ? (
                <div className="empty">No narrative data captured.</div>
              ) : (
                <div className="narrative-grid">
                  {insights.narrativeSamples.map((item) => (
                    <article className="narrative-card" key={item.id}>
                      <h3>{item.reason}</h3>
                      <p>{item.summary}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default WhyCallsInsights;
