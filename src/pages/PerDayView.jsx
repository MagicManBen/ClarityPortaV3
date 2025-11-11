import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { checkSlotCompliance } from '../lib/slotComplianceRules';

// Clinicians to exclude
const EXCLUDED_CLINICIANS = ['covid-19', 'nhs 111 (mr)', 'fed', 'gp (ms)', 'unknown'];

// Helper to format date as YYYY-MM-DD
const formatDateKey = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Parse date string (handles various formats)
const parseDate = (str) => {
  if (!str) return null;
  // Handle dd-MMM-yyyy format like "03-Nov-2025"
  const parts = str.match(/^(\d{1,2})-(\w{3})-(\d{4})$/);
  if (parts) {
    const monthMap = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    const day = parseInt(parts[1], 10);
    const month = monthMap[parts[2].toLowerCase()];
    const year = parseInt(parts[3], 10);
    if (month !== undefined) return new Date(year, month, day);
  }
  // Fallback: try native Date parse
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

// Extract surname from full name
const extractSurname = (fullName) => {
  if (!fullName) return '';
  let s = fullName.toString().trim();
  s = s.replace(/\(.*?\)/g, '').trim();
  s = s.replace(/\bDr\.?\b/gi, '').trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[0].trim();
  const parts = s.split(/\s+/);
  return parts.length ? parts[parts.length - 1].trim() : s;
};

// Color palette for clinicians (cycle through colors)
const CLINICIAN_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4'
];

// Slot type color mapping
const SLOT_TYPE_COLORS = {
  'book on the day': '#017F03',                    // rgb(1, 127, 3)
  'appointment within 1 week': '#01C328',          // rgb(1, 195, 40) - Within 1 Week (embargoed)
  'appointment 1 to 2 weeks': '#83FC0A',           // rgb(131, 252, 10) - 1–2 Weeks (embargoed)
  'baby imms': '#FEFB92',                          // rgb(254, 251, 146)
  'admin': '#C400BF',                              // rgb(196, 0, 191)
  'smear': '#C400BF',                              // Admin color for smear/meeting
  'meeting': '#C400BF',                            // Admin color for smear/meeting
  'annual review': '#FD7F0B',                      // rgb(253, 127, 11) - Annual Review (Multiple)
  'coffee break': '#7D511D',                       // rgb(125, 81, 29)
  'lunch break': '#B3B3B3',                        // rgb(179, 179, 179)
  'nhs health check': '#4282D4',                   // rgb(66, 130, 212)
  'minor ops clinic': '#244B7E',                   // rgb(36, 75, 126)
  'blood clinic': '#90BDD0',                       // rgb(144, 189, 208)
  'education': '#FE9392',                          // rgb(254, 147, 146)
  'wound check': '#EC1C23',                        // rgb(236, 28, 35)
  'reception queries': '#758C47',                  // rgb(117, 140, 71)
  'reception task appointment': '#758C47',         // Reception Queries color
  'clinical review': '#4282D4',                    // rgb(66, 130, 212) - same as NHS Health Check
  'catch up time': '#f3f4f6',                      // gray (keeping default)
  'telephone appointment slot': '#d1fae5',         // light green (keeping default)
  'emergency gps to book only': '#fee2e2',         // light red (keeping default)
  'comment': '#f3f4f6',                            // gray (keeping default)
  'other unavailable': '#f3f4f6'                   // gray (keeping default)
};

// Get background color for slot type
const getSlotColor = (slotType, availability) => {
  const type = (slotType || '').toLowerCase();
  // Check explicit mappings
  for (const [key, color] of Object.entries(SLOT_TYPE_COLORS)) {
    if (type.includes(key)) return color;
  }
  // Availability-based fallback
  const avail = (availability || '').toLowerCase();
  if (avail === 'booked') return '#dbeafe';
  if (avail === 'available') return '#d1fae5';
  if (avail === 'embargoed') return '#fef3c7';
  return '#f9fafb'; // default light gray
};

// Get status tag color based on status/availability
const getStatusColor = (status) => {
  const s = (status || '').toLowerCase();
  if (s.includes('booked') || s.includes('book')) return '#3b82f6'; // blue
  if (s.includes('available')) return '#10b981'; // green
  if (s.includes('dna') || s.includes('left') || s.includes('cancelled')) return '#ef4444'; // red
  if (s.includes('pending')) return '#f59e0b'; // amber
  return '#6b7280'; // gray
};

export default function PerDayView() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slots, setSlots] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [patientDetails, setPatientDetails] = useState(new Map());

  // Fetch slots and appointment details for the selected date
  useEffect(() => {
    const fetchSlots = async () => {
      setLoading(true);
      setError(null);
      try {
        // Format date to match CSV format: dd-MMM-yyyy (e.g., "03-Nov-2025")
        const day = String(selectedDate.getDate()).padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[selectedDate.getMonth()];
        const year = selectedDate.getFullYear();
        const dateKey = `${day}-${month}-${year}`;
        
        console.log('Fetching slots for date:', dateKey);
        
        // Fetch calendar slots
        const { data: calendarData, error: calErr } = await supabase
          .from('Apps_Calendar_Year')
          .select('*')
          .eq('Appointment Date', dateKey);
        
        if (calErr) throw calErr;
        setSlots(calendarData || []);
        
        // Fetch appointment details from pop_apps
        const { data: appsData, error: appsErr } = await supabase
          .from('pop_apps')
          .select('*')
          .eq('Appointment Date', dateKey);
        
        let patientCount = 0;
        
        if (appsErr) {
          console.warn('Failed to fetch appointments:', appsErr);
          setAppointments([]);
        } else {
          setAppointments(appsData || []);
          
          // Extract unique EMIS numbers from booked appointments
          const emisNumbers = new Set();
          (appsData || []).forEach(app => {
            const emisNum = app['Patient Details EMIS Number'];
            if (emisNum) emisNumbers.add(emisNum);
          });
          
          patientCount = emisNumbers.size;
          
          // Fetch patient details for all EMIS numbers
          if (emisNumbers.size > 0) {
            const { data: patientsData, error: patientsErr } = await supabase
              .from('Pop_Pt_Details')
              .select('*')
              .in('EMIS Number', Array.from(emisNumbers));
            
            if (patientsErr) {
              console.warn('Failed to fetch patient details:', patientsErr);
            } else {
              // Build a map of EMIS Number -> Patient Details
              const patientMap = new Map();
              (patientsData || []).forEach(patient => {
                patientMap.set(patient['EMIS Number'], patient);
              });
              setPatientDetails(patientMap);
            }
          }
        }
        
        console.log('Query result for', dateKey, ':', { 
          slots: calendarData?.length || 0, 
          appointments: appsData?.length || 0,
          patients: patientCount 
        });
        
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError(err.message || 'Failed to load data');
        setSlots([]);
        setAppointments([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [selectedDate]);

  // Process and organize slots by clinician, enriched with appointment data
  const clinicianData = useMemo(() => {
    // Filter out excluded clinicians
    const filtered = slots.filter(slot => {
      const name = (slot['Full Name of the Session Holder of the Session'] || '').toLowerCase();
      return !EXCLUDED_CLINICIANS.some(exc => name.includes(exc));
    });

    // Create a lookup map for appointments by Slot ID
    const appointmentMap = new Map();
    appointments.forEach(app => {
      const slotId = app['Slot ID'];
      if (slotId) {
        appointmentMap.set(slotId, app);
      }
    });
    
    // Also create a lookup by time + clinician name (fallback)
    const appointmentByTimeMap = new Map();
    appointments.forEach(app => {
      const time = app['Appointment Time'];
      const clinician = app['Session Holders Full Name'];
      if (time && clinician) {
        const key = `${time}|${clinician}`;
        appointmentByTimeMap.set(key, app);
      }
    });
    
    console.log('Appointment map size:', appointmentMap.size, 'Time-based map:', appointmentByTimeMap.size);
    if (appointmentMap.size > 0) {
      console.log('Sample appointment:', Array.from(appointmentMap.entries())[0]);
    }

    // Group by clinician and enrich with appointment data
    const byClinicianMap = new Map();
    filtered.forEach(slot => {
      const name = slot['Full Name of the Session Holder of the Session'];
      // Only include if name contains "Dr" (case-insensitive)
      if (name && /\bdr\b/i.test(name)) {
        if (!byClinicianMap.has(name)) {
          byClinicianMap.set(name, []);
        }
        
        // Enrich slot with appointment data if available
        const slotId = slot['Slot ID'];
        let appointment = slotId ? appointmentMap.get(slotId) : null;
        
        // Fallback: try matching by time + clinician name
        if (!appointment) {
          const time = slot['Appointment Time'];
          const key = `${time}|${name}`;
          appointment = appointmentByTimeMap.get(key);
        }
        
        // Debug first slot
        if (byClinicianMap.get(name).length === 0 && slotId) {
          console.log('First slot for', name, ':', {
            slotId,
            time: slot['Appointment Time'],
            hasAppointment: !!appointment,
            availability: slot['Availability'],
            matchMethod: appointment ? (appointmentMap.has(slotId) ? 'slotId' : 'time+name') : 'none'
          });
        }
        
        byClinicianMap.get(name).push({
          ...slot,
          appointment: appointment || null
        });
      }
    });

    // Sort each clinician's slots by time
    const result = [];
    byClinicianMap.forEach((slotsForClinician, clinicianName) => {
      const sorted = slotsForClinician.sort((a, b) => {
        const timeA = a['Appointment Time'] || '';
        const timeB = b['Appointment Time'] || '';
        return timeA.localeCompare(timeB);
      });
      result.push({ name: clinicianName, slots: sorted });
    });

    // Sort clinicians by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }, [slots, appointments]);

  // Date navigation
  const goPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const goNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const dateLabel = selectedDate.toLocaleDateString('en-GB', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`
        @keyframes pulseRed {
          0%, 100% {
            background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
            border-color: #ef4444;
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7), 0 4px 12px rgba(239, 68, 68, 0.3);
          }
          50% {
            background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
            border-color: #dc2626;
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0), 0 8px 20px rgba(239, 68, 68, 0.4);
          }
        }
        
        .violation-slot {
          animation: pulseRed 2s ease-in-out infinite;
        }
      `}</style>
      {/* Date picker and navigation */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 12,
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.85)',
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.06)'
      }}>
        <button 
          onClick={goPrevDay}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: 'white',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          ◀ Prev
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 16 }}>
          {dateLabel}
        </div>
        <button 
          onClick={goNextDay}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: 'white',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Next ▶
        </button>
      </div>

      {/* Loading / Error states */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 24, color: '#6b7280' }}>
          Loading slots...
        </div>
      )}

      {error && (
        <div style={{ 
          padding: 16, 
          background: '#fef2f2', 
          border: '1px solid #fecaca',
          borderRadius: 8,
          color: '#991b1b'
        }}>
          Error: {error}
        </div>
      )}

      {/* Grid */}
      {!loading && !error && clinicianData.length === 0 && (
        <div style={{ 
          textAlign: 'center', 
          padding: 24, 
          color: '#6b7280',
          background: 'rgba(255, 255, 255, 0.85)',
          borderRadius: 8
        }}>
          No slots found for this date
        </div>
      )}

      {!loading && !error && clinicianData.length > 0 && (
        <div style={{ 
          overflowX: 'auto',
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.08)',
          padding: 20
        }}>
          {/* Column-based layout - each clinician gets a column */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${clinicianData.length}, 1fr)`,
            gap: 16,
            minWidth: '100%'
          }}>
            {clinicianData.map((clinicianInfo, idx) => {
              const surname = extractSurname(clinicianInfo.name);
              const headerColor = CLINICIAN_COLORS[idx % CLINICIAN_COLORS.length];
              
              return (
                <div key={clinicianInfo.name} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                  overflow: 'hidden',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                  transition: 'all 0.3s'
                }}>
                  {/* Clinician header */}
                  <div style={{
                    background: headerColor,
                    color: 'white',
                    padding: '14px 12px',
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: 'center',
                    borderBottom: '2px solid rgba(0,0,0,0.1)'
                  }}>
                    Dr {surname.toUpperCase()}
                  </div>
                  
                  {/* Slots stacked vertically */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#ffffff',
                    padding: 8,
                    gap: 0
                  }}>
                    {clinicianInfo.slots.length === 0 ? (
                      <div style={{
                        padding: 16,
                        textAlign: 'center',
                        color: '#9ca3af',
                        fontSize: 12
                      }}>
                        No slots
                      </div>
                    ) : (
                      clinicianInfo.slots.map((slot, slotIdx) => {
                        const time = slot['Appointment Time'] || '';
                        const duration = parseInt(slot['Slot Duration'], 10) || 0;
                        const slotType = slot['Slot Type'] || '';
                        const availability = slot['Availability'] || '';
                        const bgColor = getSlotColor(slotType, availability);
                        
                        // Get appointment and patient details
                        const appointment = slot.appointment;
                        const emisNumber = appointment ? appointment['Patient Details EMIS Number'] : null;
                        const patient = emisNumber ? patientDetails.get(emisNumber) : null;
                        const appointmentReason = appointment ? appointment['Appointment Reason'] : null;
                        const currentStatus = appointment ? appointment['Current Slot Status'] : null;
                        
                        // Check if slot is booked
                        const isBooked = availability?.toLowerCase() === 'booked' || currentStatus?.toLowerCase() === 'booked';
                        
                        // Check for compliance violations
                        const violations = checkSlotCompliance({
                          type: slotType,
                          clinician: clinicianInfo.name,
                          slotDuration: duration,
                          'Full Name of the Session Holder of the Session': clinicianInfo.name,
                          'Slot Type': slotType,
                          'Slot Duration': duration
                        });
                        const hasViolations = violations.length > 0;
                        
                        // Debug logging
                        if (isBooked && slotIdx === 0) {
                          console.log('Booked slot debug:', {
                            time,
                            slotType,
                            availability,
                            hasAppointment: !!appointment,
                            emisNumber,
                            hasPatient: !!patient,
                            patientName: patient?.['Full Name'],
                            appointmentReason,
                            currentStatus
                          });
                        }
                        
                        // Calculate end time
                        let endTime = '';
                        if (time && duration) {
                          const [h, m] = time.split(':').map(n => parseInt(n, 10));
                          const totalMinutes = h * 60 + m + duration;
                          const endH = Math.floor(totalMinutes / 60);
                          const endM = totalMinutes % 60;
                          endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                        }
                        
                        return (
                          <div
                            key={slotIdx}
                            className={hasViolations ? 'violation-slot' : ''}
                            style={{
                              background: hasViolations ? 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)' : 'white',
                              border: hasViolations ? '2px solid #ef4444' : '1px solid rgba(0,0,0,0.12)',
                              borderRadius: 6,
                              margin: '0 5px 14px 5px',
                              fontSize: 12,
                              lineHeight: 1.4,
                              transition: 'all 0.2s',
                              cursor: hasViolations ? 'help' : 'default',
                              boxShadow: hasViolations ? '0 4px 12px rgba(239, 68, 68, 0.3)' : '0 1px 2px rgba(0,0,0,0.08)',
                              display: 'flex',
                              flexDirection: 'column',
                              position: 'relative',
                              overflow: 'hidden',
                              minHeight: 100
                            }}
                            onMouseEnter={(e) => {
                              if (!hasViolations) {
                                e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!hasViolations) {
                                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
                                e.currentTarget.style.transform = 'translateY(0)';
                              }
                            }}
                            title={hasViolations ? `⚠️ COMPLIANCE VIOLATION:\n${violations.join('\n')}\n\n${time} - ${endTime}\n${slotType}\n${availability}\n${duration} min${patient ? '\n' + patient['Full Name'] : ''}` : `${time} - ${endTime}\n${slotType}\n${availability}\n${duration} min${patient ? '\n' + patient['Full Name'] : ''}`}
                          >
                            {/* Status tag - top right corner */}
                            <div style={{
                              position: 'absolute',
                              top: 0,
                              right: 0,
                              background: getStatusColor(currentStatus || availability),
                              color: 'white',
                              padding: '4px 10px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderBottomLeftRadius: 4,
                              letterSpacing: '0px'
                            }}>
                              {currentStatus || availability}
                            </div>
                            
                            {/* Time header - narrow bar at top */}
                            <div style={{
                              background: bgColor,
                              borderBottom: '1px solid rgba(0,0,0,0.12)',
                              padding: '8px 12px',
                              fontWeight: 700,
                              fontSize: 14,
                              color: '#1f2937'
                            }}>
                              {time} {endTime && `- ${endTime}`}
                            </div>
                            
                            {/* Main content body */}
                            <div style={{
                              padding: '10px 12px',
                              flex: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 5
                            }}>
                              {/* Slot type */}
                              <div style={{ 
                                fontWeight: 600, 
                                fontSize: 12,
                                color: '#374151',
                                lineHeight: 1.3
                              }}>
                                {slotType}
                              </div>
                              
                              {/* Patient details (if booked) */}
                              {isBooked && patient && (
                                <div style={{
                                  fontWeight: 700,
                                  fontSize: 12,
                                  color: '#1f2937',
                                  lineHeight: 1.3
                                }}>
                                  {patient['Full Name']}
                                </div>
                              )}
                              
                              {appointmentReason && (
                                <div style={{ 
                                  color: '#6b7280', 
                                  fontSize: 11,
                                  fontStyle: 'italic',
                                  lineHeight: 1.35
                                }}>
                                  {appointmentReason}
                                </div>
                              )}
                              
                              {isBooked && !patient && (
                                <div style={{
                                  color: '#9ca3af',
                                  fontSize: 11,
                                  fontStyle: 'italic'
                                }}>
                                  (No patient data)
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
