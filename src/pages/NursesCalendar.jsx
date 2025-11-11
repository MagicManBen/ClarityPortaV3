import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import NursesPerDayView from './NursesPerDayView.jsx';

const monthMap = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};
const pad = (n) => n.toString().padStart(2, '0');
const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const normaliseDateKey = (value) => {
  if (!value) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const alt = trimmed.match(/^(\d{1,2})-(\w{3})-(\d{4})$/i);
  if (alt) {
    const day = Number(alt[1]);
    const month = monthMap[alt[2].toLowerCase()];
    const year = Number(alt[3]);
    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const parsed = new Date(year, month, day);
      return formatDateKey(parsed);
    }
  }
  let parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) parsed = new Date(trimmed.replace(/-/g, ' '));
  return Number.isNaN(parsed.getTime()) ? null : formatDateKey(parsed);
};
const parseDateFromKey = (key) => {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split('-').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// Nurses to look for (match by surname substring)
const nurseSurnames = ['mansell', 'amison', 'masterson', 'moreton', 'griffiths'];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M12 9v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.73 3h16.9a2 2 0 0 0 1.73-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NursesCalendar() {
  const [state, setState] = useState({ loading: true, error: null, rows: [] });

  const fetchCalendar = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // include Slot Type and Availability to evaluate nurse rules
      const selectCols = '"Appointment Date", "Full Name of the Session Holder of the Session", "Slot Type", "Availability"';
      const fetchAllRows = async (pageSize = 1000) => {
        const all = [];
        const first = await supabase.from('Apps_Calendar_Year').select(selectCols, { count: 'exact' }).range(0, pageSize - 1);
        if (first.error) throw first.error;
        all.push(...(first.data ?? []));
        const total = Number.isFinite(first.count) ? first.count : null;
        if (total == null) {
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

  useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [activeView, setActiveView] = useState('month');
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Admin support: reuse same admin actions table behaviour
  const [adminMode, setAdminMode] = useState(false);
  const [adminPasswordModal, setAdminPasswordModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminActionModal, setAdminActionModal] = useState(null);
  const [adminActionsMap, setAdminActionsMap] = useState(new Map());

  const fetchAdminActions = useCallback(async () => {
    try {
      const minDate = formatDateKey(monthStart);
      const maxDate = formatDateKey(monthEnd);
      const res = await supabase.from('calendar_admin_actions').select('*').gte('appointment_date', minDate).lte('appointment_date', maxDate).order('created_at', { ascending: false });
      if (res.error) throw res.error;
      const rows = res.data ?? [];
      const map = new Map();
      for (const r of rows) {
        const d = r.appointment_date;
        if (!d) continue;
        const key = typeof d === 'string' ? d.slice(0, 10) : formatDateKey(new Date(d));
        if (!map.has(key)) map.set(key, { action: r.action, created_at: r.created_at, created_by: r.created_by });
      }
      setAdminActionsMap(map);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to load admin actions', err);
      setAdminActionsMap(new Map());
    }
  }, [monthStart, monthEnd]);

  useEffect(() => { fetchAdminActions(); }, [fetchAdminActions, state.rows]);

  const [warningModal, setWarningModal] = useState(null);

  const handleAdminToggleClick = () => {
    if (adminMode) { setAdminMode(false); return; }
    setAdminPassword(''); setAdminPasswordModal(true);
  };
  const handleAdminPasswordSubmit = (e) => {
    e.preventDefault();
    if (adminPassword === 'Swifty1!') { setAdminMode(true); setAdminPasswordModal(false); } else { alert('Incorrect admin password'); setAdminPassword(''); }
  };

  const saveAdminAction = async (dateKey, actionText) => {
    try {
      const resp = await supabase.from('calendar_admin_actions').insert([{ appointment_date: dateKey, action: actionText, created_by: 'admin' }]);
      if (resp.error) throw resp.error;
      alert('Saved admin action');
      try { await fetchAdminActions(); } catch (e) {}
    } catch (err) { console.error('Failed to save admin action', err); alert('Failed to save admin action: ' + (err?.message || String(err))); }
  };

  const clearAdminActions = async (dateKey) => {
    try {
      const resp = await supabase.from('calendar_admin_actions').delete().eq('appointment_date', dateKey);
      if (resp.error) throw resp.error;
      alert('Cleared admin actions for ' + dateKey);
      try { await fetchAdminActions(); } catch (e) {}
    } catch (err) { console.error('Failed to clear admin actions', err); alert('Failed to clear admin actions: ' + (err?.message || String(err))); }
  };
  useEffect(() => {
    if (!adminPasswordModal && !adminActionModal) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setAdminPasswordModal(false); setAdminActionModal(null); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [adminPasswordModal, adminActionModal]);

  const gotoPrevMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const gotoNextMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Aggregation: map of dateKey -> counts and nurse/person info including rule checks
  const aggregated = useMemo(() => {
    try {
      const map = new Map();

      const parseAvailabilityHours = (avail) => {
        if (!avail) return null;
        const s = avail.toString();
        const m = s.match(/(\d{1,2}:\d{2})\s*(?:-|to|–)\s*(\d{1,2}:\d{2})/i);
        if (!m) return null;
        const [, start, end] = m;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
        const dur = (eh + em / 60) - (sh + sm / 60);
        return Number.isFinite(dur) ? dur : null;
      };

      state.rows.forEach((row) => {
        const rawDate = row['Appointment Date'] ?? row.appointment_date;
        const dateKey = normaliseDateKey(rawDate);
        if (!dateKey) return;
        if (dateKey < formatDateKey(monthStart) || dateKey > formatDateKey(monthEnd)) return;
        const dateObj = parseDateFromKey(dateKey);
        if (!dateObj) return;
        const weekday = dateObj.getDay();
        if (weekday === 0 || weekday === 6) return; // skip weekends

        const fullNameRaw = row['Full Name of the Session Holder of the Session'] ?? row.full_name_of_the_session_holder_of_the_session ?? '';
        if (!fullNameRaw) return;
        const sn = fullNameRaw.toString().toLowerCase();
        if (sn.includes('covid')) return; // ignore covid rows

        const slotTypeRaw = row['Slot Type'] ?? row.slot_type ?? '';
        const slotType = slotTypeRaw ? slotTypeRaw.toString().toLowerCase() : '';
        const availabilityRaw = row['Availability'] ?? row.availability ?? '';
        const durationHours = parseAvailabilityHours(availabilityRaw);

        const existing = map.get(dateKey) ?? { total: 0, nurseSet: new Set(), hasSampleTesting: false, persons: new Map() };
        existing.total = (existing.total ?? 0) + 1;
        if (slotType.includes('sample testing') || (slotType.includes('sample') && slotType.includes('testing'))) existing.hasSampleTesting = true;

        const personKey = fullNameRaw.toString().trim();
        const person = existing.persons.get(personKey) ?? { name: personKey, totalHours: 0, hasLunch: false };
        if (durationHours && Number.isFinite(durationHours)) person.totalHours = (person.totalHours || 0) + durationHours;
        if (slotType.includes('lunch')) person.hasLunch = true;
        existing.persons.set(personKey, person);

        for (const s of nurseSurnames) {
          if (sn.includes(s)) {
            existing.nurseSet.add(fullNameRaw.toString().trim());
            break;
          }
        }
        map.set(dateKey, existing);
      });

      // Post-process to compute warnings (amber rules)
      for (const [k, v] of map.entries()) {
        v.nurseNames = Array.from(v.nurseSet || []);
        delete v.nurseSet;
        v.lacksSampleTesting = !v.hasSampleTesting;
        const missingLunch = [];
        for (const [pkey, p] of (v.persons || new Map()).entries()) {
          const totalH = p.totalHours || 0;
          if (totalH > 3 && !p.hasLunch) missingLunch.push(p.name);
        }
        v.missingLunchNames = missingLunch;
        v.warning = v.lacksSampleTesting || (v.missingLunchNames && v.missingLunchNames.length > 0);
        delete v.persons;
        map.set(k, v);
      }

      return { map };
    } catch (err) {
      console.error('Nurses aggregation error', err);
      return { map: new Map(), error: err instanceof Error ? err.message : String(err) };
    }
  }, [state.rows, monthStart, monthEnd]);

  const days = useMemo(() => {
    const result = [];
    const dim = monthEnd.getDate();
    let week = [null, null, null, null, null];
    for (let d = 1; d <= dim; d += 1) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const wd = date.getDay();
      if (wd === 0 || wd === 6) continue;
      const pos = wd - 1;
      const key = formatDateKey(date);
      const counts = (aggregated.map && aggregated.map.get(key)) ?? { total: 0, nurseNames: [] };
      week[pos] = { date, key, counts };
      if (pos === 4) { result.push(...week); week = [null, null, null, null, null]; }
    }
    if (week.some((c) => c !== null)) result.push(...week);
    while (result.length % 5 !== 0) result.push(null);
    return result;
  }, [monthStart, monthEnd, aggregated]);

  const monthLabel = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const formatNurseDisplay = (full) => {
    if (!full) return '';
    const s = full.toString().trim();
    // honorific in parentheses e.g. "(Miss)"
    const par = s.match(/\(([^)]+)\)/);
    const honorific = par ? par[1].trim() : '';
    let surname = '';
    if (s.includes(',')) {
      surname = s.split(',')[0].trim();
    } else {
      const parts = s.split(/\s+/);
      surname = parts.length ? parts[parts.length - 1].trim() : s;
    }
    return (honorific ? `${honorific} ${surname}` : surname).toUpperCase();
  };

  // Assign unique colors to nurses based on their name
  const getNurseColor = (name) => {
    const colors = [
      { bg: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.18))', border: 'rgba(59, 130, 246, 0.4)', text: '#1e40af' },      // Blue
      { bg: 'linear-gradient(135deg, rgba(20, 184, 166, 0.12), rgba(13, 148, 136, 0.18))', border: 'rgba(20, 184, 166, 0.4)', text: '#115e59' },   // Teal
      { bg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(147, 51, 234, 0.18))', border: 'rgba(168, 85, 247, 0.4)', text: '#6b21a8' },   // Purple
      { bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.12), rgba(249, 115, 22, 0.18))', border: 'rgba(251, 146, 60, 0.4)', text: '#9a3412' },     // Orange
      { bg: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(22, 163, 74, 0.18))', border: 'rgba(34, 197, 94, 0.4)', text: '#15803d' },       // Green
      { bg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(79, 70, 229, 0.18))', border: 'rgba(99, 102, 241, 0.4)', text: '#3730a3' },   // Indigo
      { bg: 'linear-gradient(135deg, rgba(234, 179, 8, 0.12), rgba(202, 138, 4, 0.18))', border: 'rgba(234, 179, 8, 0.4)', text: '#713f12' },        // Amber
      { bg: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(6, 182, 212, 0.18))', border: 'rgba(14, 165, 233, 0.4)', text: '#0369a1' },     // Cyan
      { bg: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(219, 39, 119, 0.18))', border: 'rgba(236, 72, 153, 0.4)', text: '#9f1239' },   // Pink
    ];
    
    // Simple hash function to consistently assign colors based on name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Nurses Calendar — {monthLabel}</span>
          </h1>
          {/* View tabs: Per Month / Per Day */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={() => setActiveView('month')}
              aria-pressed={activeView === 'month'}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                background: activeView === 'month' ? '#14b8a6' : '#f3f4f6',
                color: activeView === 'month' ? 'white' : '#374151',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: activeView === 'month' ? '0 4px 10px rgba(20,184,166,0.12)' : 'none'
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
                background: activeView === 'perday' ? '#14b8a6' : '#f3f4f6',
                color: activeView === 'perday' ? 'white' : '#374151',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: activeView === 'perday' ? '0 4px 10px rgba(20,184,166,0.12)' : 'none'
              }}
            >
              Per Day
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="refresh-button" onClick={gotoPrevMonth} aria-label="Previous month">◀</button>
            <button className="refresh-button" onClick={gotoNextMonth} aria-label="Next month">▶</button>
          </div>
          <button className="refresh-button" onClick={fetchCalendar} disabled={state.loading}>{state.loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {state.error && <div className="table-alert error">Error: {state.error}</div>}
      {!state.error && state.loading && <div className="table-alert info">Loading calendar…</div>}

      {!state.loading && !state.error && activeView === 'month' && (
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

            .nurses-calendar-header-day {
              animation: slideInFromTop 0.4s ease-out backwards;
            }

            .nurses-calendar-day-cell {
              animation: cellFadeIn 0.5s ease-out backwards;
              transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .nurses-calendar-day-cell:hover:not(.past-day) {
              transform: translateY(-4px) scale(1.02);
              box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15) !important;
              z-index: 10;
            }

            .nurses-calendar-day-cell.nurse-warning {
              animation: cellFadeIn 0.5s ease-out backwards, amberGlow 2s ease-in-out infinite;
            }

            .nurse-badge {
              display: inline-flex;
              align-items: center;
              padding: 6px 12px;
              border-radius: 8px;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.03em;
              transition: all 0.2s ease;
            }

            .nurse-badge:hover {
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
                  className="nurses-calendar-header-day"
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
                    className="nurses-calendar-day-cell"
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
                const adminActionObj = adminActionsMap.get(key);
                const adminActionText = adminActionObj?.action ?? '';
                const adminTagClass = adminActionText
                  ? (adminActionText.toLowerCase().includes('needed') ? 'locum-needed'
                    : adminActionText.toLowerCase().includes('looking') ? 'locum-looking'
                    : adminActionText.toLowerCase().includes('confirmed') ? 'locum-confirmed'
                    : adminActionText.toLowerCase().includes('added') ? 'locum-added'
                    : '')
                  : '';
                const today = new Date();
                const todayKey = formatDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
                const isPast = key < todayKey;

                const isWarning = Boolean(counts && counts.warning) && !isPast;
                return (
                  <div
                    key={key}
                    className={`nurses-calendar-day-cell ${isPast ? 'past-day' : ''} ${isWarning ? 'nurse-warning' : ''}`}
                    style={{ 
                      minHeight: 200,
                      background: isPast 
                        ? 'linear-gradient(135deg, rgba(248, 250, 252, 0.7), rgba(241, 245, 249, 0.7))'
                        : isWarning
                        ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(248, 250, 252, 0.98))',
                      borderRadius: '16px',
                      padding: '16px',
                      cursor: isWarning && !isPast ? 'pointer' : adminMode ? 'pointer' : 'default',
                      position: 'relative',
                      border: isWarning && !isPast
                        ? '3px solid #f59e0b'
                        : isPast
                        ? '2px solid rgba(203, 213, 225, 0.4)'
                        : '2px solid rgba(226, 232, 240, 0.8)',
                      boxShadow: isWarning && !isPast
                        ? '0 8px 24px rgba(0, 0, 0, 0.12)'
                        : isPast
                        ? '0 2px 8px rgba(0, 0, 0, 0.04)'
                        : '0 4px 16px rgba(0, 0, 0, 0.08)',
                      overflow: 'hidden',
                      animationDelay: `${idx * 0.03}s`,
                      opacity: isPast ? 0.55 : 1
                    }}
                    role={isWarning ? 'button' : undefined}
                    tabIndex={isWarning ? 0 : undefined}
                    onClick={(e) => {
                      if (adminMode) { e.stopPropagation(); setAdminActionModal({ date, key }); return; }
                      if (isPast) return;
                      const countsNow = (aggregated.map && aggregated.map.get(key)) || counts || {};
                      const lacksSample = Boolean(countsNow.lacksSampleTesting);
                      const missingLunch = (countsNow.missingLunchNames || []);
                      if (lacksSample || (missingLunch && missingLunch.length > 0)) {
                        const warnings = [];
                        if (lacksSample) warnings.push({ text: 'No SAMPLE TESTING slots found', level: 'amber' });
                        if (missingLunch && missingLunch.length > 0) warnings.push({ text: `Missing Lunch Break for: ${missingLunch.join(', ')}`, level: 'amber' });
                        setWarningModal({ date, key, warnings, counts: countsNow });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (adminMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAdminActionModal({ date, key }); return; }
                      if (isPast) return;
                      if (isWarning && (e.key === 'Enter' || e.key === ' ')) {
                        const countsNow = (aggregated.map && aggregated.map.get(key)) || counts || {};
                        const lacksSample = Boolean(countsNow.lacksSampleTesting);
                        const missingLunch = (countsNow.missingLunchNames || []);
                        const warnings = [];
                        if (lacksSample) warnings.push({ text: 'No SAMPLE TESTING slots found', level: 'amber' });
                        if (missingLunch && missingLunch.length > 0) warnings.push({ text: `Missing Lunch Break for: ${missingLunch.join(', ')}`, level: 'amber' });
                        setWarningModal({ date, key, warnings, counts: countsNow });
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
                        color: isWarning && !isPast ? '#d97706' : isPast ? '#94a3b8' : '#0f172a',
                        letterSpacing: '-0.02em'
                      }}>
                        {`${pad(date.getDate())}/${pad(date.getMonth() + 1)}`}
                      </div>

                      {/* corner icon */}
                      <div 
                        className={`corner-icon ${isWarning ? 'warning-amber' : 'ok'}`}
                        title={isWarning ? 'Warning' : 'ok'} 
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
                        {isWarning ? <WarningIcon /> : <CheckIcon />}
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
                      {(!counts || (counts.total === 0 && (!counts.nurseNames || counts.nurseNames.length === 0))) ? (
                        <div style={{ 
                          textAlign: 'center', 
                          padding: '24px 0',
                          color: '#94a3b8',
                          fontStyle: 'italic',
                          fontSize: '14px'
                        }}>
                          No nurses
                        </div>
                      ) : (
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
                            Nurses
                          </div>
                          <div style={{ 
                            display: 'flex', 
                            flexWrap: 'wrap', 
                            gap: '6px' 
                          }}>
                            {(counts.nurseNames || []).length > 0 ? (
                              (counts.nurseNames || []).map((n, i) => {
                                const displayName = formatNurseDisplay(n);
                                const colorScheme = getNurseColor(displayName);
                                return (
                                  <div
                                    key={i}
                                    className="nurse-badge"
                                    style={{
                                      background: colorScheme.bg,
                                      border: `1.5px solid ${colorScheme.border}`,
                                      color: colorScheme.text
                                    }}
                                  >
                                    {displayName}
                                  </div>
                                );
                              })
                            ) : (
                              <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>—</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {!state.loading && !state.error && activeView === 'perday' && (
        <NursesPerDayView />
      )}

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

      {adminActionModal && (
        <div className="modal-overlay" onClick={() => setAdminActionModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Admin actions" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Admin actions for {adminActionModal.date.toLocaleDateString('en-GB')}</h3>
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {['Locum Needed', 'Looking for Locum', 'Locum Confirmed', 'Locum Added'].map((a) => (
                      <button key={a} type="button" className="refresh-button" onClick={async () => { await saveAdminAction(adminActionModal.key, a); setAdminActionModal(null); }}>{a}</button>
                    ))}
                    <button type="button" className="refresh-button" onClick={async () => { if (window.confirm('Clear admin tag for ' + adminActionModal.key + '?')) { await clearAdminActions(adminActionModal.key); setAdminActionModal(null); } }}>Clear</button>
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

      {warningModal && (
        <div className="modal-overlay" onClick={() => setWarningModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Warnings for ${warningModal?.date.toLocaleDateString('en-GB')}`} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Warnings for {warningModal?.date.toLocaleDateString('en-GB')}</h3>
                <div style={{ marginTop: 8 }}>
                  <ul className="reason-list">
                    {warningModal.counts?.lacksSampleTesting && (
                      <li className="warning-item-amber">No SAMPLE TESTING slots found for this day</li>
                    )}
                    {(warningModal.counts?.missingLunchNames || []).length > 0 && (
                      <li className="warning-item-amber">Missing Lunch Break for: {(warningModal.counts.missingLunchNames || []).join(', ')}</li>
                    )}
                    {(!warningModal.counts?.lacksSampleTesting && !(warningModal.counts?.missingLunchNames || []).length) && (
                      <li className="reason-name">No warnings</li>
                    )}
                  </ul>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="refresh-button" onClick={() => setWarningModal(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <button type="button" className={`admin-toggle ${adminMode ? 'active' : ''}`} onClick={handleAdminToggleClick} aria-pressed={adminMode} aria-label={adminMode ? 'Exit admin mode' : 'Enter admin mode'}>{adminMode ? 'Admin: ON' : 'Admin Mode'}</button>
    </div>
  );
}

export default NursesCalendar;
