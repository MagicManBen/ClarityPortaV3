import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const operatingHours = {
  openHour: 8,
  closeHour: 18,
  closeMinute: 30
};

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

const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const monthMap = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const normaliseDateKey = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const alt = trimmed.match(/^(\d{1,2})-(\w{3})-(\d{4})$/i);
  if (alt) {
    const day = Number(alt[1]);
    const month = monthMap[alt[2].toLowerCase()];
    const year = Number(alt[3]);
    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const parsed = new Date(Date.UTC(year, month, day));
      return formatDateKey(parsed);
    }
  }
  const parsed = new Date(trimmed.replace(/-/g, ' '));
  return Number.isNaN(parsed.getTime()) ? null : formatDateKey(parsed);
};

const parseHourFromTime = (value) => {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isFinite(hour) ? hour : null;
};

const defaultState = () => ({
  rows: [],
  loading: true,
  error: null
});

const buildHourSlots = () => {
  const slots = [];
  for (let hour = operatingHours.openHour; hour <= operatingHours.closeHour; hour += 1) {
    slots.push({
      hour,
      label: `${hour.toString().padStart(2, '0')}:00`
    });
  }
  return slots;
};

const supplyMetrics = (rows, dateKey) => {
  const toLower = (value) => (value ?? '').toString().toLowerCase();
  const slots = rows.filter((row) => normaliseDateKey(row.appointment_date) === dateKey);
  const bookOnDay = slots.filter((row) => toLower(row.slot_type).includes('book on the day'));

  const availabilityState = (value) => {
    const lower = toLower(value);
    if (lower.includes('booked')) return 'booked';
    if (lower.includes('avail')) return 'available';
    if (lower.includes('embargo')) return 'embargoed';
    return 'other';
  };

  const available = bookOnDay.filter((row) => availabilityState(row.availability) === 'available');
  const booked = bookOnDay.filter((row) => availabilityState(row.availability) === 'booked');

  const remaining = bookOnDay.length - booked.length;

  const bookOnDayByHour = bookOnDay.reduce((acc, row) => {
    const hour = parseHourFromTime(row.appointment_time);
    if (hour == null) return acc;
    if (!acc[hour]) {
      acc[hour] = { total: 0, available: 0 };
    }
    acc[hour].total += 1;
    if (toLower(row.availability).includes('avail')) {
      acc[hour].available += 1;
    }
    return acc;
  }, {});

  return {
    allSlots: slots,
    bookOnDay,
    available,
    booked,
    remaining,
    bookOnDayByHour
  };
};

const reasonHeuristics = [
  { label: 'Appointment request', keywords: ['appointment', 'book', 'slot', 'gp'] },
  { label: 'Prescription request', keywords: ['prescription', 'medication', 'repeat', 'script', 'tablet'] },
  { label: 'Results or letters', keywords: ['result', 'lab', 'blood', 'test', 'letter', 'scan', 'x-ray'] },
  { label: 'Administrative query', keywords: ['form', 'admin', 'fit note', 'sick note', 'certificate', 'insurance', 'paperwork'] },
  { label: 'Call back request', keywords: ['call back', 'ring back', 'callback', 'contact me'] },
  { label: 'Symptoms / clinical', keywords: ['pain', 'symptom', 'breath', 'bleeding', 'fever', 'bp', 'blood pressure', 'rash', 'injury'] },
  { label: 'General enquiry', keywords: ['general enquiry', 'information', 'question', 'services'] }
];

const urgentKeywords = [
  'urgent',
  'emergency',
  'immediately',
  'same day',
  'chest pain',
  'difficulty breathing',
  'bleeding',
  'severe',
  'collapse'
];

const deriveReasonLabel = (row) => {
  const explicit = (row.reason_for_call ?? '').trim();
  if (explicit && explicit.toLowerCase() !== 'unspecified') {
    return explicit;
  }

  const combined = `${row.reason_for_call ?? ''} ${row.summary_one_line ?? ''} ${
    row.category ?? ''
  } ${row.outcome_summary ?? ''}`.toLowerCase();

  for (const heuristic of reasonHeuristics) {
    if (heuristic.keywords.some((keyword) => combined.includes(keyword))) {
      return heuristic.label;
    }
  }

  if ((row.summary_one_line ?? '').trim()) {
    return 'Summary provided';
  }

  if ((row.category ?? '').trim()) {
    return row.category;
  }

  return 'General enquiry';
};

const demandMetrics = (rows) => {
  const toLower = (value) => (value ?? '').toString().toLowerCase();
  const total = rows.length;
  const annotated = rows.map((row) => ({
    ...row,
    derived_reason: deriveReasonLabel(row)
  }));

  const appointmentRequests = annotated.filter(
    (row) => toLower(row.derived_reason) === 'appointment request'
  );

  const urgentHeuristic = annotated.filter((row) => {
    const combined = `${row.reason_for_call ?? ''} ${row.summary_one_line ?? ''} ${
      row.category ?? ''
    }`.toLowerCase();
    return urgentKeywords.some((keyword) => combined.includes(keyword));
  });

  const byReason = annotated.reduce((acc, row) => {
    const reason = row.derived_reason ?? 'General enquiry';
    acc.set(reason, (acc.get(reason) ?? 0) + 1);
    return acc;
  }, new Map());

  const reasonBreakdown = Array.from(byReason.entries())
    .map(([label, count]) => ({ label, count, percent: (count / Math.max(total, 1)) * 100 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const byHour = annotated.reduce((acc, row) => {
    if (!row.started_at) return acc;
    const started = new Date(row.started_at);
    if (Number.isNaN(started.getTime())) return acc;
    const hour = started.getHours();
    acc[hour] = (acc[hour] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total,
    appointmentRequests,
    urgentHeuristic,
    reasonBreakdown,
    byHour
  };
};

function Dashboard() {
  const [appointmentsRaw, setAppointmentsRaw] = useState(() => defaultState());
  const [appointments, setAppointments] = useState(() => defaultState());
  const [calls, setCalls] = useState(() => defaultState());
  const [targetDateKey, setTargetDateKey] = useState(formatDateKey(new Date()));
  const [selectedDateLabel, setSelectedDateLabel] = useState(() => {
    const today = new Date();
    return today.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
  });

  const fetchAppointments = useCallback(async () => {
    setAppointmentsRaw((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [{ data: todayData, error: todayError }, { data: calendarData, error: calendarError }] =
        await Promise.all([
          supabase.from('Apps_Today').select(appointmentSelect).limit(500),
          supabase.from('Apps_Calendar_Year').select(appointmentSelect).limit(500)
        ]);

      if (todayError && calendarError) {
        throw new Error(todayError?.message ?? calendarError?.message ?? 'Failed to load appointment datasets');
      }

      const combinedRows = [...(todayData ?? []), ...(calendarData ?? [])];

      setAppointmentsRaw({
        rows: combinedRows,
        loading: false,
        error: null
      });
    } catch (err) {
      setAppointmentsRaw({
        rows: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load appointment datasets'
      });
    }
  }, []);

  const fetchCallsForDate = useCallback(async (dateKey) => {
    if (!dateKey) return;
    setCalls((prev) => ({ ...prev, loading: true, error: null }));

    const startTime = new Date(`${dateKey}T${operatingHours.openHour.toString().padStart(2, '0')}:00:00`);
    const endTime = new Date(`${dateKey}T${operatingHours.closeHour.toString().padStart(2, '0')}:${operatingHours.closeMinute.toString().padStart(2, '0')}:00`);

    const { data, error } = await supabase
      .from('call_logs_allfields')
      .select(
        'id, started_at, reason_for_call, summary_one_line, category, last_queue_group_name, appointment_offered, asked_to_call_back_8am'
      )
      .gte('started_at', startTime.toISOString())
      .lt('started_at', endTime.toISOString())
      .order('started_at', { ascending: true });

    if (error) {
      setCalls({
        rows: [],
        loading: false,
        error: error.message ?? 'Failed to load call logs'
      });
      return;
    }

    setCalls({
      rows: data ?? [],
      loading: false,
      error: null
    });
  }, []);

  const refreshDashboard = useCallback(async () => {
    await fetchAppointments();
  }, [fetchAppointments]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  // Map raw appointments into normalised structure with consistent keys.
  useEffect(() => {
    if (appointmentsRaw.loading) return;
    if (appointmentsRaw.error) {
      setAppointments({
        rows: [],
        loading: false,
        error: appointmentsRaw.error
      });
      return;
    }

    const normalisedRows = appointmentsRaw.rows.map((row) => ({
      session_holder: row.session_holder ?? row['Full Name of the Session Holder of the Session'],
      day_of_week: row.day_of_week ?? row['Day of Week'],
      session_start: row.session_start ?? row["Session's Session Start"],
      session_end: row.session_end ?? row["Session's Session End"],
      appointment_date: row.appointment_date ?? row['Appointment Date'],
      appointment_time: row.appointment_time ?? row['Appointment Time'],
      slot_type: row.slot_type ?? row['Slot Type'],
      slot_duration: row.slot_duration ?? row['Slot Duration'],
      availability: row.availability ?? row['Availability'],
      dna: row.dna ?? row['DNA'],
      consultation_time: row.consultation_time ?? row['Consultation Time']
    }));

    setAppointments({
      rows: normalisedRows,
      loading: false,
      error: null
    });
  }, [appointmentsRaw]);

  // Determine the operational date based on available data.
  useEffect(() => {
    if (appointments.loading) return;
    const todayKey = formatDateKey(new Date());
    const keys = Array.from(
      new Set(
        appointments.rows
          .map((row) => normaliseDateKey(row.appointment_date))
          .filter(Boolean)
      )
    ).sort();

    if (keys.length === 0) {
      setTargetDateKey(todayKey);
      setSelectedDateLabel(
        new Date().toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'short'
        })
      );
      return;
    }

    if (keys.includes(todayKey)) {
      setTargetDateKey(todayKey);
      setSelectedDateLabel(
        new Date(todayKey).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'short'
        })
      );
      return;
    }

    const fallbackKey = keys[keys.length - 1];
    setTargetDateKey(fallbackKey);
    setSelectedDateLabel(
      new Date(fallbackKey).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    );
  }, [appointments.loading, appointments.rows]);

  useEffect(() => {
    if (!appointments.loading && targetDateKey) {
      fetchCallsForDate(targetDateKey);
    }
  }, [appointments.loading, fetchCallsForDate, targetDateKey]);

  const supply = useMemo(() => supplyMetrics(appointments.rows, targetDateKey), [appointments.rows, targetDateKey]);

  const demand = useMemo(() => demandMetrics(calls.rows), [calls.rows]);

  const pressureSummary = useMemo(() => {
    const totalBookOnDay = supply.bookOnDay.length;
    const appointmentNeeds = demand.appointmentRequests.length;
    const urgentNeeds = demand.urgentHeuristic.length;

    return {
      totalBookOnDay,
      appointmentNeeds,
      urgentNeeds,
      remainingCapacity: supply.bookOnDay.length - supply.booked.length,
      deficit: appointmentNeeds - supply.available.length
    };
  }, [supply, demand]);

  const hours = useMemo(() => buildHourSlots(), []);

  const timeline = useMemo(() => {
    return hours.map((slot) => {
      const supplyHour = supply.bookOnDayByHour[slot.hour] ?? { total: 0, available: 0 };
      const callCount = demand.byHour[slot.hour] ?? 0;
      return {
        ...slot,
        booked: supplyHour.total - supplyHour.available,
        available: supplyHour.available,
        totalSlots: supplyHour.total,
        calls: callCount
      };
    });
  }, [hours, supply.bookOnDayByHour, demand.byHour]);

  const progress = useMemo(() => {
    if (!targetDateKey) return null;
    const now = new Date();
    const start = new Date(`${targetDateKey}T${operatingHours.openHour.toString().padStart(2, '0')}:00:00`);
    const end = new Date(`${targetDateKey}T${operatingHours.closeHour.toString().padStart(2, '0')}:${operatingHours.closeMinute.toString().padStart(2, '0')}:00`);

    if (now < start) return 0;
    if (now > end) return 100;
    return ((now - start) / (end - start)) * 100;
  }, [targetDateKey]);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Today’s Operations Outlook</h1>
          <p>
            Monitoring GP appointment supply against patient demand from 08:00 – 18:30.
          </p>
          <p className="date-label">
            Monitoring date: <strong>{selectedDateLabel}</strong>
          </p>
          {progress != null && (
            <div className="progress-bar" aria-label="Operating day progress">
              <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}
        </div>
        <button className="refresh-button" onClick={refreshDashboard} disabled={appointments.loading}>
          {appointments.loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </header>

      <section className="metrics-grid">
        <article className="metric-card">
          <span className="metric-label">Book-on-day slots</span>
          <span className="metric-value">{supply.bookOnDay.length}</span>
          <span className="metric-subtext">
            {supply.booked.length} booked · {supply.available.length} available
          </span>
        </article>

        <article className="metric-card success">
          <span className="metric-label">Capacity remaining</span>
          <span className="metric-value">{Math.max(pressureSummary.remainingCapacity, 0)}</span>
          <span className="metric-subtext">Book-on-day slots not yet allocated</span>
        </article>

        <article className="metric-card warning">
          <span className="metric-label">Appointment requests</span>
          <span className="metric-value">{pressureSummary.appointmentNeeds}</span>
          <span className="metric-subtext">
            {pressureSummary.deficit > 0
              ? `Shortfall of ${pressureSummary.deficit}`
              : 'Within available capacity'}
          </span>
        </article>

        <article className="metric-card">
          <span className="metric-label">Urgent language spotted</span>
          <span className="metric-value">{pressureSummary.urgentNeeds}</span>
          <span className="metric-subtext">Calls mentioning urgent or emergency need</span>
        </article>
      </section>

      <section className="panels">
        <article className="panel">
          <header className="panel-header">
            <h2>Call reasons today</h2>
            <span className="panel-meta">
              {demand.total} calls analysed · {demand.appointmentRequests.length} appointment requests
            </span>
          </header>
          {(calls.error || appointments.error) && (
            <div className="panel-alert error">{calls.error ?? appointments.error}</div>
          )}
          {calls.loading && !calls.error && <div className="panel-alert info">Loading call demand…</div>}
          {!calls.loading && !calls.error && (
            <ul className="reason-list">
              {demand.reasonBreakdown.map((reason) => (
                <li key={reason.label}>
                  <span className="reason-name">{reason.label}</span>
                  <span className="reason-count">
                    {reason.count} · {reason.percent.toFixed(1)}%
                  </span>
                </li>
              ))}
              {demand.reasonBreakdown.length === 0 && (
                <li className="empty">No calls recorded for the selected day.</li>
              )}
            </ul>
          )}
        </article>

        <article className="panel">
          <header className="panel-header">
            <h2>Supply versus demand by hour</h2>
            <span className="panel-meta">
              Book-on-day slots compared with call volume within opening hours
            </span>
          </header>
          <div className="timeline-table">
            <table>
              <thead>
                <tr>
                  <th>Hour</th>
                  <th>Calls</th>
                  <th>Book-on-day slots</th>
                  <th>Available now</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row) => (
                  <tr key={row.hour}>
                    <td>{row.label}</td>
                    <td>{row.calls}</td>
                    <td>{row.totalSlots}</td>
                    <td>{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

// Dashboard removed — replaced with a lightweight placeholder to avoid import errors.
import React from 'react';
export default function Dashboard() {
  return null;
}
