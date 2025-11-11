import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function LiveView() {
  const [activeTab, setActiveTab] = useState('calls'); // 'calls' or 'appointments'
  const [completedCalls, setCompletedCalls] = useState([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [currentCalls, setCurrentCalls] = useState([]);
  const [queueingCalls, setQueueingCalls] = useState([]);
  const [seenQueueCallIds, setSeenQueueCallIds] = useState(new Set()); // Track which calls we've already seen
  const [seenCurrentCallIds, setSeenCurrentCallIds] = useState(new Set()); // Track seen current calls
  const [callStartTimes, setCallStartTimes] = useState({}); // Store when each call started talking

  // Helper function to convert phone number format
  function normalizePhoneNumber(phone) {
    if (!phone) return null;
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    // Replace +44 with 0
    if (cleaned.startsWith('+44')) {
      cleaned = '0' + cleaned.substring(3);
    } else if (cleaned.startsWith('44') && cleaned.length > 10) {
      cleaned = '0' + cleaned.substring(2);
    }
    return cleaned;
  }

  // Lookup patient by phone number with proper priority
  async function lookupPatientByPhone(phoneNumber) {
    if (!phoneNumber) return null;
    
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) return null;

    console.log('Looking up phone:', phoneNumber, '→ normalized:', normalizedPhone);

    try {
      // First check mobile
      let { data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Mobile Telephone', normalizedPhone)
        .limit(1);

      if (patients && patients.length > 0) {
        console.log('Found patient by mobile:', patients[0]['Full Name']);
        return patients[0];
      }

      // Then check home phone
      ({ data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Home Telephone', normalizedPhone)
        .limit(1));

      if (patients && patients.length > 0) {
        console.log('Found patient by home:', patients[0]['Full Name']);
        return patients[0];
      }

      // Finally check work phone
      ({ data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Work Telephone', normalizedPhone)
        .limit(1));

      if (patients && patients.length > 0) {
        console.log('Found patient by work:', patients[0]['Full Name']);
        return patients[0];
      }

      console.log('No patient found for phone:', normalizedPhone);
      return null;
    } catch (err) {
      console.error('Error looking up patient:', err);
      return null;
    }
  }

  // Calculate wait time in human-readable format
  function formatWaitTime(seconds) {
    if (!seconds || seconds === 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  // Fetch completed calls from call_logs_allfields
  async function fetchCompletedCalls() {
    try {
      // Get today's completed calls with correct filters
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const { data: calls, error } = await supabase
        .from('call_logs_allfields')
        .select('*')
        .eq('is_internal', false)
        .gt('talk_sec', 1)
        .gte('started_at', todayStr)
        .order('ended_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching completed calls:', error);
        return;
      }

      // Enrich with patient data
      const enrichedCalls = await Promise.all(
        (calls || []).map(async (call) => {
          // For INBOUND calls, caller_number is the patient
          // For OUTBOUND calls, dialled_number is the patient
          const patientPhone = call.direction === 'INBOUND' ? call.caller_number : call.dialled_number;
          console.log('Processing call:', call.id, 'direction:', call.direction, 'patientPhone:', patientPhone);
          
          let patientData = null;
          
          if (patientPhone) {
            patientData = await lookupPatientByPhone(patientPhone);
          }

          return {
            id: call.id,
            patientName: patientData?.['Full Name'] || 'Unknown Caller',
            gender: patientData?.['Gender'] || null,
            phoneNumber: patientPhone || 'Unknown',
            queueDuration: call.queue_sec || 0,
            talkDuration: call.talk_sec || 0,
            agentName: call.agent_user_name || 'Unknown Agent',
            reasonForCall: call.reason_for_call || 'Not recorded',
            outcomeSummary: call.outcome_summary || 'Not recorded',
            dialledName: call.dialled_name || 'Main Line',
            direction: call.direction,
            startedAt: call.started_at,
            endedAt: call.ended_at
          };
        })
      );

      // Only update state if the data has actually changed
      setCompletedCalls((prevCalls) => {
        const prevIds = prevCalls.map(c => c.id).sort().join(',');
        const newIds = enrichedCalls.map(c => c.id).sort().join(',');
        
        // If call IDs haven't changed, keep the old state to prevent re-render
        if (prevIds === newIds && prevCalls.length === enrichedCalls.length) {
          return prevCalls;
        }
        
        return enrichedCalls;
      });
    } catch (err) {
      console.error('Error fetching completed calls:', err);
    }
  }

  // Fetch currently active answered calls from live_calls and enrich with patient data
  async function fetchCurrentCalls() {
    try {
      const { data, error } = await supabase
        .from('live_calls')
        .select('*')
        .eq('status', 'answered')
        .order('last_seen', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching current live calls:', error);
        return;
      }

      const enriched = await Promise.all((data || []).map(async (c) => {
        // Try a few possible phone fields, fall back gracefully
        const phone = c.phone_number || c.caller_number || c.caller || null;
        let patient = null;
        if (phone) {
          try {
            patient = await lookupPatientByPhone(phone);
          } catch (e) {
            // Lookup failures should not break UI
            console.warn('Patient lookup failed for current call', phone, e);
          }
        }

        const callId = c.id || c.call_id || `${c.agent_name || 'agent'}-${phone || 'unknown'}-${Math.random()}`;

        return {
          id: callId,
          patientName: (patient && (patient['Full Name'] || patient['Full Name'] === 0) ? patient['Full Name'] : (c.callerName || c.caller_name || 'Unknown Caller')),
          phoneNumber: phone || 'Unknown',
          agentName: c.agent_name || c.agent || 'Unknown Agent',
          startedAt: c.start_time || c.started_at || c.start || c.last_seen || null,
          lastSeen: c.last_seen || null,
          raw: c
        };
      }));

      // Only update state if the data has actually changed
      setCurrentCalls((prevCalls) => {
        const prevIds = prevCalls.map(c => c.id).sort().join(',');
        const newIds = enriched.map(c => c.id).sort().join(',');
        
        // Track new call IDs and store their start times - do this BEFORE the early return
        enriched.forEach(call => {
          setSeenCurrentCallIds(prev => new Set(prev).add(call.id));
          
          // If it's a new call, record its start time
          setCallStartTimes(times => {
            if (!times[call.id]) {
              return { ...times, [call.id]: Date.now() };
            }
            return times; // Keep existing start time
          });
        });
        
        // If call IDs haven't changed, keep the old state to prevent re-render
        if (prevIds === newIds && prevCalls.length === enriched.length) {
          return prevCalls;
        }

        return enriched;
      });
    } catch (err) {
      console.error('Exception fetching current calls:', err);
    }
  }

  // Fetch patient history tags for a queueing call
  async function fetchPatientHistoryTags(patient, phone) {
    const tags = [];
    const now = new Date();

    if (!patient) return tags;

    const emisNumber = patient['Patient Details EMIS Number'];

    try {
      // 1. Recent calls count (last 30 days)
      if (phone) {
        let searchNumber = phone.replace(/[\s\-\(\)]/g, '');
        if (searchNumber.startsWith('+44')) {
          searchNumber = '0' + searchNumber.substring(3);
        }

        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: recentCalls } = await supabase
          .from('call_logs_allfields')
          .select('id, started_at')
          .or(`caller_number.eq.${searchNumber},caller_number.eq.${phone}`)
          .gte('started_at', thirtyDaysAgo.toISOString())
          .gt('talk_sec', 5);

        if (recentCalls && recentCalls.length >= 2) {
          tags.push({
            type: 'calls',
            text: `${recentCalls.length} calls in 30 days`,
            icon: '📞',
            color: '#8b5cf6'
          });
        }
      }

      // 2. Last appointment (within 30 days)
      if (emisNumber) {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: appointments } = await supabase
          .from('pop_apps')
          .select('"Appointment Date", "Appointment Time", "Staff Member Name"')
          .eq("Patient Details EMIS Number", String(emisNumber))
          .order('Appointment Date', { ascending: false })
          .limit(5);

        if (appointments && appointments.length > 0) {
          // Parse dates and find most recent
          for (const apt of appointments) {
            const dateStr = apt['Appointment Date'];
            if (dateStr) {
              try {
                const [day, monthStr, year] = dateStr.split('-');
                const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
                const month = months[monthStr];
                const aptDate = new Date(parseInt(year), month, parseInt(day));
                
                if (aptDate >= thirtyDaysAgo && aptDate <= now) {
                  const staffName = apt['Staff Member Name'] || 'Unknown';
                  const daysAgo = Math.floor((now - aptDate) / (1000 * 60 * 60 * 24));
                  tags.push({
                    type: 'appointment',
                    text: daysAgo === 0 ? `Saw ${staffName} today` : `Saw ${staffName} ${daysAgo}d ago`,
                    icon: '🩺',
                    color: '#06b6d4'
                  });
                  break;
                }
              } catch (e) {
                // Skip invalid dates
              }
            }
          }
        }
      }

      // 3. Last prescription (within 40 days)
      if (emisNumber) {
        const fortyDaysAgo = new Date(now);
        fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

        const { data: medications } = await supabase
          .from('pop_med_requests')
          .select('"Medication Requests Request Date"')
          .eq("Patient Details EMIS Number", String(emisNumber))
          .order('Medication Requests Request Date', { ascending: false })
          .limit(1);

        if (medications && medications.length > 0) {
          const dateStr = medications[0]['Medication Requests Request Date'];
          if (dateStr) {
            try {
              const medDate = new Date(dateStr);
              if (medDate >= fortyDaysAgo && medDate <= now) {
                const daysAgo = Math.floor((now - medDate) / (1000 * 60 * 60 * 24));
                tags.push({
                  type: 'prescription',
                  text: daysAgo === 0 ? 'Rx issued today' : `Rx ${daysAgo}d ago`,
                  icon: '💊',
                  color: '#10b981'
                });
              }
            } catch (e) {
              // Skip invalid dates
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching patient history tags:', err);
    }

    return tags;
  }

  // Check if caller has called at 8am (count consecutive days including today)
  async function check8amCaller(phone) {
    if (!phone) return null;

    try {
      // Normalize phone number
      let searchNumber = phone.replace(/[\s\-\(\)]/g, '');
      if (searchNumber.startsWith('+44')) {
        searchNumber = '0' + searchNumber.substring(3);
      }

      // Check last 14 days for 8am calls (between 8:00 and 8:15) including today
      const now = new Date();
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const { data: calls } = await supabase
        .from('call_logs_allfields')
        .select('started_at')
        .or(`caller_number.eq.${searchNumber},caller_number.eq.${phone}`)
        .gte('started_at', fourteenDaysAgo.toISOString())
        .order('started_at', { ascending: false });

      if (!calls || calls.length === 0) return null;

      // Check which calls were between 8:00 and 8:15
      const eightAmCalls = calls.filter(call => {
        if (!call.started_at) return false;
        const callDate = new Date(call.started_at);
        const hour = callDate.getHours();
        const minute = callDate.getMinutes();
        return hour === 8 && minute >= 0 && minute <= 15;
      });

      if (eightAmCalls.length === 0) return null;

      // Group calls by date
      const callsByDate = {};
      eightAmCalls.forEach(call => {
        const callDate = new Date(call.started_at);
        const dateKey = `${callDate.getFullYear()}-${String(callDate.getMonth() + 1).padStart(2, '0')}-${String(callDate.getDate()).padStart(2, '0')}`;
        if (!callsByDate[dateKey]) {
          callsByDate[dateKey] = [];
        }
        callsByDate[dateKey].push(call.started_at);
      });

      // Check for consecutive days starting from today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let consecutiveDays = 0;
      const consecutiveDates = [];
      
      for (let i = 0; i < 14; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        const dateKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        
        if (callsByDate[dateKey]) {
          consecutiveDays++;
          consecutiveDates.push({
            date: dateKey,
            times: callsByDate[dateKey]
          });
        } else {
          // Break on first day without an 8am call
          break;
        }
      }

      if (consecutiveDays === 0) return null;

      return {
        consecutiveDays: consecutiveDays,
        dates: consecutiveDates
      };
    } catch (err) {
      console.warn('Error checking 8am calls:', err);
      return null;
    }
  }

  // Fetch queueing calls from live_calls and enrich with patient data
  async function fetchQueueingCalls() {
    try {
      const { data, error } = await supabase
        .from('live_calls')
        .select('*')
        .eq('status', 'ringing')
        .order('queue_wait_seconds', { ascending: false }) // Longest waiting first
        .limit(100); // Fetch more than we need to show total count

      if (error) {
        console.error('Error fetching queueing calls:', error);
        return;
      }

      const enriched = await Promise.all((data || []).map(async (c) => {
        // For inbound: use phone_number
        // For outbound: extract from extra.dialled_label
        let phone = c.phone_number || c.caller_number || c.caller || null;
        
        // If no phone and it's outbound, try to extract from extra.dialled_label
        if (!phone && c.direction === 'outbound' && c.extra) {
          const extra = typeof c.extra === 'string' ? JSON.parse(c.extra) : c.extra;
          if (extra.dialled_label) {
            // Extract phone number from format like "07551 190345" or "01782 212066 [Main Line]"
            const match = extra.dialled_label.match(/[\d\s]+/);
            if (match) {
              phone = match[0].replace(/\s/g, '');
            }
          }
        }
        
        let patient = null;
        if (phone) {
          try {
            patient = await lookupPatientByPhone(phone);
          } catch (e) {
            console.warn('Patient lookup failed for queueing call', phone, e);
          }
        }

        // Parse queue_name from extra JSONB if available
        let queueName = 'Unknown Queue';
        if (c.extra) {
          const extra = typeof c.extra === 'string' ? JSON.parse(c.extra) : c.extra;
          if (extra.queue_name) {
            queueName = extra.queue_name;
          }
        }

        // Fetch patient history tags
        const tags = await fetchPatientHistoryTags(patient, phone);

        // Check for 8am caller badge
        const eightAmInfo = await check8amCaller(phone);

        const callId = c.id || c.call_id || `queue-${phone || 'unknown'}-${Math.random()}`;

        return {
          id: callId,
          patientName: (patient && (patient['Full Name'] || patient['Full Name'] === 0) ? patient['Full Name'] : 'Unknown Caller'),
          phoneNumber: phone || 'Unknown',
          queueName: queueName,
          queueWaitSeconds: c.queue_wait_seconds || 0,
          startedAt: c.start_time || c.started_at || null,
          lastSeen: c.last_seen || null,
          tags: tags,
          eightAmBadge: eightAmInfo,
          raw: c
        };
      }));

      // Only update state if the data has actually changed
      setQueueingCalls((prevCalls) => {
        const prevIds = prevCalls.map(c => c.id).sort().join(',');
        const newIds = enriched.map(c => c.id).sort().join(',');
        
        // If call IDs haven't changed, keep the old state to prevent re-render
        if (prevIds === newIds && prevCalls.length === enriched.length) {
          return prevCalls;
        }
        
        // Update the seen call IDs - add new ones and remove old ones
        setSeenQueueCallIds(prev => {
          const newSet = new Set();
          enriched.forEach(call => {
            // Keep the call ID if it was already seen OR if it's in the current list
            if (prev.has(call.id)) {
              newSet.add(call.id);
            }
          });
          // Add current call IDs to the set
          enriched.forEach(call => newSet.add(call.id));
          return newSet;
        });

        return enriched;
      });
    } catch (err) {
      console.error('Exception fetching queueing calls:', err);
    }
  }

  // Smooth per-second re-render so wait timers feel live
  useEffect(() => {
    if (activeTab !== 'calls') return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeTab]);

  // Poll for completed calls every 10 seconds
  useEffect(() => {
    if (activeTab === 'calls') {
      fetchCompletedCalls();
      const interval = setInterval(fetchCompletedCalls, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Poll for current (answered) live calls every 5 seconds
  useEffect(() => {
    if (activeTab === 'calls') {
      fetchCurrentCalls();
      const interval = setInterval(fetchCurrentCalls, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Poll for queueing calls every 5 seconds
  useEffect(() => {
    if (activeTab === 'calls') {
      fetchQueueingCalls();
      const interval = setInterval(fetchQueueingCalls, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  return (
    <div style={{ 
      padding: '8px 16px', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      {/* Header */}
      <div style={{ 
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '10px 24px', 
        borderRadius: '12px', 
        marginBottom: '0px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ 
          margin: 0, 
          fontSize: '18px', 
          fontWeight: 600, 
          color: '#1f2937',
          letterSpacing: '-0.02em'
        }}>Live View</h1>
      </div>

      {/* Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '8px',
        padding: '12px 24px',
        borderBottom: '1px solid #e5e7eb'
      }}>
        <button
          onClick={() => setActiveTab('calls')}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'calls' ? 'linear-gradient(135deg, #ff8c42 0%, #ff7a1f 100%)' : '#f3f4f6',
            color: activeTab === 'calls' ? 'white' : '#6b7280',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: activeTab === 'calls' ? '0 2px 4px 0 rgba(255, 140, 66, 0.2)' : 'none'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'calls') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'calls') {
              e.currentTarget.style.background = '#f3f4f6';
            }
          }}
        >
          📞 Calls
        </button>
        <button
          onClick={() => setActiveTab('appointments')}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'appointments' ? 'linear-gradient(135deg, #ff8c42 0%, #ff7a1f 100%)' : '#f3f4f6',
            color: activeTab === 'appointments' ? 'white' : '#6b7280',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: activeTab === 'appointments' ? '0 2px 4px 0 rgba(255, 140, 66, 0.2)' : 'none'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'appointments') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'appointments') {
              e.currentTarget.style.background = '#f3f4f6';
            }
          }}
        >
          📅 Appointments
        </button>
        <button
          onClick={() => setActiveTab('api-testing')}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '8px',
            border: 'none',
            background: activeTab === 'api-testing' ? 'linear-gradient(135deg, #ff8c42 0%, #ff7a1f 100%)' : '#f3f4f6',
            color: activeTab === 'api-testing' ? 'white' : '#6b7280',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: activeTab === 'api-testing' ? '0 2px 4px 0 rgba(255, 140, 66, 0.2)' : 'none'
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'api-testing') {
              e.currentTarget.style.background = '#e5e7eb';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'api-testing') {
              e.currentTarget.style.background = '#f3f4f6';
            }
          }}
        >
          🧪 API testing
        </button>
      </div>

      {/* Content Area */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '24px',
        maxWidth: '1800px',
        margin: '0 auto',
        width: '100%'
      }}>
        {activeTab === 'calls' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '20px',
            alignItems: 'start',
            maxWidth: '100%'
          }}>
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
              @keyframes fadeSlideUp {
                from {
                  opacity: 0;
                  transform: translateY(20px) scale(0.95);
                }
                to {
                  opacity: 1;
                  transform: translateY(0) scale(1);
                }
              }
              @keyframes pulseGlow {
                0%, 100% { 
                  opacity: 1;
                  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
                }
                50% { 
                  opacity: 0.8;
                  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.5);
                }
              }
              @keyframes tagFloat {
                0%, 100% {
                  transform: translateY(0px) rotate(-2deg);
                }
                50% {
                  transform: translateY(-3px) rotate(2deg);
                }
              }
              @keyframes tagShine {
                0% {
                  background-position: -100% 0;
                }
                100% {
                  background-position: 200% 0;
                }
              }
            `}</style>

            {/* Queueing Card */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '800px'
            }}>
              <h3 style={{ 
                margin: '0 0 16px 0', 
                fontSize: '16px',
                fontWeight: 600,
                color: '#1f2937',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⏳</span>
                <span>Queueing</span>
                {queueingCalls.length > 0 && (
                  <span style={{
                    background: '#ef4444',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    {queueingCalls.length}
                  </span>
                )}
              </h3>
              
              <div style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {queueingCalls.length === 0 && (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9ca3af',
                    fontSize: '14px',
                    textAlign: 'center',
                    padding: '40px 20px'
                  }}>
                    No calls in queue
                  </div>
                )}

                {queueingCalls.length > 0 && queueingCalls.slice(0, 5).map((call, index) => {
                  // Use queue_wait_seconds from the database, converting to minutes
                  const queueSeconds = call.queueWaitSeconds || 0;
                  const queueMinutes = Math.floor(queueSeconds / 60);
                  const remainingSeconds = queueSeconds % 60;
                  const waitTimeDisplay = queueMinutes > 0 ? `${queueMinutes}m ${remainingSeconds}s` : `${queueSeconds}s`;

                  // Check if this is a new call (not previously seen)
                  const isNewCall = !seenQueueCallIds.has(call.id);

                  return (
                    <div
                      key={call.id || index}
                      style={{
                        background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
                        padding: '16px',
                        borderRadius: '12px',
                        border: '1px solid #fecaca',
                        boxShadow: '0 2px 8px rgba(239, 68, 68, 0.15)',
                        animation: isNewCall 
                          ? `fadeSlideUp 0.5s ease-out, pulseGlow 2s ease-in-out infinite`
                          : 'pulseGlow 2s ease-in-out infinite',
                        animationDelay: isNewCall ? `${index * 0.04}s` : '0s',
                        animationFillMode: 'backwards',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '3px',
                        background: 'linear-gradient(90deg, #ef4444, #dc2626)',
                        borderRadius: '12px 12px 0 0'
                      }} />

                      {/* 8am Caller Badge - Top Right */}
                      {call.eightAmBadge && (
                        <div 
                          title={call.eightAmBadge.dates.map(d => {
                            const times = d.times.map(t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })).join(', ');
                            return `${d.date}: ${times}`;
                          }).join('\n')}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
                            color: 'white',
                            padding: '5px 10px',
                            borderRadius: '8px',
                            fontSize: '11px',
                            fontWeight: 700,
                            boxShadow: '0 2px 6px rgba(220, 38, 38, 0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            zIndex: 10,
                            border: '1.5px solid rgba(255, 255, 255, 0.3)',
                            cursor: 'help'
                          }}
                        >
                          <span>⚠️</span>
                          <span>8am Caller - Past {call.eightAmBadge.consecutiveDays} {call.eightAmBadge.consecutiveDays === 1 ? 'day' : 'days'}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#7f1d1d' }}>{call.patientName}</div>
                          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>📱 {call.phoneNumber}</div>
                        </div>

                        <div style={{ fontSize: '11px', color: '#dc2626', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <span>⏱️ Waiting: {waitTimeDisplay}</span>
                          <span>📞 {call.queueName}</span>
                        </div>

                        {/* Patient History Tags */}
                        {call.tags && call.tags.length > 0 && (
                          <div style={{ 
                            display: 'flex', 
                            gap: '6px', 
                            flexWrap: 'wrap',
                            marginTop: '4px'
                          }}>
                            {call.tags.map((tag, tagIndex) => (
                              <div
                                key={tagIndex}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 10px',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: 'white',
                                  background: `linear-gradient(135deg, ${tag.color}, ${tag.color}dd)`,
                                  boxShadow: `0 2px 6px ${tag.color}40`,
                                  animation: 'tagFloat 3s ease-in-out infinite',
                                  animationDelay: `${tagIndex * 0.3}s`,
                                  position: 'relative',
                                  overflow: 'hidden',
                                  border: '1px solid rgba(255, 255, 255, 0.2)'
                                }}
                              >
                                <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)', backgroundSize: '200% 100%', animation: 'tagShine 3s linear infinite', animationDelay: `${tagIndex * 0.5}s` }} />
                                <span style={{ position: 'relative', zIndex: 1 }}>{tag.icon}</span>
                                <span style={{ position: 'relative', zIndex: 1 }}>{tag.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* "X more waiting" card */}
                {queueingCalls.length > 5 && (
                  <div style={{
                    background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    border: '1px solid #fecaca',
                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '18px' }}>⏳</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626' }}>
                      +{queueingCalls.length - 5} more waiting
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Current Calls Card */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.6)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h3 style={{ 
                margin: '0 0 16px 0', 
                fontSize: '16px',
                fontWeight: 600,
                color: '#1f2937',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🎧</span>
                <span>Current Calls</span>
              </h3>
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                fontSize: '14px'
              }}>
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {currentCalls.length === 0 && (
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#9ca3af',
                      fontSize: '14px'
                    }}>
                      No active calls
                    </div>
                  )}

                  {currentCalls.length > 0 && currentCalls.map((call, index) => {
                    // Use the stored start time for this call, or fall back to the current started_at
                    const startTime = callStartTimes[call.id] || (call.startedAt ? new Date(call.startedAt).getTime() : Date.now());
                    const talkSeconds = Math.max(0, Math.floor((nowTick - startTime) / 1000));

                    // Check if this is a new call (not previously seen)
                    const isNewCall = !seenCurrentCallIds.has(call.id);

                    return (
                      <div
                        key={call.id || index}
                        style={{
                          background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)',
                          padding: '16px',
                          borderRadius: '12px',
                          border: '1px solid #bbd7ff',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                          animation: isNewCall 
                            ? `fadeSlideUp 0.5s ease-out`
                            : 'none',
                          animationDelay: isNewCall ? `${index * 0.04}s` : '0s',
                          animationFillMode: 'backwards',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '3px',
                          background: 'linear-gradient(90deg,#3b82f6,#60a5fa)',
                          borderRadius: '12px 12px 0 0'
                        }} />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e3a8a' }}>{call.patientName}</div>
                            <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '2px' }}>📱 {call.phoneNumber}</div>
                          </div>

                          <div style={{ fontSize: '11px', color: '#2563eb', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <span>⏱️ Talk: {formatWaitTime(talkSeconds)}</span>
                            <span>👤 {call.agentName}</span>
                          </div>

                          <div style={{ fontSize: '11px', color: '#1e40af', padding: '6px 8px', background: 'rgba(59,130,246,0.06)', borderRadius: '6px' }}>
                            <strong>Status:</strong> In progress
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Completed Calls Card */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#1f2937',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span>✓</span>
                  <span>Completed</span>
                  <span style={{
                    background: '#10b981',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    {completedCalls.length}
                  </span>
                </h3>
              </div>
              
              <div style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {completedCalls.length === 0 ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9ca3af',
                    fontSize: '14px'
                  }}>
                    No completed calls today
                  </div>
                ) : (
                  completedCalls.map((call, index) => {
                    return (
                      <div
                        key={call.id}
                        style={{
                          background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                          padding: '16px',
                          borderRadius: '12px',
                          border: '1px solid #bbf7d0',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
                          animation: 'fadeSlideUp 0.5s ease-out',
                          animationDelay: `${index * 0.05}s`,
                          animationFillMode: 'backwards',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Green accent bar */}
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          height: '3px',
                          background: 'linear-gradient(90deg, #10b981, #059669)',
                          borderRadius: '12px 12px 0 0'
                        }} />

                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}>
                          {/* Patient Name and Phone */}
                          <div>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#065f46'
                            }}>
                              {call.patientName}
                            </div>
                            <div style={{
                              fontSize: '11px',
                              color: '#059669',
                              marginTop: '2px'
                            }}>
                              📱 {call.phoneNumber}
                            </div>
                          </div>
                          
                          {/* Durations */}
                          <div style={{
                            fontSize: '11px',
                            color: '#047857',
                            display: 'flex',
                            gap: '10px',
                            flexWrap: 'wrap'
                          }}>
                            <span>⏱️ Queue: {formatWaitTime(call.queueDuration)}</span>
                            <span>📞 Talk: {formatWaitTime(call.talkDuration)}</span>
                          </div>

                          {/* Agent and Line */}
                          <div style={{
                            fontSize: '11px',
                            color: '#059669',
                            display: 'flex',
                            gap: '10px',
                            flexWrap: 'wrap'
                          }}>
                            <span>👤 {call.agentName}</span>
                            <span>📞 {call.dialledName}</span>
                          </div>

                          {/* Reason for Call (always render; show placeholder if missing) */}
                          <div style={{
                            fontSize: '11px',
                            color: '#047857',
                            padding: '6px 8px',
                            background: 'rgba(16, 185, 129, 0.06)',
                            borderRadius: '6px'
                          }}>
                            <strong>Reason:</strong> {call.reasonForCall || 'Not recorded'}
                          </div>

                          {/* Outcome Summary (always render; show placeholder if missing) */}
                          <div style={{
                            fontSize: '11px',
                            color: '#065f46',
                            padding: '6px 8px',
                            background: 'rgba(5, 150, 105, 0.06)',
                            borderRadius: '6px'
                          }}>
                            <strong>Outcome:</strong> {call.outcomeSummary || 'Not recorded'}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'appointments' && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.6)'
          }}>
            <h2 style={{ margin: '0 0 12px 0', color: '#1f2937' }}>Live Appointments</h2>
            <p style={{ color: '#6b7280', margin: 0 }}>Appointments dashboard content coming soon...</p>
          </div>
        )}

        {activeTab === 'api-testing' && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.6)'
          }}>
            <h2 style={{ margin: '0 0 12px 0', color: '#1f2937' }}>API testing</h2>
            <p style={{ color: '#6b7280', margin: 0 }}>API testing area — content coming soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}
