import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient.js';

function WarningDot({ level = 'amber' }) {
  const color = level === 'red' ? '#ef4444' : '#f59e0b';
  return (
    <span style={{ display: 'inline-flex', width: 10, height: 10, borderRadius: 10, background: color, marginRight: 8 }} aria-hidden />
  );
}

export default function SlotCompliance() {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
    const [totalCount, setTotalCount] = useState(null);
    const [dateCount, setDateCount] = useState(null);
    const [fetchedRows, setFetchedRows] = useState([]);
    const [allViolations, setAllViolations] = useState([]);
    const [allRows, setAllRows] = useState([]);
    // Filters
    const [clinicianFilter, setClinicianFilter] = useState('All');
    const [slotTypeFilter, setSlotTypeFilter] = useState('All');
    const [showOnlyViolations, setShowOnlyViolations] = useState(true);
    // Sorting
    const [sortBy, setSortBy] = useState('time');
    const [sortDir, setSortDir] = useState('asc'); // 'asc' or 'desc'
    // Alternative slots modal
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [alternativeSlots, setAlternativeSlots] = useState([]);
    const [loadingAlternatives, setLoadingAlternatives] = useState(false);

  const pad = (n) => n.toString().padStart(2, '0');
  const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const revMonth = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const normaliseDateKey = (value) => {
    if (!value) return null;
    const trimmed = value.toString().trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0,10);
    const alt = trimmed.match(/^(\d{1,2})-(\w{3})-(\d{4})$/i);
    if (alt) {
      const day = Number(alt[1]);
      const mon = alt[2].toLowerCase();
      const m = monthMap[mon];
      const year = Number(alt[3]);
      if (Number.isFinite(day) && Number.isFinite(m) && Number.isFinite(year)) {
        return formatDateKey(new Date(year, m, day));
      }
    }
    let parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) parsed = new Date(trimmed.replace(/-/g, ' '));
    return Number.isNaN(parsed.getTime()) ? null : formatDateKey(parsed);
  };
  const todayKey = formatDateKey(new Date());
  // SlotCompliance now shows appointments for today + next 4 weeks by default.
  // We no longer expose a date picker; instead compute the date range used for queries.
  const rangeDays = 28; // today + next 27 days
  const [dateRangeStart] = useState(todayKey);
  const [dateRangeEnd, setDateRangeEnd] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + (rangeDays - 1));
    return formatDateKey(d);
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const KELLY_NAMES = ['MANSELL, Kelly (Miss)', 'AMISON, Kelly (Miss)'];
  const KELLY_M_NAME = 'MANSELL, Kelly (Miss)';
   const KELLY_A_NAME = 'AMISON, Kelly (Miss)';
  const NURSE_NAMES = [
    'MANSELL, Kelly (Miss)',
    'AMISON, Kelly (Miss)',
    'MASTERSON, Sarah (Miss)',
    'MORETON, Alexa (Mrs)',
    'GRIFFITHS, Diana (Mrs)'
  ];

  // Function to fetch alternative slots that comply with the rules
  const fetchAlternativeSlots = async (violatingSlot) => {
    setLoadingAlternatives(true);
    try {
      const slotType = violatingSlot.type.toLowerCase();
      const dates = [];
      for (let i = 0; i < rangeDays; i += 1) {
        const d = new Date(); d.setDate(d.getDate() + i);
        dates.push(`${pad(d.getDate())}-${revMonth[d.getMonth()]}-${d.getFullYear()}`);
      }

      // Build query based on the slot type and rules
      let query = supabase
        .from('Apps_Calendar_Year')
        .select('*')
        .in('Appointment Date', dates)
        .eq('Slot Type', violatingSlot.type)
        .eq('Availability', 'Available');

      // Apply rule-based filters based on slot type
      if (slotType === 'blood clinic') {
        query = query.gte('Slot Duration', 10).in('Full Name of the Session Holder of the Session', KELLY_NAMES);
      } else if (slotType === 'ecg') {
        query = query.gte('Slot Duration', 30).in('Full Name of the Session Holder of the Session', KELLY_NAMES);
      } else if (slotType === 'wound check') {
        query = query.gte('Slot Duration', 30).in('Full Name of the Session Holder of the Session', NURSE_NAMES);
      } else if (slotType === 'annual review multiple') {
        query = query.gte('Slot Duration', 45).in('Full Name of the Session Holder of the Session', NURSE_NAMES);
      } else if (slotType === 'hyperten annual review') {
        query = query.gte('Slot Duration', 30).in('Full Name of the Session Holder of the Session', KELLY_NAMES);
      } else if (slotType === 'hyperten or ckd review') {
        query = query.gte('Slot Duration', 30).eq('Full Name of the Session Holder of the Session', KELLY_M_NAME);
      } else if (slotType === 'flu clinic') {
        query = query.in('Full Name of the Session Holder of the Session', KELLY_NAMES);
      } else if (slotType === 'b12') {
        query = query.gte('Slot Duration', 10).eq('Full Name of the Session Holder of the Session', KELLY_A_NAME);
      }

      const { data, error } = await query.limit(50);
      
      if (error) throw error;

      const alternatives = (data || []).map((r, i) => ({
        id: `alt-${i}`,
        date: r['Appointment Date'],
        time: r['Appointment Time'],
        clinician: r['Full Name of the Session Holder of the Session'],
        type: r['Slot Type'],
        slotDuration: r['Slot Duration'],
        availability: r['Availability']
      }));

      setAlternativeSlots(alternatives);
    } catch (err) {
      console.error('Error fetching alternatives:', err);
      setAlternativeSlots([]);
    } finally {
      setLoadingAlternatives(false);
    }
  };

  // Handle row click
  const handleRowClick = (slot) => {
    if (slot.warnings && slot.warnings.length > 0) {
      setSelectedSlot(slot);
      fetchAlternativeSlots(slot);
    }
  };

  const closeModal = () => {
    setSelectedSlot(null);
    setAlternativeSlots([]);
  };

  useEffect(() => {
    let mounted = true;
    const fetchForRange = async () => {
      setLoading(true);
      setError(null);
      try {
        const selectCols = [
          'appointment_date:"Appointment Date"',
          'appointment_time:"Appointment Time"',
          'full_name:"Full Name of the Session Holder of the Session"',
          'slot_type:"Slot Type"',
          'slot_duration:"Slot Duration"',
          'availability:"Availability"'
        ].join(', ');

        const dates = [];
        for (let i = 0; i < rangeDays; i += 1) {
          const d = new Date(); d.setDate(d.getDate() + i);
          dates.push(`${pad(d.getDate())}-${revMonth[d.getMonth()]}-${d.getFullYear()}`);
        }

        // eslint-disable-next-line no-console
        console.log('[SlotCompliance] selectCols ->', selectCols, 'dates ->', dates.slice(0,3), '...');

        const namesToFilter = [
          'MANSELL, Kelly (Miss)',
          'AMISON, Kelly (Miss)',
          'MASTERSON, Sarah (Miss)',
          'MORETON, Alexa (Mrs)',
          'GRIFFITHS, Diana (Mrs)'
        ];

        let qb = supabase.from('Apps_Calendar_Year').select(selectCols).in('Appointment Date', dates).limit(2000);
        if (namesToFilter && namesToFilter.length > 0) qb = qb.in('Full Name of the Session Holder of the Session', namesToFilter);
        const res = await qb;
        // eslint-disable-next-line no-console
        console.log('[SlotCompliance] response ->', res && { error: res.error, count: res.count, dataPreview: (res.data || []).slice(0,5) });
        if (res.error) throw new Error(res.error.message || String(res.error));
        const all = res.data || [];

  if (mounted) setFetchedRows(all || []);

        try {
          const tot = await supabase.from('Apps_Calendar_Year').select('*', { count: 'exact', head: true });
          if (!tot.error && mounted) setTotalCount(tot.count ?? null);
        } catch (e) {
          // ignore
        }

        try {
          const dc = await supabase.from('Apps_Calendar_Year').select('*', { count: 'exact', head: true }).in('Appointment Date', dates);
          if (!dc.error && mounted) setDateCount(dc.count ?? null);
        } catch (e) {
          // ignore
        }

        const rows = (all)
          .map((r, i) => ({ raw: r, normDate: normaliseDateKey(r.appointment_date ?? r['Appointment Date']) }))
          .map((x, i) => {
            const r = x.raw;
            const clinician = r.full_name ?? r.full_name_of_the_session_holder_of_the_session ?? '';
            const type = r.slot_type ?? r['Slot Type'] ?? '';
            const rawDuration = r.slot_duration ?? r['Slot Duration'] ?? null;
            const slotDuration = rawDuration == null ? null : Number(rawDuration);
            const warnings = [];

            // Rule: 'Blood Clinic' must be >= 10 minutes and be with a Kelly (AMISON or MANSELL)
            if ((type || '').toString().trim().toLowerCase() === 'blood clinic') {
              if (!(Number.isFinite(slotDuration) && slotDuration >= 10)) {
                warnings.push(`Blood Clinic slots should be at least 10 minutes (found ${rawDuration ?? 'no duration'})`);
              }
              const isKelly = /MANSELL\s*,\s*Kelly|AMISON\s*,\s*Kelly/i.test(clinician);
              if (!isKelly) {
                warnings.push(`Blood Clinic slots should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
              }
            }
            // Rule: 'ECG' must be 30 minutes and be with a Kelly (AMISON or MANSELL)
            if ((type || '').toString().trim().toLowerCase() === 'ecg') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
                  warnings.push(`ECG appointments should be 30 minutes or longer (found ${rawDuration ?? 'no duration'})`);
                }
                const isKelly = /MANSELL\s*,\s*Kelly|AMISON\s*,\s*Kelly/i.test(clinician);
                if (!isKelly) {
                  warnings.push(`ECG appointments should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
                }
            }
            // Rule: 'Wound Check' must be 30 minutes and be with a Nurse
            if ((type || '').toString().trim().toLowerCase() === 'wound check') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
                warnings.push(`Wound Check appointments should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
              }
              const isNurse = NURSE_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
              if (!isNurse) {
                warnings.push(`Wound Checks should be performed by a nurse. Found: ${clinician || 'Unknown'}`);
              }
            }
            // Rule: 'ANNUAL REVIEW MULTIPLE' must be 45 minutes and be with a Nurse
            if ((type || '').toString().trim().toLowerCase() === 'annual review multiple') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 45)) {
                  warnings.push(`Annual review (multiple) should be at least 45 minutes (found ${rawDuration ?? 'no duration'})`);
                }
                const isNurse = NURSE_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
                if (!isNurse) {
                  warnings.push(`Annual review (multiple) should be done by a nurse. Found: ${clinician || 'Unknown'}`);
                }
            }
            // Rule: 'HYPERTEN ANNUAL REVIEW' must be 30 minutes and be with a Kelly
            if ((type || '').toString().trim().toLowerCase() === 'hyperten annual review') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
                  warnings.push(`Hypertension annual review should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
                }
                const isKelly = KELLY_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
                if (!isKelly) {
                  warnings.push(`Hypertension annual reviews should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
                }
            }
            // Rule: 'HYPERTEN OR CKD REVIEW' must be 30 minutes and be with Kelly M (MANSELL)
            if ((type || '').toString().trim().toLowerCase() === 'hyperten or ckd review') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
                warnings.push(`Hypertension/CKD review should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
              }
              const isKellyM = (clinician || '').toLowerCase() === KELLY_M_NAME.toLowerCase();
              if (!isKellyM) {
                warnings.push(`This review must be run by Kelly Mansell. Found: ${clinician || 'Unknown'}`);
              }
            }
            // Rule: 'Flu Clinic' clinician check
            if ((type || '').toString().trim().toLowerCase() === 'flu clinic') {
              const isKelly = KELLY_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
              if (!isKelly) {
                warnings.push(`Flu Clinics should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
              }
            }
            // Rule: 'B12' must be 10 minutes and be with Kelly A (AMISON)
            if ((type || '').toString().trim().toLowerCase() === 'b12') {
                if (!(Number.isFinite(slotDuration) && slotDuration >= 10)) {
                  warnings.push(`B12 appointments should be at least 10 minutes (found ${rawDuration ?? 'no duration'})`);
                }
                const isKellyA = (clinician || '').toLowerCase() === KELLY_A_NAME.toLowerCase();
                if (!isKellyA) {
                  warnings.push(`B12 injections should be performed by Kelly Amison. Found: ${clinician || 'Unknown'}`);
                }
            }

            return {
              id: `${r.appointment_time || i}-${i}`,
              date: r.appointment_date ?? todayKey,
              time: r.appointment_time ?? '',
              clinician,
              type,
              slotDuration: slotDuration ?? null,
              availability: r.availability ?? '',
              warnings
            };
          });

        // Only collect rows that violate one or more rules (warnings present)
        const violating = rows.filter((row) => row.warnings && row.warnings.length > 0);
        violating.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        if (mounted) {
          setAllRows(rows);
          setAllViolations(violating);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : (err && err.message) ? err.message : JSON.stringify(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchForRange();
    return () => { mounted = false; };
  }, [dateRangeStart, dateRangeEnd, refreshKey]);

  // Apply client-side filters whenever the fetched data or filter settings change
  useEffect(() => {
    const source = showOnlyViolations ? allViolations : allRows;
    const list = (source || [])
      .filter((r) => (clinicianFilter === 'All' ? true : (r.clinician || '') === clinicianFilter))
      .filter((r) => (slotTypeFilter === 'All' ? true : (r.type || '') === slotTypeFilter));
    // Apply sorting
    const sorted = [...list].sort((a, b) => {
      const s = (col) => (col || '').toString();
      let cmp = 0;
      switch (sortBy) {
        case 'date': cmp = s(a.date).localeCompare(s(b.date)); break;
        case 'time': cmp = s(a.time).localeCompare(s(b.time)); break;
        case 'clinician': cmp = s(a.clinician).localeCompare(s(b.clinician)); break;
        case 'type': cmp = s(a.type).localeCompare(s(b.type)); break;
        case 'slotDuration': cmp = (Number(a.slotDuration || 0) - Number(b.slotDuration || 0)); break;
        case 'warnings': cmp = ((b.warnings && b.warnings.length) - (a.warnings && a.warnings.length)); break;
        default: cmp = s(a.time).localeCompare(s(b.time));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    setSlots(sorted);
  }, [clinicianFilter, slotTypeFilter, showOnlyViolations, allViolations, allRows, sortBy, sortDir]);

  return (
    <div className="page-shell">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .slot-table-row {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .slot-table-row:hover {
          background: linear-gradient(135deg, rgba(248, 250, 252, 0.8), rgba(241, 245, 249, 0.9)) !important;
          transform: translateX(4px);
          box-shadow: -4px 0 0 0 #3b82f6;
        }

        .filter-select {
          padding: 8px 12px;
          border-radius: 8px;
          border: 2px solid rgba(226, 232, 240, 0.8);
          background: rgba(255, 255, 255, 0.9);
          font-size: 13px;
          font-weight: 600;
          color: #0f172a;
          transition: all 0.2s ease;
        }

        .filter-select:hover {
          border-color: #3b82f6;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
        }

        .filter-select:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
      `}</style>

      <header style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        borderRadius: '16px',
        padding: '24px 32px',
        marginBottom: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        animation: 'fadeIn 0.5s ease-out',
        border: '2px solid rgba(226, 232, 240, 0.8)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ 
              fontSize: '28px', 
              fontWeight: '700', 
              color: '#0f172a',
              marginBottom: '8px',
              letterSpacing: '-0.02em'
            }}>
              Slot Compliance
            </h1>
            <p style={{ 
              fontSize: '14px', 
              color: '#64748b',
              fontWeight: '500'
            }}>
              Viewing {dateRangeStart} → {dateRangeEnd}
            </p>
          </div>
          <button 
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            style={{
              background: loading ? 'linear-gradient(135deg, #94a3b8 0%, #cbd5e1 100%)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 4px 12px rgba(59, 130, 246, 0.3)',
              transition: 'all 0.2s ease',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
              }
            }}
          >
            {loading ? 'Loading...' : 'Refresh Data'}
          </button>
        </div>
      </header>

      <section className="panel" style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        border: '2px solid rgba(226, 232, 240, 0.8)',
        animation: 'fadeIn 0.6s ease-out'
      }}>
        {error && (
          <div style={{
            background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
            color: '#991b1b',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '20px',
            fontWeight: '600',
            fontSize: '14px',
            border: '2px solid #fca5a5',
            boxShadow: '0 4px 12px rgba(220, 38, 38, 0.15)'
          }}>
            Error: {error}
          </div>
        )}
        {!error && !loading && slots.length === 0 && (
          <div style={{
            background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
            color: '#1e40af',
            padding: '16px 20px',
            borderRadius: '12px',
            marginBottom: '20px',
            fontWeight: '600',
            fontSize: '14px',
            border: '2px solid #93c5fd',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)'
          }}>
            No slots found for {dateRangeStart} → {dateRangeEnd}
          </div>
        )}
        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          alignItems: 'center', 
          marginBottom: '24px',
          flexWrap: 'wrap',
          padding: '16px',
          background: 'rgba(248, 250, 252, 0.6)',
          borderRadius: '12px',
          border: '2px solid rgba(226, 232, 240, 0.6)'
        }}>
          <div>
            <label style={{ 
              fontSize: '12px', 
              marginRight: '8px',
              color: '#64748b',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>Clinician</label>
            <select 
              className="filter-select"
              value={clinicianFilter} 
              onChange={(e) => setClinicianFilter(e.target.value)}
            >
              <option value="All">All</option>
              {[...new Set([...KELLY_NAMES, ...NURSE_NAMES])].map((n) => (
                <option value={n} key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ 
              fontSize: '12px', 
              marginRight: '8px',
              color: '#64748b',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>Slot type</label>
            <select 
              className="filter-select"
              value={slotTypeFilter} 
              onChange={(e) => setSlotTypeFilter(e.target.value)}
            >
              <option value="All">All</option>
              {[...new Set(fetchedRows.map((r) => (r['Slot Type'] || r.slot_type || '').toString().trim()).filter(Boolean))].map((t) => (
                <option value={t} key={t}>{t}</option>
              ))}
            </select>
          </div>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            padding: '8px 16px',
            background: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '8px',
            border: '2px solid rgba(226, 232, 240, 0.8)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontWeight: '600',
            fontSize: '13px',
            color: '#0f172a'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#3b82f6';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(226, 232, 240, 0.8)';
            e.currentTarget.style.boxShadow = 'none';
          }}>
            <input 
              type="checkbox" 
              checked={showOnlyViolations} 
              onChange={(e) => setShowOnlyViolations(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show only violations</span>
          </label>
          <details style={{ 
            marginLeft: 'auto',
            padding: '12px 16px',
            background: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '8px',
            border: '2px solid rgba(226, 232, 240, 0.8)'
          }}>
            <summary style={{ 
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '13px',
              color: '#0f172a',
              userSelect: 'none'
            }}>Warnings legend</summary>
            <ul style={{ 
              marginTop: '12px',
              paddingLeft: '24px',
              fontSize: '13px',
              lineHeight: '1.8',
              color: '#475569'
            }}>
              <li><strong style={{ color: '#0f172a' }}>Blood Clinic:</strong> At least 10 minutes. Should be run by Kelly (Amison or Mansell).</li>
              <li><strong style={{ color: '#0f172a' }}>ECG:</strong> At least 30 minutes. Should be run by Kelly (Amison or Mansell).</li>
              <li><strong style={{ color: '#0f172a' }}>Wound Check:</strong> At least 30 minutes. Performed by a nurse.</li>
              <li><strong style={{ color: '#0f172a' }}>Annual review (multiple):</strong> At least 45 minutes. Performed by a nurse.</li>
              <li><strong style={{ color: '#0f172a' }}>Hypertension annual review:</strong> At least 30 minutes. Should be run by Kelly (Amison or Mansell).</li>
              <li><strong style={{ color: '#0f172a' }}>Hypertension/CKD review:</strong> At least 30 minutes. Must be run by Kelly Mansell.</li>
              <li><strong style={{ color: '#0f172a' }}>Flu Clinic:</strong> Should be run by Kelly (Amison or Mansell).</li>
              <li><strong style={{ color: '#0f172a' }}>B12:</strong> At least 10 minutes. Should be performed by Kelly Amison.</li>
            </ul>
          </details>
        </div>
        <div style={{ overflowX: 'auto', marginTop: '20px' }}>
          <table style={{ 
            width: '100%', 
            borderCollapse: 'separate',
            borderSpacing: '0 4px'
          }}>
            <thead>
              <tr style={{
                background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
              }}>
                <th style={{ 
                  width: '140px', 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  borderRadius: '12px 0 0 12px',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'date') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('date'); setSortDir('asc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Date{sortBy === 'date' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ 
                  width: '140px', 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'time') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('time'); setSortDir('asc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Time{sortBy === 'time' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'clinician') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('clinician'); setSortDir('asc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Staff{sortBy === 'clinician' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'type') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('type'); setSortDir('asc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Slot Type{sortBy === 'type' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ 
                  width: '120px', 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'slotDuration') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('slotDuration'); setSortDir('asc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Duration{sortBy === 'slotDuration' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ 
                  width: '320px', 
                  cursor: 'pointer',
                  padding: '16px',
                  textAlign: 'left',
                  fontSize: '12px',
                  fontWeight: '800',
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                  color: '#0f172a',
                  borderRadius: '0 12px 12px 0',
                  userSelect: 'none',
                  transition: 'all 0.2s ease'
                }} 
                onClick={() => { if (sortBy === 'warnings') setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortBy('warnings'); setSortDir('desc'); } }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                }}>
                  Warning{sortBy === 'warnings' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, idx) => (
                <tr 
                  key={s.id} 
                  className="slot-table-row"
                  onClick={() => handleRowClick(s)}
                  style={{ 
                    cursor: s.warnings && s.warnings.length > 0 ? 'pointer' : 'default',
                    background: s.warnings && s.warnings.length > 0 
                      ? 'linear-gradient(135deg, rgba(254, 243, 199, 0.4) 0%, rgba(253, 230, 138, 0.3) 100%)'
                      : '#ffffff',
                    borderRadius: '12px',
                    animation: `fadeIn ${0.3 + idx * 0.02}s ease-out`,
                    boxShadow: s.warnings && s.warnings.length > 0 
                      ? '0 2px 8px rgba(245, 158, 11, 0.15)' 
                      : '0 1px 3px rgba(0, 0, 0, 0.05)'
                  }}
                >
                  <td style={{
                    padding: '16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#0f172a',
                    borderRadius: '12px 0 0 12px'
                  }}>{s.date}</td>
                  <td style={{
                    padding: '16px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#475569'
                  }}>{s.time}</td>
                  <td style={{ 
                    padding: '16px',
                    fontSize: '14px',
                    fontWeight: '800',
                    color: '#0f172a'
                  }}>{s.clinician}</td>
                  <td style={{ 
                    padding: '16px',
                    fontSize: '14px',
                    color: '#64748b',
                    fontWeight: '500'
                  }}>{s.type}</td>
                  <td style={{ 
                    padding: '16px',
                    fontSize: '14px',
                    color: '#64748b',
                    fontWeight: '600'
                  }}>{s.slotDuration ?? '—'}</td>
                  <td style={{
                    padding: '16px',
                    borderRadius: '0 12px 12px 0'
                  }}>
                    {s.warnings && s.warnings.length > 0 ? (
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px'
                      }}>
                        <WarningDot level="amber" />
                        <div style={{ 
                          fontWeight: '700', 
                          color: '#92400e',
                          fontSize: '14px'
                        }}>{s.warnings.join('; ')}</div>
                      </div>
                    ) : (
                      <div style={{ 
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 12px',
                        background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
                        borderRadius: '8px',
                        color: '#065f46', 
                        fontWeight: '800',
                        fontSize: '13px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>OK</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Alternative Slots Modal */}
      {selectedSlot && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={closeModal}
        >
          <div 
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '32px',
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
              border: '2px solid rgba(226, 232, 240, 0.8)',
              animation: 'fadeIn 0.3s ease-out'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-start', 
              marginBottom: '24px',
              paddingBottom: '20px',
              borderBottom: '2px solid rgba(226, 232, 240, 0.8)'
            }}>
              <div>
                <h2 style={{ 
                  margin: 0, 
                  marginBottom: '8px',
                  fontSize: '24px',
                  fontWeight: '800',
                  color: '#0f172a',
                  letterSpacing: '-0.02em'
                }}>Alternative Compliant Slots</h2>
                <div style={{ 
                  fontSize: '14px', 
                  color: '#64748b',
                  fontWeight: '500',
                  lineHeight: '1.6'
                }}>
                  Showing alternatives for <strong style={{ color: '#0f172a' }}>{selectedSlot.type}</strong> slot on{' '}
                  <strong style={{ color: '#0f172a' }}>{selectedSlot.date}</strong> at <strong style={{ color: '#0f172a' }}>{selectedSlot.time}</strong>
                </div>
              </div>
              <button 
                onClick={closeModal}
                style={{
                  border: 'none',
                  background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: 0,
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '12px',
                  fontWeight: '300',
                  color: '#475569',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                  e.currentTarget.style.color = '#ffffff';
                  e.currentTarget.style.transform = 'rotate(90deg)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)';
                  e.currentTarget.style.color = '#475569';
                  e.currentTarget.style.transform = 'rotate(0deg)';
                }}
              >
                ×
              </button>
            </div>

            <div style={{ 
              padding: '16px 20px', 
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              borderRadius: '12px', 
              marginBottom: '24px',
              borderLeft: '4px solid #f59e0b',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
            }}>
              <div style={{ 
                fontWeight: '800', 
                marginBottom: '8px',
                fontSize: '14px',
                color: '#92400e',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>Violations:</div>
              <ul style={{ 
                margin: 0, 
                paddingLeft: '24px',
                fontSize: '14px',
                lineHeight: '1.8',
                color: '#78350f',
                fontWeight: '600'
              }}>
                {selectedSlot.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>

            {loadingAlternatives ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 40px',
                fontSize: '16px',
                fontWeight: '600',
                color: '#64748b',
                animation: 'pulse 1.5s ease-in-out infinite'
              }}>Loading alternatives...</div>
            ) : alternativeSlots.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 40px', 
                color: '#64748b',
                fontSize: '15px',
                fontWeight: '600',
                background: 'rgba(248, 250, 252, 0.6)',
                borderRadius: '12px',
                border: '2px dashed rgba(226, 232, 240, 0.8)'
              }}>
                No alternative compliant slots found in the next {rangeDays} days.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'separate',
                  borderSpacing: '0 4px'
                }}>
                  <thead>
                    <tr style={{
                      background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
                    }}>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '16px',
                        fontWeight: '800',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        color: '#0f172a',
                        borderRadius: '12px 0 0 12px'
                      }}>Date</th>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '16px',
                        fontWeight: '800',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        color: '#0f172a'
                      }}>Time</th>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '16px',
                        fontWeight: '800',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        color: '#0f172a'
                      }}>Clinician</th>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '16px',
                        fontWeight: '800',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        color: '#0f172a'
                      }}>Duration</th>
                      <th style={{ 
                        textAlign: 'left', 
                        padding: '16px',
                        fontWeight: '800',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.8px',
                        color: '#0f172a',
                        borderRadius: '0 12px 12px 0'
                      }}>Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alternativeSlots.map((alt, idx) => (
                      <tr 
                        key={alt.id}
                        style={{ 
                          background: '#ffffff',
                          borderRadius: '12px',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          animation: `fadeIn ${0.3 + idx * 0.05}s ease-out`,
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                        }}
                        onMouseEnter={(e) => { 
                          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(248, 250, 252, 0.8), rgba(241, 245, 249, 0.9))';
                          e.currentTarget.style.transform = 'translateX(4px)';
                          e.currentTarget.style.boxShadow = '-4px 0 0 0 #10b981';
                        }}
                        onMouseLeave={(e) => { 
                          e.currentTarget.style.background = '#ffffff';
                          e.currentTarget.style.transform = 'translateX(0)';
                          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
                        }}
                      >
                        <td style={{ 
                          padding: '16px',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#0f172a',
                          borderRadius: '12px 0 0 12px'
                        }}>{alt.date}</td>
                        <td style={{ 
                          padding: '16px',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#475569'
                        }}>{alt.time}</td>
                        <td style={{ 
                          padding: '16px',
                          fontSize: '14px',
                          fontWeight: '800',
                          color: '#0f172a'
                        }}>{alt.clinician}</td>
                        <td style={{ 
                          padding: '16px',
                          fontSize: '14px',
                          fontWeight: '600',
                          color: '#64748b'
                        }}>{alt.slotDuration} min</td>
                        <td style={{ 
                          padding: '16px',
                          borderRadius: '0 12px 12px 0'
                        }}>
                          <span style={{ 
                            display: 'inline-flex',
                            padding: '6px 14px', 
                            background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
                            color: '#065f46',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '800',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            boxShadow: '0 2px 6px rgba(16, 185, 129, 0.15)'
                          }}>
                            {alt.availability}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ 
                  marginTop: '20px', 
                  fontSize: '14px', 
                  color: '#64748b',
                  fontWeight: '600',
                  padding: '12px 16px',
                  background: 'rgba(248, 250, 252, 0.6)',
                  borderRadius: '8px',
                  border: '2px solid rgba(226, 232, 240, 0.6)'
                }}>
                  Showing {alternativeSlots.length} available slot{alternativeSlots.length !== 1 ? 's' : ''} that meet the compliance rules.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
