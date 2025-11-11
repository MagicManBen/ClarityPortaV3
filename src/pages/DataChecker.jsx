import { useCallback, useEffect, useState } from 'react';
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

const defaultState = () => ({
  rows: [],
  loading: true,
  error: null,
  count: 0
});

// Helper to format today in DD-MMM-YYYY (e.g. 31-Oct-2025)
const formatTodayDDMMMYYYY = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()}`;
};


const tableConfigs = [
  {
    key: 'callLogs',
    title: 'Latest call logs',
    source: 'call_logs_allfields',
    columns: [
      { key: 'started_at', label: 'Started at' },
      { key: 'caller_number', label: 'Caller number' },
      { key: 'dialled_name', label: 'Dialled line' },
      { key: 'last_queue_group_name', label: 'Queue' },
      { key: 'agent_user_name', label: 'Agent' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'duration_total_sec', label: 'Duration (sec)' },
      { key: 'category', label: 'Category' },
      { key: 'summary_one_line', label: 'Summary' }
    ]
  },
  {
    key: 'appsToday',
    title: 'Appointments today (Apps_Today)',
    source: 'Apps_Today',
    columns: [
      { key: 'session_holder', label: 'Session holder' },
      { key: 'day_of_week', label: 'Day' },
      { key: 'session_start', label: 'Session start' },
      { key: 'session_end', label: 'Session end' },
      { key: 'appointment_date', label: 'Date' },
      { key: 'appointment_time', label: 'Time' },
      { key: 'slot_type', label: 'Slot type' },
      { key: 'slot_duration', label: 'Duration' },
      { key: 'availability', label: 'Availability' },
      { key: 'dna', label: 'DNA' },
      { key: 'consultation_time', label: 'Consultation time' }
    ]
  },
  {
    key: 'appsNext',
    title: 'Appointments next 3 months (Apps_Next_3_Months)',
    source: 'Apps_Next_3_Months',
    columns: [
      { key: 'session_holder', label: 'Session holder' },
      { key: 'day_of_week', label: 'Day' },
      { key: 'session_start', label: 'Session start' },
      { key: 'session_end', label: 'Session end' },
      { key: 'appointment_date', label: 'Date' },
      { key: 'appointment_time', label: 'Time' },
      { key: 'slot_type', label: 'Slot type' },
      { key: 'slot_duration', label: 'Duration' },
      { key: 'availability', label: 'Availability' },
      { key: 'dna', label: 'DNA' },
      { key: 'consultation_time', label: 'Consultation time' }
    ]
  },
  {
    key: 'appsPrev',
    title: 'Appointments previous 3 months (Apps_Prev_3_Months)',
    source: 'Apps_Prev_3_Months',
    columns: [
      { key: 'session_holder', label: 'Session holder' },
      { key: 'day_of_week', label: 'Day' },
      { key: 'session_start', label: 'Session start' },
      { key: 'session_end', label: 'Session end' },
      { key: 'appointment_date', label: 'Date' },
      { key: 'appointment_time', label: 'Time' },
      { key: 'slot_type', label: 'Slot type' },
      { key: 'slot_duration', label: 'Duration' },
      { key: 'availability', label: 'Availability' },
      { key: 'dna', label: 'DNA' },
      { key: 'consultation_time', label: 'Consultation time' }
    ]
  },
  {
    key: 'appsCalendar',
    title: 'Appointments calendar year (Apps_Calendar_Year)',
    source: 'Apps_Calendar_Year',
    columns: [
      { key: 'session_holder', label: 'Session holder' },
      { key: 'day_of_week', label: 'Day' },
      { key: 'session_start', label: 'Session start' },
      { key: 'session_end', label: 'Session end' },
      { key: 'appointment_date', label: 'Date' },
      { key: 'appointment_time', label: 'Time' },
      { key: 'slot_type', label: 'Slot type' },
      { key: 'slot_duration', label: 'Duration' },
      { key: 'availability', label: 'Availability' },
      { key: 'dna', label: 'DNA' },
      { key: 'consultation_time', label: 'Consultation time' }
    ]
  },
  {
    key: 'triage',
    title: 'Triage requests',
    source: 'triage_requests',
    columns: [
      { key: 'request_date', label: 'Request date' },
      { key: 'request_time', label: 'Request time' },
      { key: 'type', label: 'Type' },
      { key: 'topic', label: 'Topic' },
      { key: 'match', label: 'Match' },
      { key: 'created_by', label: 'Created by' }
    ]
  }
];

const selectorBySource = {
  Apps_Today: appointmentSelect,
  Apps_Next_3_Months: appointmentSelect,
  Apps_Prev_3_Months: appointmentSelect,
  Apps_Calendar_Year: appointmentSelect
};

const limitBySource = {
  call_logs_allfields: 50,
  triage_requests: 50
};

const getRowKey = (row, index) =>
  row.id ??
  row.row_hash ??
  (row.session_holder ? `${row.session_holder}-${index}` : `row-${index}`);

function DataChecker() {
  const [tables, setTables] = useState(
    tableConfigs.reduce((acc, config) => {
      acc[config.key] = defaultState();
      return acc;
    }, {})
  );

  const fetchTable = useCallback(async (config) => {
    setTables((prev) => ({
      ...prev,
      [config.key]: { ...prev[config.key], loading: true, error: null }
    }));

    // Build select query. Only apply a limit when explicitly configured in `limitBySource`.
    const query = supabase.from(config.source);
    const selectClause = selectorBySource[config.source] ?? '*';
    const configuredLimit = limitBySource[config.source];

    let qb = query.select(selectClause);
    if (configuredLimit) qb = qb.limit(configuredLimit);

    // If this source is one of the appointment views, apply a server-side filter
    // to return rows for today's local date. We use a [today, tomorrow) range
    // which works for date or timestamp columns named `appointment_date`.
  if (selectorBySource[config.source]) {
      // The appointment views expose aliased fields on select, but the underlying
      // column in the DB is named "Appointment Date" (with spaces) and is stored
      // as text in the format like "31-Oct-2025" in the examples provided. Apply
      // an equality filter on that exact column name using the same format so
      // we get all rows for the local date.
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const todayFormatted = `${pad(now.getDate())}-${months[now.getMonth()]}-${now.getFullYear()}`; // e.g. 31-Oct-2025

      // Use equality on the DB column name with spaces. PostgREST/Supabase will
      // encode the column name appropriately.
      qb = qb.eq('Appointment Date', todayFormatted);

      // Filter to the requested clinicians in the 'Full Name' column.
      const namesToFilter = [
        'MANSELL, Kelly (Miss)',
        'MASTERSON, Sarah (Miss)',
        'GRIFFITHS, Diana (Mrs)',
        'MORETON, Alexa (Mrs)'
      ];
      qb = qb.in('Full Name of the Session Holder of the Session', namesToFilter);
    }

    const { data, error } = await qb;
    const rows = error ? [] : data ?? [];

    // Prepare debug counts: total rows in the source and rows matching the date
    // (only for appointment views). We'll attempt to use the PostgREST count
    // feature (head + exact) to avoid pulling all rows twice.
    let totalCount = null;
    let dateCount = null;
    try {
      const tot = await supabase.from(config.source).select('*', { count: 'exact', head: true });
      if (!tot.error) totalCount = tot.count ?? null;
    } catch (e) {
      // ignore count errors, leave totalCount null
    }

    if (selectorBySource[config.source]) {
      try {
        const todayFormatted = formatTodayDDMMMYYYY();
        const namesToFilter = [
          'MANSELL, Kelly (Miss)',
          'MASTERSON, Sarah (Miss)',
          'GRIFFITHS, Diana (Mrs)',
          'MORETON, Alexa (Mrs)'
        ];
        const dc = await supabase
          .from(config.source)
          .select('*', { count: 'exact', head: true })
          .eq('Appointment Date', todayFormatted)
          .in('Full Name of the Session Holder of the Session', namesToFilter);
        if (!dc.error) dateCount = dc.count ?? null;
      } catch (e) {
        // ignore
      }
    }

    setTables((prev) => ({
      ...prev,
      [config.key]: {
        rows,
        loading: false,
        error: error ? error.message ?? `Failed to load ${config.source}` : null,
        count: rows.length,
        totalCount,
        dateCount,
          lastQuery: {
          select: selectClause,
          limit: configuredLimit ?? null,
          filters: selectorBySource[config.source]
            ? {
                'Appointment Date': formatTodayDDMMMYYYY(),
                'Full Name of the Session Holder of the Session': [
                  'MANSELL, Kelly (Miss)',
                  'MASTERSON, Sarah (Miss)',
                  'GRIFFITHS, Diana (Mrs)',
                  'MORETON, Alexa (Mrs)'
                ]
              }
            : null
        }
      }
    }));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all(tableConfigs.map((config) => fetchTable(config)));
  }, [fetchTable]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1>Data Checker</h1>
          <p>Direct table extracts from Supabase to aid validation and auditing.</p>
        </div>
        <button className="refresh-button" onClick={refreshAll}>
          Refresh all
        </button>
      </header>

      {tableConfigs.map((config) => {
        const state = tables[config.key];
        const debugId = `debug-${config.key}`;
        return (
          <section className="data-section" key={config.key}>
            <header className="section-header">
              <h2>{config.title}</h2>
              <p>
                Source: {config.source} — Rows: {state?.count ?? state?.rows?.length ?? 0}
              </p>
            </header>

            {state.error && <div className="table-alert error">{state.error}</div>}
            {state.loading && !state.error && (
              <div className="table-alert info">Loading…</div>
            )}

            {!state.loading && !state.error && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 13, color: '#666' }}>
                    Showing {state.rows.length} rows (pulled) — Total in source: {state.totalCount ?? 'unknown'} —
                    Date matches: {state.dateCount ?? 'unknown'}
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        const el = document.getElementById(debugId);
                        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                      }}
                    >
                      Toggle debug
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(JSON.stringify(state.rows ?? [], null, 2));
                          alert('Copied rows JSON to clipboard');
                        } catch (e) {
                          alert('Copy failed: ' + String(e));
                        }
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      Copy JSON
                    </button>
                  </div>
                </div>

                <div id={debugId} style={{ display: 'none', marginTop: 12, background: '#fafafa', padding: 12, borderRadius: 6 }}>
                  <strong>Debug info</strong>
                  <div style={{ marginTop: 8 }}>
                    <pre style={{ maxHeight: 200, overflow: 'auto', background: '#fff', padding: 8 }}>
{`select: ${state?.lastQuery?.select ?? '*'}\nlimit: ${state?.lastQuery?.limit ?? 'none'}\nfilters: ${JSON.stringify(state?.lastQuery?.filters ?? null)}`}
                    </pre>
                    <div style={{ marginTop: 8 }}>
                      <em>First 10 rows (preview):</em>
                      <pre style={{ maxHeight: 300, overflow: 'auto', background: '#fff', padding: 8 }}>
{JSON.stringify((state.rows ?? []).slice(0, 10), null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="table-wrapper" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        {config.columns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.rows.length === 0 ? (
                        <tr>
                          <td className="empty-cell" colSpan={config.columns.length}>
                            No records found.
                          </td>
                        </tr>
                      ) : (
                        state.rows.map((row, index) => (
                          <tr key={getRowKey(row, index)}>
                            {config.columns.map((column) => (
                              <td key={column.key}>{row[column.key] ?? '—'}</td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default DataChecker;
