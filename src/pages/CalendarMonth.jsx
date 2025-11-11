import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import PerDayView from './PerDayView.jsx';

// Normalize a variety of date formats to YYYY-MM-DD (similar logic to Dashboard)
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

const pad = (n) => n.toString().padStart(2, '0');

// Use local date components to avoid UTC shifts when converting to YYYY-MM-DD
const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const normaliseDateKey = (value) => {
  if (!value) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  // ISO-like
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // dd-MMM-yyyy
  const alt = trimmed.match(/^(\d{1,2})-(\w{3})-(\d{4})$/i);
  if (alt) {
    const day = Number(alt[1]);
    const month = monthMap[alt[2].toLowerCase()];
    const year = Number(alt[3]);
    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      // construct as local date (avoid UTC shift issues)
      const parsed = new Date(year, month, day);
      return formatDateKey(parsed);
    }
  }

  // Fallback parsing: try Date constructor, then try replacing dashes
  let parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    parsed = new Date(trimmed.replace(/-/g, ' '));
  }
  return Number.isNaN(parsed.getTime()) ? null : formatDateKey(parsed);
};

// Parse a YYYY-MM-DD date key into a local Date (avoid UTC pitfalls)
const parseDateFromKey = (key) => {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Extract a sensible display surname from a full holder string.
// Rules:
// - remove parenthetical parts (e.g. "(DR)")
// - remove leading/trailing "Dr" tokens
// - if a comma is present, take the left-hand part (assumed surname)
// - otherwise take the last word as surname
const extractSurname = (fullName) => {
  if (!fullName) return '';
  let s = fullName.toString().trim();
  // remove parenthetical content like (DR) or (LOC)
  s = s.replace(/\(.*?\)/g, '').trim();
  // remove Dr or Dr. tokens
  s = s.replace(/\bDr\.?\b/ig, '').trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[0].trim();
  const parts = s.split(/\s+/);
  return parts.length ? parts[parts.length - 1].trim() : s;
};

// Decide OTD color class based on threshold
const getOtdClass = (counts, date) => {
  if (!counts) return '';
  const d = date instanceof Date ? date : parseDateFromKey(date);
  if (!d) return '';
  const weekday = d.getDay();
  const thresh = weekday === 1 ? 25 : 20;
  if (counts.total < thresh) return 'otd-low';
  if (counts.total === thresh) return 'otd-ok';
  return 'otd-good';
};

// Assign unique colors to doctors based on their name
const getDoctorColor = (name) => {
  const colors = [
    { bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.18))', border: 'rgba(59, 130, 246, 0.4)', text: '#1e40af', glow: 'rgba(59, 130, 246, 0.7)', glowBright: 'rgba(59, 130, 246, 0.5)' },      // Blue
    { bg: 'linear-gradient(135deg, rgba(20, 184, 166, 0.12), rgba(13, 148, 136, 0.18))', border: 'rgba(20, 184, 166, 0.4)', text: '#115e59', glow: 'rgba(20, 184, 166, 0.7)', glowBright: 'rgba(20, 184, 166, 0.5)' },   // Teal
    { bg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(147, 51, 234, 0.18))', border: 'rgba(168, 85, 247, 0.4)', text: '#6b21a8', glow: 'rgba(168, 85, 247, 0.7)', glowBright: 'rgba(168, 85, 247, 0.5)' },   // Purple
    { bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(249, 115, 22, 0.18))', border: 'rgba(251, 146, 60, 0.4)', text: '#9a3412', glow: 'rgba(251, 146, 60, 0.7)', glowBright: 'rgba(251, 146, 60, 0.5)' },     // Orange
    { bg: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(22, 163, 74, 0.18))', border: 'rgba(34, 197, 94, 0.4)', text: '#15803d', glow: 'rgba(34, 197, 94, 0.7)', glowBright: 'rgba(34, 197, 94, 0.5)' },       // Green
    { bg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(79, 70, 229, 0.18))', border: 'rgba(99, 102, 241, 0.4)', text: '#3730a3', glow: 'rgba(99, 102, 241, 0.7)', glowBright: 'rgba(99, 102, 241, 0.5)' },   // Indigo
    { bg: 'linear-gradient(135deg, rgba(234, 179, 8, 0.12), rgba(202, 138, 4, 0.18))', border: 'rgba(234, 179, 8, 0.4)', text: '#713f12', glow: 'rgba(234, 179, 8, 0.7)', glowBright: 'rgba(234, 179, 8, 0.5)' },        // Amber
    { bg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(139, 92, 246, 0.18))', border: 'rgba(168, 85, 247, 0.4)', text: '#5b21b6', glow: 'rgba(168, 85, 247, 0.7)', glowBright: 'rgba(168, 85, 247, 0.5)' },     // Violet
    { bg: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(6, 182, 212, 0.18))', border: 'rgba(14, 165, 233, 0.4)', text: '#0369a1', glow: 'rgba(14, 165, 233, 0.7)', glowBright: 'rgba(14, 165, 233, 0.5)' },     // Cyan
    { bg: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(219, 39, 119, 0.18))', border: 'rgba(236, 72, 153, 0.4)', text: '#9f1239', glow: 'rgba(236, 72, 153, 0.7)', glowBright: 'rgba(236, 72, 153, 0.5)' },   // Pink
    { bg: 'linear-gradient(135deg, rgba(129, 140, 248, 0.12), rgba(110, 114, 254, 0.18))', border: 'rgba(129, 140, 248, 0.4)', text: '#3730a3', glow: 'rgba(129, 140, 248, 0.7)', glowBright: 'rgba(129, 140, 248, 0.5)' }, // Light Indigo
    { bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(96, 165, 250, 0.18))', border: 'rgba(59, 130, 246, 0.4)', text: '#0c4a6e', glow: 'rgba(59, 130, 246, 0.7)', glowBright: 'rgba(59, 130, 246, 0.5)' },    // Sky Blue
  ];
  
  // Simple hash function to consistently assign colors based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Small presentational icon for corner badges. Uses currentColor so CSS can
// control colour via the containing element.
function WarningIcon({ variant }) {
  if (!variant) return null;
  // variant values: 'doc-trainee-warning', 'warning-day', 'warning-amber'
  switch (variant) {
    case 'doc-trainee-warning':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <path d="M12 12a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20c1.6-4 6-6 8-6s6.4 2 8 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'warning-day':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <path d="M12 8v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'warning-amber':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <path d="M12 9v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarMonth() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] });

  // Active view for the doctors calendar: 'month' or 'perday'
  const [activeView, setActiveView] = useState('month');

  const fetchCalendar = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
  // select the relevant columns to minimise payload
  const selectCols = '"Appointment Date", "Availability", "Slot Type", "Full Name of the Session Holder of the Session"';

      // helper to fetch all rows in pages. Supabase/PostgREST may cap rows per request, so use count+range.
      const fetchAllRows = async (pageSize = 1000) => {
        const all = [];

        // first page - request count
        const first = await supabase
          .from('Apps_Calendar_Year')
          .select(selectCols, { count: 'exact' })
          .range(0, pageSize - 1);

        if (first.error) throw first.error;
        all.push(...(first.data ?? []));

        const total = Number.isFinite(first.count) ? first.count : null;

        if (total == null) {
          // Unknown total - keep fetching pages until we get fewer than pageSize
          let page = 1;
          while (true) {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            const res = await supabase.from('Apps_Calendar_Year').select(selectCols).range(from, to);
            if (res.error) throw res.error;
            if (!res.data || res.data.length === 0) break;
            all.push(...res.data);
            if (res.data.length < pageSize) break;
            page += 1;
          }
        } else {
          // We know total, fetch remaining pages deterministically
          for (let from = pageSize; from < total; from += pageSize) {
            const to = Math.min(from + pageSize - 1, total - 1);
            const res = await supabase.from('Apps_Calendar_Year').select(selectCols).range(from, to);
            if (res.error) throw res.error;
            all.push(...(res.data ?? []));
          }
        }

        return all;
      };

      const data = await fetchAllRows();
      setState({ loading: false, error: null, rows: data ?? [] });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : 'Load error', rows: [] });
    }
  }, []);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);


  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Modal state for No Duty warnings
  const [warningModal, setWarningModal] = useState(null);
  // Modal state for per-day summary view (past dates)
  const [summaryModal, setSummaryModal] = useState(null);
  // Filter state: 'all' or 'warnings'
  const [filter, setFilter] = useState('all');
  // Admin mode state and modals
  const [adminMode, setAdminMode] = useState(false);
  const [adminPasswordModal, setAdminPasswordModal] = useState(false);
  const [adminActionModal, setAdminActionModal] = useState(null); // { date, key }
  const [adminPassword, setAdminPassword] = useState('');

  // Admin actions map: dateKey -> { action, created_at, created_by }
  const [adminActionsMap, setAdminActionsMap] = useState(new Map());

  // Fetch latest admin actions for the visible month
  const fetchAdminActions = useCallback(async () => {
    try {
      const minDate = formatDateKey(monthStart);
      const maxDate = formatDateKey(monthEnd);
      const res = await supabase
        .from('calendar_admin_actions')
        .select('*')
        .gte('appointment_date', minDate)
        .lte('appointment_date', maxDate)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      const rows = res.data ?? [];
      const map = new Map();
      for (const r of rows) {
        const d = r.appointment_date;
        if (!d) continue;
        const key = typeof d === 'string' ? d.slice(0, 10) : formatDateKey(new Date(d));
        if (!map.has(key)) {
          map.set(key, { action: r.action, created_at: r.created_at, created_by: r.created_by });
        }
      }
      setAdminActionsMap(map);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load admin actions', err);
      setAdminActionsMap(new Map());
    }
  }, [monthStart, monthEnd]);

  // load admin actions when month or rows change
  useEffect(() => {
    fetchAdminActions();
  }, [fetchAdminActions, state.rows]);

  // Toggle admin mode: if turning on, show password prompt; if turning off, just disable
  const handleAdminToggleClick = () => {
    if (adminMode) {
      setAdminMode(false);
      return;
    }
    setAdminPassword('');
    setAdminPasswordModal(true);
  };

  const handleAdminPasswordSubmit = (e) => {
    e.preventDefault();
    // NOTE: password provided by user in the request. Keep client-side only.
    if (adminPassword === 'Swifty1!') {
      setAdminMode(true);
      setAdminPasswordModal(false);
    } else {
      // simple feedback — you can replace this with a nicer UI
      // eslint-disable-next-line no-alert
      alert('Incorrect admin password');
      setAdminPassword('');
    }
  };

  // Save an admin action to Supabase. Expects date key (YYYY-MM-DD) and action text.
  const saveAdminAction = async (dateKey, actionText) => {
    try {
      // Insert into a simple audit table. See SQL provided separately to create this table.
      // use the lower-case table name matching your database: calendar_admin_actions
      const resp = await supabase.from('calendar_admin_actions').insert([{ appointment_date: dateKey, action: actionText, created_by: 'admin' }]);
      if (resp.error) throw resp.error;
      // eslint-disable-next-line no-alert
      alert('Saved admin action');
      // Refresh local admin actions after saving so UI shows latest tag
      try {
        await fetchAdminActions();
      } catch (e) {
        // ignore
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save admin action', err);
      // eslint-disable-next-line no-alert
      alert('Failed to save admin action: ' + (err?.message || String(err)));
    }
  };

  // Delete any admin actions for the given date (clears the tag)
  const clearAdminActions = async (dateKey) => {
    try {
      const resp = await supabase.from('calendar_admin_actions').delete().eq('appointment_date', dateKey);
      if (resp.error) throw resp.error;
      // eslint-disable-next-line no-alert
      alert('Cleared admin actions for ' + dateKey);
      try {
        await fetchAdminActions();
      } catch (e) {
        // ignore
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to clear admin actions', err);
      // eslint-disable-next-line no-alert
      alert('Failed to clear admin actions: ' + (err?.message || String(err)));
    }
  };

  useEffect(() => {
    if (!warningModal && !summaryModal && !adminPasswordModal && !adminActionModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setWarningModal(null);
        setSummaryModal(null);
        setAdminPasswordModal(false);
        setAdminActionModal(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [warningModal, summaryModal, adminPasswordModal, adminActionModal]);

  const gotoPrevMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const gotoNextMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  const aggregated = useMemo(() => {
    try {
      // Map dateKey -> { total, available, embargoed, booked }
      const map = new Map();
      const includedRows = [];
      const excludedRows = [];

  state.rows.forEach((row, idx) => {
        const rawDate = row['Appointment Date'] ?? row.appointment_date;
        const dateKey = normaliseDateKey(rawDate);
        if (!dateKey) {
          excludedRows.push({ row, reason: 'dateInvalid', idx, rawDate });
          return;
        }

        // only include dates in this month
        if (dateKey < formatDateKey(monthStart) || dateKey > formatDateKey(monthEnd)) {
          excludedRows.push({ row, reason: 'outOfMonth', idx, dateKey });
          return;
        }

        // determine weekday and ignore weekends entirely
        const dateObj = parseDateFromKey(dateKey);
        if (!dateObj) {
          excludedRows.push({ row, reason: 'dateInvalidParse', idx, dateKey });
          return;
        }
        const weekday = dateObj.getDay(); // 0=Sun,6=Sat
        if (weekday === 0 || weekday === 6) {
          excludedRows.push({ row, reason: 'weekendIgnored', idx, dateKey });
          return; // exclude weekends from all rules
        }

        const slotType = (row['Slot Type'] ?? row.slot_type ?? '').toString().toLowerCase();
        // Treat both explicit 'Book on the Day' rows and the alternative
        // 'On The Day_GP TO BOOK' variant as OTD (book-on-the-day) slots.
        // The latter can appear with underscores and mixed case; detect by
        // checking for the presence of the phrase plus 'gp' and 'book'.
        const isBookOnDay = slotType.includes('book on the day') || (
          slotType.includes('on the day') && slotType.includes('gp') && slotType.includes('book')
        );
        // Other appointment-range slot types to track separately
        const isWithin1Week = slotType.includes('appointment within 1 week') || slotType.includes('within 1 week');
        const is1to2Weeks = slotType.includes('appointment 1 to 2 weeks') || slotType.includes('1 to 2 weeks') || slotType.includes('1 to 2');
        const isDutySlot = slotType.includes('emergency gps to book only') || (slotType.includes('emergency gps') && slotType.includes('book'));

    // Extract holder name early so duty-slot processing can record who is duty
  const fullNameRaw = row['Full Name of the Session Holder of the Session'] ?? row.full_name_of_the_session_holder_of_the_session ?? row['Full Name'] ?? row.fullName;
  const surname = (fullNameRaw ?? '').toString().trim();
  const sn = surname.toLowerCase();
  // Defensive: ignore rows where the holder name is the erroneous "COVID-19" entry
  if (sn.includes('covid')) {
    excludedRows.push({ row, reason: 'covidName', idx, rawName: fullNameRaw });
    return;
  }
  // Known trainees (explicit list provided)
  const traineesList = ['agukwendu', 'jinge'];

        // No duplicate-guard: count every Book-on-the-Day row as requested

        // If this is a duty slot, mark the date as duty (even if it's not a Book on the Day slot)
        // But skip duty marking for weekends (already returned above)
        if (isDutySlot) {
          // ensure any duty-only marker includes the doctor/trainee sets so later
          // Book-on-the-Day rows can safely add to them without throwing
          const existing = map.get(dateKey) ?? { total: 0, available: 0, embargoed: 0, booked: 0, duty: false, doctorSet: new Set(), traineeSet: new Set(), dutyDoctorSet: new Set(), oneWeek: 0, twoWeeks: 0 };
          existing.duty = true;
          existing.doctorSet = existing.doctorSet ?? new Set();
          existing.traineeSet = existing.traineeSet ?? new Set();
          existing.dutyDoctorSet = existing.dutyDoctorSet ?? new Set();
          existing.oneWeek = existing.oneWeek ?? 0;
          existing.twoWeeks = existing.twoWeeks ?? 0;
          if (surname) existing.dutyDoctorSet.add(surname);
          map.set(dateKey, existing);
        }

        // Even if a row is not a Book-on-the-Day row, it may represent an
        // appointment within 1 week or within 1-2 weeks — record those counts
        // so we can display them alongside OTD counts.
        if (isWithin1Week || is1to2Weeks) {
          const existing = map.get(dateKey) ?? { total: 0, available: 0, embargoed: 0, booked: 0, duty: false, doctorSet: new Set(), traineeSet: new Set(), dutyDoctorSet: new Set(), oneWeek: 0, twoWeeks: 0 };
          existing.oneWeek = existing.oneWeek ?? 0;
          existing.twoWeeks = existing.twoWeeks ?? 0;
          if (isWithin1Week) existing.oneWeek += 1;
          if (is1to2Weeks) existing.twoWeeks += 1;
          map.set(dateKey, existing);
        }

        // If not a Book on the Day slot, exclude from OTD count (but duty marking already handled)
        if (!isBookOnDay) {
          excludedRows.push({ row, reason: 'slotTypeMismatch', idx });
          return;
        }

        // For OTD we count all Book-on-the-Day rows regardless of availability
  const entry = map.get(dateKey) ?? { total: 0, available: 0, embargoed: 0, booked: 0, duty: false, doctorSet: new Set(), traineeSet: new Set() };
  // Defensive: ensure sets exist even if a duty marker created the entry earlier without them
  entry.doctorSet = entry.doctorSet ?? new Set();
  entry.traineeSet = entry.traineeSet ?? new Set();
  entry.dutyDoctorSet = entry.dutyDoctorSet ?? new Set();
  entry.total += 1; // OTD increments for all Book-on-the-Day

  // We only count Book-on-the-Day rows for OTD. Availability (available/embargoed)
  // is intentionally ignored per request to avoid confusion — do not increment
  // available/embargoed counters.
  const classif = 'otd';

  // Per updated rule: treat a clinician as a Doctor only if their session-holder
  // name contains the literal '(Dr)' (case-insensitive). This prevents
  // non-doctor clinicians from being listed as doctors while keeping known
  // trainees separate.
  if (fullNameRaw && /\(dr\)/i.test(fullNameRaw) && sn) {
    entry.doctorSet.add(surname);
  }
  // Still detect known trainees by surname (or where the trainee id appears
  // anywhere in the holder name) and add them to the trainee set so
  // trainee-specific warnings can be applied. Use substring match to catch
  // cases like "AGUKWENDU, REGINALD (DR)" where the trainee id appears as
  // part of a longer holder string.
  if (sn) {
    for (const t of traineesList) {
      if (sn.includes(t)) {
        entry.traineeSet.add(surname);
        break;
      }
    }
  }

  map.set(dateKey, entry);

  includedRows.push({ row, idx, dateKey, classif });
      });

      // After building counts, compute low-OTD warnings per date and doctor/trainee warnings
      for (const [dateKey, counts] of map.entries()) {
        const d = parseDateFromKey(dateKey);
        if (!d) continue;
        const weekday = d.getDay(); // 0=Sun,1=Mon...
        if (weekday === 0 || weekday === 6) {
          counts.lowWarning = false;
        } else if (weekday === 1) {
          // Monday threshold 25
          counts.lowWarning = (counts.total < 25);
        } else {
          counts.lowWarning = (counts.total < 20);
        }
        // doctor / trainee analysis: compute counts and flag if exactly 1 doctor and 2+ trainees
  // Compute doctor / trainee counts. Note: doctorSet contains all clinicians
  // who had Book-on-the-Day rows. We treat the known trainees specially so we
  // can compute "one OTHER doctor" (non-trainee doctor) for the amber warning.
  // Include both clinicians who had Book-on-the-Day rows (doctorSet) and any
  // clinicians recorded as duty for the date (dutyDoctorSet). Duty doctors may
  // come from duty-only rows and so might not appear in doctorSet; include
  // them so duty names show up in the Doctors box.
  const doctorSetNames = counts.doctorSet ? Array.from(counts.doctorSet) : [];
  const dutyNames = counts.dutyDoctorSet ? Array.from(counts.dutyDoctorSet) : [];
  const allDoctorNames = Array.from(new Set([...doctorSetNames, ...dutyNames]));
  const traineeNames = counts.traineeSet ? Array.from(counts.traineeSet) : [];
  const traineeLower = new Set(traineeNames.map((n) => n.toLowerCase()));
  const nonTraineeDoctors = allDoctorNames.filter((n) => !traineeLower.has(n.toLowerCase()));
  const nonTraineeDoctorCount = nonTraineeDoctors.length;
  counts.doctorCount = nonTraineeDoctorCount;
  counts.traineeCount = traineeNames.length;
  // Doctor names shown in the "Doctors" box should exclude known trainees
  counts.doctorNames = nonTraineeDoctors;
  counts.traineeNames = traineeNames;
  // Amber rule: both known trainees are present AND there is exactly one OTHER (non-trainee) doctor
  const hasBothTrainees = traineeLower.has('agukwendu') && traineeLower.has('jinge');
  counts.doctorTraineeWarning = (hasBothTrainees && nonTraineeDoctorCount === 1);
  // duty doctor names (if any)
  counts.dutyDoctorNames = counts.dutyDoctorSet ? Array.from(counts.dutyDoctorSet) : [];
  // remove the Sets so JSON.stringify in debug works cleanly
  delete counts.doctorSet;
  delete counts.traineeSet;
  delete counts.dutyDoctorSet;
        map.set(dateKey, counts);
      }

      return { map, includedRows, excludedRows };
    } catch (err) {
      // Prevent the whole page crashing; surface the error to the debug UI and render an empty map
      // eslint-disable-next-line no-console
      console.error('Calendar aggregation error', err);
      return { map: new Map(), includedRows: [], excludedRows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [state.rows, monthStart, monthEnd]);

  // Build calendar grid for the current month (Monday → Friday only)
  const days = useMemo(() => {
    const result = [];
    const dim = monthEnd.getDate();

    // Build week rows containing only Monday..Friday (5 columns)
    let week = [null, null, null, null, null];

    for (let d = 1; d <= dim; d += 1) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const wd = date.getDay(); // 0=Sun..6=Sat

      // skip weekends entirely
      if (wd === 0 || wd === 6) {
        // if it's Saturday or Sunday, just continue (we don't render weekend columns)
        continue;
      }

      const pos = wd - 1; // Monday -> 0, Tuesday -> 1, ... Friday -> 4
      const key = formatDateKey(date);
      const counts = (aggregated.map && aggregated.map.get(key)) ?? { total: 0, available: 0, embargoed: 0, booked: 0, duty: false };
      week[pos] = { date, key, counts };

      // if we've filled Friday, push the week and reset
      if (pos === 4) {
        result.push(...week);
        week = [null, null, null, null, null];
      }
    }

    // push final partial week (if any) — keep layout rectangular by filling blanks
    if (week.some((c) => c !== null)) {
      result.push(...week);
    }

    // ensure the total number of cells is a multiple of 5 (complete final row)
    while (result.length % 5 !== 0) result.push(null);

    return result;
  }, [monthStart, monthEnd, aggregated]);

  const monthLabel = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Doctors Calendar — {monthLabel}</span>
            <span
              className="help-icon"
              tabIndex={0}
              role="button"
              aria-label={`Help: what this page shows and warning meanings`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.2" />
                <path d="M12 8a1.5 1.5 0 10-1.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 14v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="help-tooltip" role="tooltip">
                <strong style={{ display: 'block', marginBottom: 6 }}>About this page</strong>
                This page shows counts of "Book on the Day" slots and nearby appointment ranges for each working day in the selected month.
                <div style={{ height: 8 }} />
                <strong style={{ display: 'block', marginBottom: 6 }}>Warnings</strong>
                <div style={{ marginBottom: 4 }}>• Red: No Duty scheduled for that day.</div>
                <div style={{ marginBottom: 4 }}>• Amber: Low OTD (below the weekday threshold).</div>
                <div>• Purple: High trainee-to-doctor ratio (two trainees to one doctor).</div>
              </span>
            </span>
          </h1>
          {/* View tabs: Per Month / Per Day (placed under the title) */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={() => setActiveView('month')}
              aria-pressed={activeView === 'month'}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                background: activeView === 'month' ? '#f97316' : '#f3f4f6',
                color: activeView === 'month' ? 'white' : '#374151',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: activeView === 'month' ? '0 4px 10px rgba(249,115,22,0.12)' : 'none'
              }}
            >
              Per Month
            </button>
            <button
              type="button"
              onClick={() => setActiveView('perday')}
              aria-pressed={activeView === 'perday'}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                background: activeView === 'perday' ? '#f97316' : '#f3f4f6',
                color: activeView === 'perday' ? 'white' : '#374151',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: activeView === 'perday' ? '0 4px 10px rgba(249,115,22,0.12)' : 'none'
              }}
            >
              Per Day
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="filter-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className={`filter-button ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-button ${filter === 'warnings' ? 'active' : ''}`}
              onClick={() => setFilter('warnings')}
              aria-pressed={filter === 'warnings'}
            >
              Warnings
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="refresh-button" onClick={gotoPrevMonth} aria-label="Previous month">◀</button>
            <button className="refresh-button" onClick={gotoNextMonth} aria-label="Next month">▶</button>
          </div>
          <button className="refresh-button" onClick={fetchCalendar} disabled={state.loading}>
            {state.loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {/* debug toggle removed per request */}
        </div>
      </header>

      {state.error && <div className="table-alert error">Error: {state.error}</div>}

      {!state.error && state.loading && <div className="table-alert info">Loading calendar…</div>}

      {!state.loading && !state.error && aggregated.error && (
        <div className="table-alert error">Aggregation error: {aggregated.error}</div>
      )}

      {!state.loading && !state.error && !aggregated.error && activeView === 'month' && (
        <section className="panel" style={{ 
          background: 'transparent', 
          boxShadow: 'none', 
          border: 'none', 
          padding: 0 
        }}>
          <style>{`
            @keyframes cellFadeIn {
              from {
                opacity: 0;
                transform: scale(0.95);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }

            @keyframes pulseWarning {
              0%, 100% {
                box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
              }
              50% {
                box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
              }
            }

            @keyframes slideInFromTop {
              from {
                opacity: 0;
                transform: translateY(-10px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            @keyframes warningGlow {
              0%, 100% {
                border-color: #ef4444;
                box-shadow: 0 8px 24px rgba(239, 68, 68, 0.25), 0 0 0 2px rgba(239, 68, 68, 0.1);
              }
              50% {
                border-color: #dc2626;
                box-shadow: 0 12px 32px rgba(239, 68, 68, 0.35), 0 0 0 3px rgba(239, 68, 68, 0.2);
              }
            }

            @keyframes amberGlow {
              0%, 100% {
                border-color: #f59e0b;
                box-shadow: 0 8px 24px rgba(245, 158, 11, 0.25), 0 0 0 2px rgba(245, 158, 11, 0.1);
              }
              50% {
                border-color: #d97706;
                box-shadow: 0 12px 32px rgba(245, 158, 11, 0.35), 0 0 0 3px rgba(245, 158, 11, 0.2);
              }
            }

            @keyframes purpleGlow {
              0%, 100% {
                border-color: #a855f7;
                box-shadow: 0 8px 24px rgba(168, 85, 247, 0.25), 0 0 0 2px rgba(168, 85, 247, 0.1);
              }
              50% {
                border-color: #9333ea;
                box-shadow: 0 12px 32px rgba(168, 85, 247, 0.35), 0 0 0 3px rgba(168, 85, 247, 0.2);
              }
            }

            .calendar-header-day {
              animation: slideInFromTop 0.4s ease-out backwards;
            }

            .calendar-day-cell {
              animation: cellFadeIn 0.5s ease-out backwards;
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .calendar-day-cell:hover:not(.past-day):not(.filtered-empty) {
              transform: translateY(-4px) scale(1.02);
              box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15) !important;
              z-index: 10;
            }

            .calendar-day-cell.warning-day {
              animation: cellFadeIn 0.5s ease-out backwards, warningGlow 2s ease-in-out infinite;
            }

            .calendar-day-cell.warning-amber {
              animation: cellFadeIn 0.5s ease-out backwards, amberGlow 2s ease-in-out infinite;
            }

            .calendar-day-cell.doc-trainee-warning {
              animation: cellFadeIn 0.5s ease-out backwards, purpleGlow 2s ease-in-out infinite;
            }

            .badge-count {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 32px;
              height: 32px;
              padding: 0 10px;
              border-radius: 8px;
              font-weight: 800;
              font-size: 15px;
              letter-spacing: -0.02em;
              transition: all 0.2s ease;
            }

            .badge-count:hover {
              transform: scale(1.1);
            }

            .staff-badge {
              display: inline-flex;
              align-items: center;
              padding: 6px 12px;
              border-radius: 8px;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.03em;
              transition: all 0.2s ease;
              background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.15));
              border: 1.5px solid rgba(59, 130, 246, 0.3);
              color: #1e40af;
            }

            .staff-badge.duty {
              font-weight: 900;
              position: relative;
            }

            .staff-badge.trainee {
              background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.15));
              border: 1.5px solid rgba(139, 92, 246, 0.3);
              color: #5b21b6;
            }

            .staff-badge:hover {
              transform: translateY(-1px);
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
          `}</style>
            <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(5, 1fr)', 
              gap: '12px', 
              fontWeight: 700,
              fontSize: '14px',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#475569',
              marginBottom: '8px'
            }}>
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d, i) => (
                <div 
                  key={d} 
                  className="calendar-header-day"
                  style={{ 
                    textAlign: 'center',
                    padding: '12px',
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(248, 250, 252, 0.95))',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                    animationDelay: `${i * 0.05}s`
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
              {days.map((cell, idx) => {
                if (cell === null) return (
                  <div 
                    key={idx} 
                    className="calendar-day-cell"
                    style={{ 
                      minHeight: 200,
                      background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.4), rgba(241, 245, 249, 0.4))',
                      borderRadius: '16px',
                      border: '2px solid rgba(226, 232, 240, 0.5)',
                      animationDelay: `${idx * 0.03}s`
                    }} 
                  />
                );
                const { date, key, counts } = cell;
                // admin action (if any) for this date
                const adminActionObj = adminActionsMap.get(key);
                const adminActionText = adminActionObj?.action ?? '';
                const adminTagClass = adminActionText
                  ? (adminActionText.toLowerCase().includes('needed') ? 'locum-needed'
                    : adminActionText.toLowerCase().includes('looking') ? 'locum-looking'
                    : adminActionText.toLowerCase().includes('confirmed') ? 'locum-confirmed'
                    : adminActionText.toLowerCase().includes('added') ? 'locum-added'
                    : '')
                  : '';
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                // determine if this date is in the past (local)
                const today = new Date();
                const todayKey = formatDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
                const isPast = key < todayKey;
                const isNoDuty = !counts.duty && !isWeekend && !isPast;
                const isLowOTD = Boolean(counts.lowWarning) && !isWeekend && !isPast;
                const isDocTrainee = Boolean(counts.doctorTraineeWarning) && !isWeekend && !isPast;
                // Map to visual classes with precedence: Trainee ratio (purple) > NoDuty (red) > Low OTD (amber)
                // We show the trainee/doctor-ratio state even if no duty is scheduled.
                let warningClass = '';
                if (isDocTrainee) {
                  warningClass = 'doc-trainee-warning'; // purple for trainee/doctor ratio
                } else if (isNoDuty) {
                  warningClass = 'warning-day'; // red flashing border for no duty
                } else if (isLowOTD) {
                  warningClass = 'warning-amber'; // amber for low OTD
                }
                // If filter is set to 'warnings' and this cell has no warningClass,
                // render a muted empty panel so the calendar grid remains intact.
                if (filter === 'warnings' && !warningClass) {
                  return (
                    <div 
                      key={key} 
                      className="calendar-day-cell filtered-empty" 
                      style={{ 
                        minHeight: 200, 
                        opacity: 0.25,
                        background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.6), rgba(241, 245, 249, 0.6))',
                        borderRadius: '16px',
                        border: '2px dashed rgba(203, 213, 225, 0.4)',
                        animationDelay: `${idx * 0.03}s`
                      }} 
                    />
                  );
                }

                return (
                  <div
                    key={key}
                    className={`calendar-day-cell ${isWeekend ? 'weekend-day' : ''} ${isPast ? 'past-day' : ''} ${warningClass}`}
                    style={{ 
                      minHeight: 200,
                      background: isPast 
                        ? 'linear-gradient(135deg, rgba(248, 250, 252, 0.7), rgba(241, 245, 249, 0.7))'
                        : warningClass === 'warning-day'
                        ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                        : warningClass === 'warning-amber'
                        ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                        : warningClass === 'doc-trainee-warning'
                        ? 'linear-gradient(135deg, #faf5ff, #f3e8ff)'
                        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.98))',
                      borderRadius: '16px',
                      padding: '16px',
                      cursor: warningClass && !isPast ? 'pointer' : adminMode ? 'pointer' : 'default',
                      position: 'relative',
                      border: warningClass && !isPast
                        ? warningClass === 'warning-day'
                          ? '3px solid #ef4444'
                          : warningClass === 'warning-amber'
                          ? '3px solid #f59e0b'
                          : '3px solid #a855f7'
                        : isPast
                        ? '2px solid rgba(203, 213, 225, 0.4)'
                        : '2px solid rgba(226, 232, 240, 0.8)',
                      boxShadow: warningClass && !isPast
                        ? '0 8px 24px rgba(0, 0, 0, 0.12)'
                        : isPast
                        ? '0 2px 8px rgba(0, 0, 0, 0.04)'
                        : '0 4px 16px rgba(0, 0, 0, 0.08)',
                      overflow: 'hidden',
                      animationDelay: `${idx * 0.03}s`,
                      opacity: isPast ? 0.55 : 1
                    }}
                    role={warningClass ? 'button' : undefined}
                    tabIndex={warningClass ? 0 : undefined}
                    onClick={(e) => {
                      // If admin mode is active, open admin action modal for any date
                      if (adminMode) {
                        e.stopPropagation();
                        setAdminActionModal({ date, key });
                        return;
                      }
                      // don't show warnings for past dates
                      if (isPast) return;
                      // Always compute warnings from the current aggregated counts so
                      // we don't miss overlapping conditions (no-duty + trainee ratio).
                      const countsNow = (aggregated.map && aggregated.map.get(key)) || counts || {};
                      const nowIsNoDuty = !countsNow.duty && !isWeekend && !isPast;
                      const nowIsLowOTD = Boolean(countsNow.lowWarning) && !isWeekend && !isPast;
                      const nowIsDocTrainee = Boolean(countsNow.doctorTraineeWarning) && !isWeekend && !isPast;
                      if (nowIsNoDuty || nowIsLowOTD || nowIsDocTrainee) {
                        const warnings = [];
                        if (nowIsNoDuty) warnings.push({ text: 'No Duty scheduled', level: 'red' });
                        if (nowIsLowOTD) warnings.push({ text: 'Low OTD', level: 'amber' });
                        if (nowIsDocTrainee) warnings.push({ text: 'High trainee ratio', level: 'purple' });
                        setWarningModal({ date, key, warnings, details: { doctorNames: countsNow.doctorNames, traineeNames: countsNow.traineeNames, dutyDoctorNames: countsNow.dutyDoctorNames } });
                      }
                    }}
                    onKeyDown={(e) => {
                      // Admin keyboard shortcut: Enter/Space opens admin modal when adminMode
                      if (adminMode && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setAdminActionModal({ date, key });
                        return;
                      }
                      if (isPast) return;
                      if (warningClass && (e.key === 'Enter' || e.key === ' ')) {
                        const countsNow = (aggregated.map && aggregated.map.get(key)) || counts || {};
                        const nowIsNoDuty = !countsNow.duty && !isWeekend && !isPast;
                        const nowIsLowOTD = Boolean(countsNow.lowWarning) && !isWeekend && !isPast;
                        const nowIsDocTrainee = Boolean(countsNow.doctorTraineeWarning) && !isWeekend && !isPast;
                        const warnings = [];
                        if (nowIsNoDuty) warnings.push({ text: 'No Duty scheduled', level: 'red' });
                        if (nowIsLowOTD) warnings.push({ text: 'Low OTD', level: 'amber' });
                        if (nowIsDocTrainee) warnings.push({ text: 'High trainee ratio', level: 'purple' });
                        setWarningModal({ date, key, warnings, details: { doctorNames: countsNow.doctorNames, traineeNames: countsNow.traineeNames, dutyDoctorNames: countsNow.dutyDoctorNames } });
                      }
                    }}
                    >
                    {/* Header with date and indicators */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'flex-start',
                      marginBottom: '12px',
                      paddingBottom: '12px',
                      borderBottom: '2px solid rgba(0, 0, 0, 0.06)'
                    }}>
                      <div style={{ 
                        fontSize: '18px', 
                        fontWeight: 800,
                        color: warningClass && !isPast ? '#dc2626' : isPast ? '#94a3b8' : '#0f172a',
                        letterSpacing: '-0.02em'
                      }}>
                        {`${pad(date.getDate())}/${pad(date.getMonth() + 1)}`}
                      </div>

                      {/* corner icon always present (warning or OK) positioned absolutely by CSS */}
                      <div 
                        className={`corner-icon ${warningClass ? warningClass : 'ok'}`} 
                        title={warningClass ? warningClass : 'ok'} 
                        aria-hidden
                        style={{
                          position: 'static',
                          width: '32px',
                          height: '32px',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {warningClass ? <WarningIcon variant={warningClass} /> : <CheckIcon />}
                      </div>
                      
                      {/* admin action tag */}
                      {adminActionObj && (
                        <div 
                          className={`admin-tag ${adminTagClass}`} 
                          title={adminActionText} 
                          aria-hidden
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '50px',
                            padding: '6px 12px',
                            borderRadius: '10px',
                            fontSize: '11px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                          }}
                        >
                          {adminActionText}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {counts.total === 0 ? (
                        <div style={{ 
                          textAlign: 'center', 
                          padding: '24px 0',
                          color: '#94a3b8',
                          fontStyle: 'italic',
                          fontSize: '14px'
                        }}>
                          No slots
                        </div>
                      ) : (
                        <>
                          {/* OTD and Week counts - single row of three */}
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '8px',
                            alignItems: 'stretch'
                          }}>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '10px 8px',
                              background: counts.lowWarning && !isPast
                                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.15))'
                                : 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.15))',
                              borderRadius: '10px',
                              border: counts.lowWarning && !isPast
                                ? '2px solid rgba(239, 68, 68, 0.3)'
                                : '2px solid rgba(16, 185, 129, 0.3)',
                            }}>
                              <span style={{ 
                                fontSize: '11px', 
                                fontWeight: 700,
                                color: counts.lowWarning && !isPast ? '#991b1c' : '#065f46',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}>
                                OTD
                              </span>
                              <span className="badge-count" style={{ 
                                background: counts.lowWarning && !isPast
                                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                  : getOtdClass(counts, date) === 'otd-good'
                                  ? 'linear-gradient(135deg, #10b981, #059669)'
                                  : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: '#ffffff',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                              }}>
                                {counts.total}
                              </span>
                            </div>
                            
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '10px 8px',
                              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(37, 99, 235, 0.12))',
                              borderRadius: '10px',
                              border: '2px solid rgba(59, 130, 246, 0.25)',
                            }}>
                              <span style={{ 
                                fontSize: '11px', 
                                fontWeight: 700,
                                color: '#1e40af',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}>
                                1W
                              </span>
                              <span className="badge-count" style={{ 
                                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                color: '#ffffff',
                                fontSize: '13px',
                                minWidth: '28px',
                                height: '28px',
                                boxShadow: '0 3px 10px rgba(59, 130, 246, 0.3)'
                              }}>
                                {counts.oneWeek ?? 0}
                              </span>
                            </div>

                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '10px 8px',
                              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(124, 58, 237, 0.12))',
                              borderRadius: '10px',
                              border: '2px solid rgba(139, 92, 246, 0.25)',
                            }}>
                              <span style={{ 
                                fontSize: '11px', 
                                fontWeight: 700,
                                color: '#6d28d9',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}>
                                2W
                              </span>
                              <span className="badge-count" style={{ 
                                background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                color: '#ffffff',
                                fontSize: '13px',
                                minWidth: '28px',
                                height: '28px',
                                boxShadow: '0 3px 10px rgba(139, 92, 246, 0.3)'
                              }}>
                                {counts.twoWeeks ?? 0}
                              </span>
                            </div>
                          </div>

                          {/* Doctors section */}
                          {(counts.doctorNames && counts.doctorNames.length > 0) && (
                            <div style={{
                              padding: '12px',
                              background: 'rgba(255, 255, 255, 0.6)',
                              borderRadius: '12px',
                              border: '2px solid rgba(226, 232, 240, 0.6)'
                            }}>
                              <div style={{ 
                                fontWeight: 800, 
                                marginBottom: '10px', 
                                fontSize: '12px',
                                color: '#475569',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em'
                              }}>
                                Doctors
                              </div>
                              <div style={{ 
                                display: 'flex', 
                                flexWrap: 'wrap', 
                                gap: '6px' 
                              }}>
                                {(() => {
                                  const doctorNames = counts.doctorNames || [];
                                  const dutyNames = counts.dutyDoctorNames || [];
                                  
                                  // Build ordered list: duty names first (deduped), then other doctors
                                  const seen = new Set();
                                  const ordered = [];
                                  const pushIfNew = (n) => {
                                    const key = (n || '').toLowerCase();
                                    if (!seen.has(key)) {
                                      seen.add(key);
                                      ordered.push(n);
                                    }
                                  };
                                  // Add duty names first
                                  for (const d of dutyNames) pushIfNew(d);
                                  // Then add other doctor names
                                  for (const d of doctorNames) pushIfNew(d);

                                  return ordered.map((n, i) => {
                                    const isDuty = (dutyNames || []).some((dn) => dn.toLowerCase() === (n || '').toLowerCase());
                                    const surname = extractSurname(n) || n;
                                    const display = `Dr ${surname}`.toUpperCase();
                                    const colorScheme = getDoctorColor(surname);
                                    
                                    // Create unique animation name for this doctor's duty glow
                                    const animationName = `dutyGlow_${surname.replace(/\s+/g, '_')}`;
                                    
                                    return (
                                      <div key={i}>
                                        {isDuty && (
                                          <style>{`
                                            @keyframes ${animationName} {
                                              0%, 100% {
                                                box-shadow: 0 0 0 0 ${colorScheme.glow}, 0 0 20px ${colorScheme.glowBright}, 0 4px 12px rgba(0, 0, 0, 0.1);
                                              }
                                              50% {
                                                box-shadow: 0 0 0 8px ${colorScheme.glow.replace('0.7', '0')}, 0 0 30px ${colorScheme.glowBright}, 0 6px 16px rgba(0, 0, 0, 0.15);
                                              }
                                            }
                                            
                                            .duty-badge-${i}::before {
                                              content: '';
                                              position: absolute;
                                              inset: -4px;
                                              border-radius: 10px;
                                              background: radial-gradient(circle, ${colorScheme.glowBright.replace('0.5', '0.4')} 0%, transparent 70%);
                                              z-index: -1;
                                              animation: ${animationName} 2s ease-in-out infinite;
                                            }
                                            
                                            .duty-badge-${i} {
                                              animation: ${animationName} 2s ease-in-out infinite;
                                            }
                                          `}</style>
                                        )}
                                        <div
                                          className={`staff-badge ${isDuty ? `duty duty-badge-${i}` : ''}`}
                                          style={{
                                            background: colorScheme.bg,
                                            border: `1.5px solid ${colorScheme.border}`,
                                            color: colorScheme.text
                                          }}
                                        >
                                          {display}
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Trainees section */}
                          {(counts.traineeNames && counts.traineeNames.length > 0) && (
                            <div style={{
                              padding: '12px',
                              background: 'rgba(255, 255, 255, 0.6)',
                              borderRadius: '12px',
                              border: '2px solid rgba(226, 232, 240, 0.6)'
                            }}>
                              <div style={{ 
                                fontWeight: 800, 
                                marginBottom: '10px', 
                                fontSize: '12px',
                                color: '#475569',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em'
                              }}>
                                Trainees
                              </div>
                              <div style={{ 
                                display: 'flex', 
                                flexWrap: 'wrap', 
                                gap: '6px' 
                              }}>
                                {counts.traineeNames.map((n, i) => {
                                  const surname = extractSurname(n) || n;
                                  const display = `Dr ${surname}`.toUpperCase();
                                  return (
                                    <div
                                      key={i}
                                      className="staff-badge trainee"
                                    >
                                      {display}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {!state.loading && !state.error && !aggregated.error && activeView === 'perday' && (
        <section className="panel">
          <PerDayView />
        </section>
      )}
      {warningModal && (
        <div className="modal-overlay" onClick={() => setWarningModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Warnings" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Warnings for {warningModal.date.toLocaleDateString('en-GB')}</h3>
                <div style={{ marginTop: 8 }}>
                  <ul>
                    {(warningModal.warnings || []).map((w, i) => (
                      <li key={i} className={w.level === 'red' ? 'warning-item-red' : (w.level === 'purple' ? 'warning-item-purple' : 'warning-item-amber')} style={{ marginBottom: 8 }}>{w.text}</li>
                    ))}
                  </ul>
                </div>
                {/* note: per UI request we don't show OTD/Available numbers in the warnings modal */}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="refresh-button" onClick={() => setWarningModal(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {summaryModal && (
        <div className="fullpage-overlay" onClick={() => setSummaryModal(null)}>
          <div className="fullpage-modal" role="dialog" aria-modal={true} aria-label="Summary" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={() => setSummaryModal(null)}>Close</button>
            {/* Blank content for the per-day summary (to be implemented) */}
            <div style={{ paddingTop: 36 }} />
          </div>
        </div>
      )}
      {/* Admin password modal */}
      {adminPasswordModal && (
        <div className="modal-overlay" onClick={() => setAdminPasswordModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Admin password" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleAdminPasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Enter Admin Password</h3>
                <div style={{ marginTop: 8 }}>
                  <input autoFocus type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} aria-label="Admin password" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="refresh-button" onClick={() => setAdminPasswordModal(false)}>Cancel</button>
                <button type="submit" className="refresh-button">Enter</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin action modal (choose one action for the selected date) */}
      {adminActionModal && (
        <div className="modal-overlay" onClick={() => setAdminActionModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Admin actions" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Admin actions for {adminActionModal.date.toLocaleDateString('en-GB')}</h3>
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {['Locum Needed', 'Looking for Locum', 'Locum Confirmed', 'Locum Added'].map((a) => (
                      <button
                        key={a}
                        type="button"
                        className="refresh-button"
                        onClick={async () => {
                          await saveAdminAction(adminActionModal.key, a);
                          setAdminActionModal(null);
                        }}
                      >
                        {a}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="refresh-button"
                      onClick={async () => {
                        // Clear any admin actions for this date
                        if (window.confirm('Clear admin tag for ' + adminActionModal.key + '?')) {
                          await clearAdminActions(adminActionModal.key);
                          setAdminActionModal(null);
                        }
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="refresh-button" onClick={() => setAdminActionModal(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Mode floating toggle */}
      <button
        type="button"
        className={`admin-toggle ${adminMode ? 'active' : ''}`}
        onClick={handleAdminToggleClick}
        aria-pressed={adminMode}
        aria-label={adminMode ? 'Exit admin mode' : 'Enter admin mode'}
      >
        {adminMode ? 'Admin: ON' : 'Admin Mode'}
      </button>
      <DebugPanel aggregated={aggregated} rawRows={state.rows} monthStart={monthStart} monthEnd={monthEnd} />
    </div>
  );
}

function DebugPanel({ aggregated, rawRows, monthStart, monthEnd }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => setVisible(Boolean(e.detail?.show));
    window.addEventListener('calendar-debug-toggle', handler);
    return () => window.removeEventListener('calendar-debug-toggle', handler);
  }, []);

  if (!visible) return null;

  const mapEntries = aggregated.map ? Array.from(aggregated.map.entries()) : [];
  const included = aggregated.includedRows ?? [];
  const excluded = aggregated.excludedRows ?? [];

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Debug — calendar data</h2>
        <span className="panel-meta">Detailed diagnostics for calendar aggregation</span>
      </header>

      <div style={{ display: 'grid', gap: 8 }}>
        {aggregated.error && (
          <div className="table-alert error">Aggregation error: {aggregated.error}</div>
        )}
        <div>
          <strong>Raw rows fetched:</strong> {rawRows.length}
        </div>
        <div>
          <strong>Month range:</strong> {formatDateKey(monthStart)} → {formatDateKey(monthEnd)}
        </div>
        <div>
          <strong>Aggregated dates:</strong> {mapEntries.length}
        </div>
        <div>
          <strong>Included rows:</strong> {included.length}
        </div>
        <div>
          <strong>Excluded rows:</strong> {excluded.length}
        </div>

        <details>
          <summary>Aggregation map (date → counts)</summary>
          <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(mapEntries, null, 2)}</pre>
        </details>

        <details>
          <summary>Included rows (first 100)</summary>
          <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(included.slice(0, 100), null, 2)}</pre>
        </details>

        <details>
          <summary>Excluded rows (first 100 with reason)</summary>
          <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(excluded.slice(0, 100), null, 2)}</pre>
        </details>

        <details>
          <summary>Raw sample (first 200 rows)</summary>
          <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(rawRows.slice(0, 200), null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

export default CalendarMonth;
