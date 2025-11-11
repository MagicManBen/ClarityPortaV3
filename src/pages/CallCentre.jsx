import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function CallCentre() {
  const [selectedReceptionist, setSelectedReceptionist] = useState('');
  const [activeCalls, setActiveCalls] = useState([]);
  const [patientInfo, setPatientInfo] = useState(null); // Will hold caller details from quick_view
  const [appointments, setAppointments] = useState([]); // Will hold all patient appointments from pop_apps
  const [upcomingAppointments, setUpcomingAppointments] = useState([]); // Legacy state, not used
  const [recentCalls, setRecentCalls] = useState([]); // Will hold recent calls from call_logs_allfields
  const [newCallIds, setNewCallIds] = useState(new Set()); // Track newly added calls for animation
  
  // Medications state
  const [medications, setMedications] = useState([]); // Recent medications
  const [medicationView, setMedicationView] = useState('issued'); // 'issued' | 'pending'
  const [allMedicationsData, setAllMedicationsData] = useState([]); // All medications for modal
  
  // Full data for modals (all records, no filtering)
  const [allAppointmentsData, setAllAppointmentsData] = useState([]);
  const [allCallsData, setAllCallsData] = useState([]);
  const [openModal, setOpenModal] = useState(null); // 'appointments' | 'calls' | 'medications' | null
  
  // Slot Finder state
  const [slotFinderMode, setSlotFinderMode] = useState('gp'); // 'gp' | 'nurse'
  const [slotFinderView, setSlotFinderView] = useState('list'); // 'list' | 'calendar'
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlotTypes, setSelectedSlotTypes] = useState({
    'Appointment Within 1 Week': true,
    'Appointment 1 to 2 Weeks': true,
    'Book on the Day': false,
    'Telephone Appointment Slot': false
  });
  const [selectedNurseSlotTypes, setSelectedNurseSlotTypes] = useState({});
  const [selectedSessionHolders, setSelectedSessionHolders] = useState({});
  
  // X-on Calls state
  const [xonCalls, setXonCalls] = useState([]);
  const [loadingXonCalls, setLoadingXonCalls] = useState(false);
  const [selectedXonCall, setSelectedXonCall] = useState(null); // Currently selected call to display
  const [lastActiveCall, setLastActiveCall] = useState(null); // Store the last active call before it ends
  
  // Duty Query Generation state
  const [generatingQuery, setGeneratingQuery] = useState(false);
  const [generatedQuery, setGeneratedQuery] = useState(null);
  const [queryTranscript, setQueryTranscript] = useState(null);
  const [queryGenerationStep, setQueryGenerationStep] = useState(''); // 'transcribing' or 'generating'
  
  // Interpreter warning state
  const [interpreterWarning, setInterpreterWarning] = useState(null); // { language: string, show: boolean }
  const [interpreterProgress, setInterpreterProgress] = useState(100); // Progress bar percentage

  // Call History state
  const [callHistory, setCallHistory] = useState([]);
  const [loadingCallHistory, setLoadingCallHistory] = useState(false);
  const [callHistoryFilters, setCallHistoryFilters] = useState({
    searchTerm: '',
    agentFilter: '',
    startDate: '',
    endDate: '',
    directionFilter: 'all' // 'all', 'inbound', 'outbound'
  });

  // Receptionist list will be loaded from X-on via a secure proxy (Supabase Edge Function or server)
  const [receptionists, setReceptionists] = useState([{ id: 'loading', name: 'Loading...' }]);
  const [loadingReceptionists, setLoadingReceptionists] = useState(false);
  const pollRef = useRef(null);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const DEBUG_MAX = 100;
  
  // Flag to track when test lookup is active
  const [isTestLookupActive, setIsTestLookupActive] = useState(false);
  
  // Auto mode state - automatically select agent with active call
  const [autoMode, setAutoMode] = useState(false);

  // Configure proxy base URL via Vite env variable.
  // Example .env: VITE_XON_PROXY_URL=https://your-project.supabase.co/functions/v1/xon-proxy
  const PROXY_BASE = import.meta.env.VITE_XON_PROXY_URL || '';

  async function fetchReceptionists() {
    setLoadingReceptionists(true);
    try {
      const url = PROXY_BASE || '/api/xon';
      const started = Date.now();
      
      addDebug({ type: 'fetch_start', url });
      
      const res = await fetch(url, { 
        cache: 'no-store',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      const took = Date.now() - started;
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        addDebug({ type: 'fetch_error', url, status: res.status, took, bodyPreview: text.slice(0, 400) });
        setReceptionists([{ id: 'error', name: `Error ${res.status}` }]);
        return;
      }
      
      const json = await res.json();
      addDebug({ 
        type: 'fetch_success', 
        url, 
        status: res.status, 
        took, 
        total_users: json.total_users_fetched,
        active_users: json.active_users,
        cached: json.cached,
        bodyPreview: JSON.stringify(json).slice(0, 500) 
      });
      
      const items = (json.data || []).map(u => ({
        id: u.id,
        name: u.name,
        status: u.status,
        email: u.email
      }));
      
      if (items.length === 0) {
        items.push({ id: 'none', name: 'No logged-in users found' });
      }
      
      setReceptionists(items);
      addDebug({ type: 'result', count: items.length, items: items.slice(0, 20) });
      
    } catch (err) {
      const took = Date.now() - started;
      console.error('Error fetching receptionists', err);
      setReceptionists([{ id: 'error', name: 'Network Error' }]);
      addDebug({ type: 'exception', error: (err && err.message) || String(err), took });
    } finally {
      setLoadingReceptionists(false);
    }
  }

  function addDebug(entry) {
    const ts = new Date().toISOString();
    setDebugLogs(prev => {
      const next = [{ ts, ...entry }, ...prev].slice(0, DEBUG_MAX);
      return next;
    });
  }

  // Fetch ended calls from X-on API via Edge Function
  async function fetchXonCalls() {
    setLoadingXonCalls(true);
    try {
      addDebug({ type: 'xon_calls_fetch_start', lastActiveCall });

      const functionUrl = 'https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/xon-calls';
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eG5qZWxmcXh1ZWxlZWl4ZXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjkyNDI3MjEsImV4cCI6MjA0NDgxODcyMX0.R8uWYOKb0FPLpGFOWJYGqYyZUOBT-8-MKsz6Zyo0TpQ'
        },
        body: JSON.stringify({
          limit: 20 // Get more calls for dropdown
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Error fetching X-on calls:', errorData);
        addDebug({ type: 'xon_calls_error', error: errorData, status: response.status });
        setXonCalls([]);
        return;
      }

      const data = await response.json();
      let calls = data.data || [];
      
      // Filter calls by selected receptionist if one is selected
      if (selectedReceptionist) {
        const receptionistObj = receptionists.find(r => r.id === selectedReceptionist);
        const receptionistName = receptionistObj?.name;
        
        if (receptionistName) {
          calls = calls.filter(call => 
            call.agent?.name === receptionistName || 
            call.agent?.account === selectedReceptionist
          );
          addDebug({ 
            type: 'xon_calls_filtered', 
            selectedReceptionist,
            receptionistName,
            callsBeforeFilter: data.data?.length || 0,
            callsAfterFilter: calls.length
          });
        }
      }
      
      setXonCalls(calls);
      
      // Auto-select the most recent call (first in list) or try to match lastActiveCall
      if (calls.length > 0) {
        // Try to find the call that matches the last active call by phone number
        let matchedCall = null;
        if (lastActiveCall?.phone_number) {
          matchedCall = calls.find(call => 
            call.caller?.number === lastActiveCall.phone_number ||
            call.dialled?.number === lastActiveCall.phone_number
          );
        }
        
        // If no match, just use the most recent call
        setSelectedXonCall(matchedCall || calls[0]);
        addDebug({ 
          type: 'xon_calls_fetched', 
          count: calls.length,
          selectedCall: matchedCall || calls[0],
          matched: !!matchedCall
        });
      }
    } catch (err) {
      console.error('Exception fetching X-on calls:', err);
      addDebug({ type: 'xon_calls_exception', error: String(err) });
      setXonCalls([]);
    } finally {
      setLoadingXonCalls(false);
    }
  }

  // Generate duty doctor query using OpenAI
  async function generateDutyQuery() {
    if (!selectedXonCall?.id) {
      alert('Please select a call first');
      return;
    }

    setGeneratingQuery(true);
    setGeneratedQuery(null);
    setQueryTranscript(null);
    setQueryGenerationStep('transcribing');

    try {
      addDebug({ type: 'generate_duty_query_start', callId: selectedXonCall.id });

      // Simulate step tracking
      const stepTimer = setTimeout(() => {
        setQueryGenerationStep('generating');
      }, 3000);

      const functionUrl = 'https://wwxnjelfqxueleeixesn.supabase.co/functions/v1/generate-duty-query';
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eG5qZWxmcXh1ZWxlZWl4ZXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjkyNDI3MjEsImV4cCI6MjA0NDgxODcyMX0.R8uWYOKb0FPLpGFOWJYGqYyZUOBT-8-MKsz6Zyo0TpQ'
        },
        body: JSON.stringify({
          callId: selectedXonCall.id
        })
      });

      clearTimeout(stepTimer);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Error generating duty query:', errorData);
        addDebug({ type: 'generate_duty_query_error', error: errorData, status: response.status });
        alert(`Failed to generate query: ${errorData.error || 'Unknown error'}`);
        return;
      }

      const data = await response.json();
      setGeneratedQuery(data.dutyQuery);
      setQueryTranscript(data.transcript);
      
      addDebug({ 
        type: 'generate_duty_query_success', 
        callId: selectedXonCall.id,
        queryLength: data.dutyQuery?.length,
        transcriptLength: data.transcript?.length
      });
    } catch (err) {
      console.error('Exception generating duty query:', err);
      addDebug({ type: 'generate_duty_query_exception', error: String(err) });
      alert('Failed to generate duty query. Please try again.');
    } finally {
      setGeneratingQuery(false);
      setQueryGenerationStep('');
    }
  }

  // Fetch available slots from Apps_Calendar_Year
  async function fetchAvailableSlots() {
    setLoadingSlots(true);
    try {
      addDebug({ type: 'slot_finder_fetch_start', mode: slotFinderMode });

      // Build the query
      let query = supabase
        .from('Apps_Calendar_Year')
        .select('*')
        .eq('Availability', 'Available')
        .order('Appointment Date', { ascending: true })
        .order('Appointment Time', { ascending: true })
        .limit(200);

      // Apply slot type filters based on mode
      if (slotFinderMode === 'gp') {
        const enabledTypes = Object.keys(selectedSlotTypes).filter(k => selectedSlotTypes[k]);
        if (enabledTypes.length > 0) {
          query = query.in('Slot Type', enabledTypes);
        }
      } else {
        const enabledTypes = Object.keys(selectedNurseSlotTypes).filter(k => selectedNurseSlotTypes[k]);
        if (enabledTypes.length > 0) {
          query = query.in('Slot Type', enabledTypes);
        }
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching slots:', error);
        addDebug({ type: 'slot_finder_error', error: error.message });
        setAvailableSlots([]);
        return;
      }

      // Apply session holder filters
      let filteredData = data || [];

      // Filter by session holder name (GP must contain "Dr")
      if (slotFinderMode === 'gp') {
        filteredData = filteredData.filter(slot => {
          const holder = slot['Full Name of the Session Holder of the Session'] || '';
          return holder.includes('(Dr)');
        });
      }

      // Filter out past dates
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Set to start of day
      filteredData = filteredData.filter(slot => {
        const dateStr = slot['Appointment Date'];
        if (!dateStr) return false;
        
        try {
          // Parse dd-MMM-yyyy format
          const [day, monthStr, year] = dateStr.split('-');
          const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
          const month = months[monthStr] || 0;
          const slotDate = new Date(parseInt(year), month, parseInt(day));
          slotDate.setHours(0, 0, 0, 0);
          
          return slotDate >= today;
        } catch (e) {
          console.warn('Failed to parse date:', dateStr, e);
          return false;
        }
      });

      // Apply selected session holder filter
      const enabledHolders = Object.keys(selectedSessionHolders).filter(k => selectedSessionHolders[k]);
      if (enabledHolders.length > 0) {
        filteredData = filteredData.filter(slot => {
          const holder = slot['Full Name of the Session Holder of the Session'] || '';
          return enabledHolders.includes(holder);
        });
      }

      setAvailableSlots(filteredData);
      addDebug({ 
        type: 'slot_finder_fetched', 
        mode: slotFinderMode,
        total: filteredData.length,
        sample: filteredData.slice(0, 3)
      });
    } catch (err) {
      console.error('Exception fetching slots:', err);
      addDebug({ type: 'slot_finder_exception', error: String(err) });
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  // Helper function to convert phone number format (same as LiveView)
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

  // Lookup patient info by phone number (same logic as LiveView)
  async function lookupPatientByPhone(phoneNumber) {
    if (!phoneNumber) {
      setPatientInfo(null);
      return;
    }

    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      setPatientInfo(null);
      return;
    }

    console.log('Looking up phone:', phoneNumber, '→ normalized:', normalizedPhone);
    addDebug({ type: 'patient_lookup_start', original: phoneNumber, normalized: normalizedPhone });

    try {
      // First check mobile
      let { data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Mobile Telephone', normalizedPhone)
        .limit(1);

      if (patients && patients.length > 0) {
        console.log('Found patient by mobile:', patients[0]['Full Name']);
        console.log('Patient data keys:', Object.keys(patients[0]));
        console.log('Full patient record:', patients[0]);
        addDebug({ type: 'patient_found_mobile', patient: patients[0]['Full Name'], allKeys: Object.keys(patients[0]), fullRecord: patients[0] });
        setPatientInfo(patients[0]);
        
        // Check interpreter requirements from quick_view for warnings
        try {
          const { data: quickViewData } = await supabase
            .from('quick_view')
            .select('interpreter_required, main_spoken_language, patient_warnings')
            .eq('emis_number', patients[0]['Patient Details EMIS Number'])
            .limit(1);
          
          if (quickViewData && quickViewData.length > 0) {
            const qv = quickViewData[0];
            if (qv.interpreter_required && qv.main_spoken_language) {
              const languageMatch = qv.main_spoken_language.match(/^([^(]+)/);
              const language = languageMatch ? languageMatch[1].trim() : qv.main_spoken_language;
              setInterpreterWarning({ language, show: true });
              setInterpreterProgress(100);
              addDebug({ type: 'interpreter_warning_shown', language, raw: qv.main_spoken_language });
            }
          }
        } catch (e) {
          console.warn('Error fetching interpreter info:', e);
        }
        
        return;
      }

      // Then check home phone
      ({ data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Home Telephone', normalizedPhone)
        .limit(1));

      if (patients && patients.length > 0) {
        console.log('Found patient by home:', patients[0]['Full Name']);
        addDebug({ type: 'patient_found_home', patient: patients[0]['Full Name'] });
        setPatientInfo(patients[0]);
        
        // Check interpreter requirements
        try {
          const { data: quickViewData } = await supabase
            .from('quick_view')
            .select('interpreter_required, main_spoken_language, patient_warnings')
            .eq('emis_number', patients[0]['Patient Details EMIS Number'])
            .limit(1);
          
          if (quickViewData && quickViewData.length > 0) {
            const qv = quickViewData[0];
            if (qv.interpreter_required && qv.main_spoken_language) {
              const languageMatch = qv.main_spoken_language.match(/^([^(]+)/);
              const language = languageMatch ? languageMatch[1].trim() : qv.main_spoken_language;
              setInterpreterWarning({ language, show: true });
              setInterpreterProgress(100);
              addDebug({ type: 'interpreter_warning_shown', language, raw: qv.main_spoken_language });
            }
          }
        } catch (e) {
          console.warn('Error fetching interpreter info:', e);
        }
        
        return;
      }

      // Finally check work phone
      ({ data: patients } = await supabase
        .from('Pop_Pt_Details')
        .select('*')
        .eq('Work Telephone', normalizedPhone)
        .limit(1));

      if (patients && patients.length > 0) {
        console.log('Found patient by work:', patients[0]['Full Name']);
        addDebug({ type: 'patient_found_work', patient: patients[0]['Full Name'] });
        setPatientInfo(patients[0]);
        
        // Check interpreter requirements
        try {
          const { data: quickViewData } = await supabase
            .from('quick_view')
            .select('interpreter_required, main_spoken_language, patient_warnings')
            .eq('emis_number', patients[0]['Patient Details EMIS Number'])
            .limit(1);
          
          if (quickViewData && quickViewData.length > 0) {
            const qv = quickViewData[0];
            if (qv.interpreter_required && qv.main_spoken_language) {
              const languageMatch = qv.main_spoken_language.match(/^([^(]+)/);
              const language = languageMatch ? languageMatch[1].trim() : qv.main_spoken_language;
              setInterpreterWarning({ language, show: true });
              setInterpreterProgress(100);
              addDebug({ type: 'interpreter_warning_shown', language, raw: qv.main_spoken_language });
            }
          }
        } catch (e) {
          console.warn('Error fetching interpreter info:', e);
        }
        
        return;
      }

      console.log('No patient found for phone:', normalizedPhone);
      addDebug({ type: 'patient_not_found', phone: phoneNumber, normalized: normalizedPhone });
      setPatientInfo(null);
    } catch (err) {
      console.error('Error looking up patient:', err);
      addDebug({ type: 'patient_lookup_error', phone: phoneNumber, error: String(err), stack: err?.stack });
      setPatientInfo(null);
    }
  }

  // Fetch appointments for patient by EMIS number
  async function fetchAppointments(emisNumber) {
    if (!emisNumber || emisNumber === 'Unknown' || emisNumber === 'Not found') {
      setAppointments([]);
      addDebug({ type: 'appointments_fetch_skipped', reason: 'Invalid EMIS', emis: emisNumber });
      return;
    }

    try {
      const emisStr = String(emisNumber);
      addDebug({ type: 'appointments_fetch_start', emis: emisNumber, emisStr });

      const { data, error } = await supabase
        .from('pop_apps')
        .select('*')
        .eq("Patient Details EMIS Number", emisStr)
        .limit(10);

      addDebug({ 
        type: 'appointments_query_result',
        emis: emisStr,
        error: error ? { message: error.message, details: error.details, hint: error.hint, code: error.code } : null,
        dataCount: data?.length || 0,
        sampleData: data ? data[0] : null
      });

      if (error) {
        console.error('Error fetching appointments:', error);
        addDebug({ type: 'appointments_fetch_error', emis: emisNumber, error: error.message, details: error, fullError: JSON.stringify(error) });
        setAppointments([]);
        setUpcomingAppointments([]);
        return;
      }

      // Parse date helper
      const parseDate = (dateStr, timeStr) => {
        if (!dateStr) return new Date(0);
        try {
          const [day, monthStr, year] = dateStr.split('-');
          const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
          const month = months[monthStr] || 0;
          const [hour = 0, min = 0] = (timeStr || '00:00').split(':').map(Number);
          return new Date(parseInt(year), month, parseInt(day), hour, min);
        } catch (e) {
          console.warn('Failed to parse appointment date:', dateStr, timeStr, e);
          return new Date(0);
        }
      };

      const now = new Date();
      const allAppointments = data || [];

      // Store ALL appointments for modal (no filtering)
      const sortedAllForModal = [...allAppointments].sort((a, b) => {
        const dateA = parseDate(a['Appointment Date'], a['Appointment Time']);
        const dateB = parseDate(b['Appointment Date'], b['Appointment Time']);
        return dateB - dateA;
      });
      setAllAppointmentsData(sortedAllForModal);

      // Exclude 'Task List' slot types and sort the remaining appointments by date (most recent first, including future)
      const filteredAppointments = allAppointments.filter(apt => {
        const slotType = (apt['Slot Type'] || '').toString().trim().toLowerCase();
        return slotType !== 'task list';
      });

      const sortedAll = filteredAppointments.sort((a, b) => {
        const dateA = parseDate(a['Appointment Date'], a['Appointment Time']);
        const dateB = parseDate(b['Appointment Date'], b['Appointment Time']);
        return dateB - dateA; // Descending (most recent/future first)
      });

      addDebug({ 
        type: 'appointments_fetched', 
        emis: emisNumber, 
  total_count: sortedAll.length,
  filtered_from: allAppointments.length,
        appointments: sortedAll.map(apt => ({
          date: apt['Appointment Date'],
          time: apt['Appointment Time'],
          status: apt['Current Slot Status']
        }))
      });

      setAppointments(sortedAll);
      setUpcomingAppointments([]); // Not used anymore
    } catch (err) {
      console.error('Exception fetching appointments:', err);
      addDebug({ type: 'appointments_fetch_exception', emis: emisNumber, error: String(err), stack: err?.stack });
      setAppointments([]);
      setUpcomingAppointments([]);
    }
  }

  // Fetch medications by EMIS number
  async function fetchMedications(emisNumber) {
    if (!emisNumber || emisNumber === 'Unknown' || emisNumber === 'Not found') {
      setMedications([]);
      setAllMedicationsData([]);
      addDebug({ type: 'medications_fetch_skipped', reason: 'Invalid EMIS', emis: emisNumber });
      return;
    }

    try {
      const emisStr = String(emisNumber);
      addDebug({ type: 'medications_fetch_start', emis: emisNumber, emisStr });

      // Fetch ALL medications for this patient
      const { data, error } = await supabase
        .from('pop_med_requests')
        .select('*')
        .eq("Patient Details EMIS Number", emisStr)
        .order('Medication Requests Request Date', { ascending: false })
        .limit(50);

      addDebug({ 
        type: 'medications_query_result',
        emis: emisStr,
        error: error ? { message: error.message, details: error.details, hint: error.hint, code: error.code } : null,
        dataCount: data?.length || 0,
        sampleData: data ? data[0] : null
      });

      if (error) {
        console.error('Error fetching medications:', error);
        addDebug({ type: 'medications_fetch_error', emis: emisNumber, error: error.message, details: error });
        setMedications([]);
        setAllMedicationsData([]);
        return;
      }

      // Store all medications
      setAllMedicationsData(data || []);
      
      // Filter for card view - show only first 5
      setMedications((data || []).slice(0, 5));
      
      addDebug({ 
        type: 'medications_fetched', 
        emis: emisNumber, 
        total_count: data?.length || 0,
        card_count: Math.min((data || []).length, 5)
      });
    } catch (err) {
      console.error('Exception fetching medications:', err);
      addDebug({ type: 'medications_fetch_exception', emis: emisNumber, error: String(err), stack: err?.stack });
      setMedications([]);
      setAllMedicationsData([]);
    }
  }

  // Fetch recent calls by phone number
  async function fetchRecentCalls(phoneNumber) {
    if (!phoneNumber) {
      setRecentCalls([]);
      addDebug({ type: 'calls_fetch_skipped', reason: 'No phone number' });
      return;
    }

    try {
      // Convert phone number format - replace +44 with 0
      let searchNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');
      if (searchNumber.startsWith('+44')) {
        searchNumber = '0' + searchNumber.substring(3);
      } else if (searchNumber.startsWith('44')) {
        searchNumber = '0' + searchNumber.substring(2);
      }

      // Also try the original format
      const originalNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');
      
      addDebug({ type: 'calls_fetch_start', phone: phoneNumber, searchNumber, originalNumber });

      // Fetch limited calls for the card display
      const { data, error } = await supabase
        .from('call_logs_allfields')
        .select('id, direction, started_at, ended_at, outcome, reason_for_call, outcome_summary, talk_sec, caller_number, agent_user_name')
        .or(`caller_number.eq.${searchNumber},caller_number.eq.${originalNumber},caller_number.eq.+44${searchNumber.substring(1)}`)
        .gt('talk_sec', 5) // Only fetch calls with more than 5 seconds of talk time
        .order('started_at', { ascending: false })
        .limit(3);

      // Fetch ALL calls for the modal (no limit)
      const { data: allCalls, error: allCallsError } = await supabase
        .from('call_logs_allfields')
        .select('*')
        .or(`caller_number.eq.${searchNumber},caller_number.eq.${originalNumber},caller_number.eq.+44${searchNumber.substring(1)}`)
        .order('started_at', { ascending: false });

      addDebug({ 
        type: 'calls_query_result',
        phone: phoneNumber,
        searchNumber,
        error: error?.message,
        dataCount: data?.length || 0,
        allCallsCount: allCalls?.length || 0,
        sampleData: data ? data[0] : null
      });

      if (error) {
        console.error('Error fetching recent calls:', error);
        addDebug({ type: 'calls_fetch_error', phone: phoneNumber, error: error.message, details: error });
        setRecentCalls([]);
        setAllCallsData([]);
        return;
      }

      setRecentCalls(data || []);
      setAllCallsData(allCalls || []);
      addDebug({ 
        type: 'calls_fetched', 
        phone: phoneNumber, 
        count: data?.length || 0,
        calls: data || []
      });
    } catch (err) {
      console.error('Exception fetching recent calls:', err);
      addDebug({ type: 'calls_fetch_exception', phone: phoneNumber, error: String(err), stack: err?.stack });
      setRecentCalls([]);
    }
  }

  // Watch for active calls changes and lookup patient info from the first call
  useEffect(() => {
    if (activeCalls.length > 0) {
      const firstCall = activeCalls[0];
      setLastActiveCall(firstCall); // Store the current call
      lookupPatientByPhone(firstCall.phone_number);
    } else {
      // Call ended - keep patient info and last call for Duty Dr Query
      // Don't clear patientInfo immediately
    }
  }, [activeCalls]);

  // Fetch call history with filters
  async function fetchCallHistory() {
    setLoadingCallHistory(true);
    try {
      let query = supabase
        .from('call_logs_allfields')
        .select('*')
        .eq('is_internal', false)
        .gt('talk_sec', 1)
        .order('started_at', { ascending: false })
        .limit(100);

      // Apply date range filter
      if (callHistoryFilters.startDate) {
        query = query.gte('started_at', new Date(callHistoryFilters.startDate).toISOString());
      }
      if (callHistoryFilters.endDate) {
        const endDate = new Date(callHistoryFilters.endDate);
        endDate.setHours(23, 59, 59, 999);
        query = query.lte('started_at', endDate.toISOString());
      }

      // Apply direction filter
      if (callHistoryFilters.directionFilter !== 'all') {
        query = query.eq('direction', callHistoryFilters.directionFilter.toUpperCase());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching call history:', error);
        setCallHistory([]);
        return;
      }

      // Enrich with patient names
      const enriched = await Promise.all((data || []).map(async (call) => {
        const patientPhone = call.direction === 'INBOUND' ? call.caller_number : call.dialled_number;
        let patientName = null;
        
        if (patientPhone) {
          try {
            // Normalize phone number
            let searchNumber = patientPhone.replace(/[\s\-\(\)]/g, '');
            if (searchNumber.startsWith('+44')) {
              searchNumber = '0' + searchNumber.substring(3);
            }

            // Try mobile, home, work in order
            let { data: patients } = await supabase
              .from('Pop_Pt_Details')
              .select('Full Name')
              .eq('Mobile Telephone', searchNumber)
              .limit(1);

            if (!patients || patients.length === 0) {
              ({ data: patients } = await supabase
                .from('Pop_Pt_Details')
                .select('Full Name')
                .eq('Home Telephone', searchNumber)
                .limit(1));
            }

            if (!patients || patients.length === 0) {
              ({ data: patients } = await supabase
                .from('Pop_Pt_Details')
                .select('Full Name')
                .eq('Work Telephone', searchNumber)
                .limit(1));
            }

            if (patients && patients.length > 0) {
              patientName = patients[0]['Full Name'];
            }
          } catch (e) {
            console.warn('Patient lookup failed for call history:', e);
          }
        }

        return {
          ...call,
          patientName: patientName || 'Unknown Caller'
        };
      }));

      // Apply client-side filters
      let filtered = enriched;

      // Search term filter (searches caller number, agent name, reason, outcome, patient name)
      if (callHistoryFilters.searchTerm) {
        const term = callHistoryFilters.searchTerm.toLowerCase();
        filtered = filtered.filter(call =>
          (call.caller_number && call.caller_number.toLowerCase().includes(term)) ||
          (call.agent_user_name && call.agent_user_name.toLowerCase().includes(term)) ||
          (call.reason_for_call && call.reason_for_call.toLowerCase().includes(term)) ||
          (call.outcome_summary && call.outcome_summary.toLowerCase().includes(term)) ||
          (call.dialled_name && call.dialled_name.toLowerCase().includes(term)) ||
          (call.patientName && call.patientName.toLowerCase().includes(term))
        );
      }

      // Agent filter
      if (callHistoryFilters.agentFilter) {
        filtered = filtered.filter(call =>
          call.agent_user_name === callHistoryFilters.agentFilter
        );
      }

      setCallHistory(filtered);
    } catch (err) {
      console.error('Exception fetching call history:', err);
      setCallHistory([]);
    } finally {
      setLoadingCallHistory(false);
    }
  }

  // Watch for active calls changes and lookup patient info from the first call
  useEffect(() => {
    if (activeCalls.length > 0) {
      const firstCall = activeCalls[0];
      setLastActiveCall(firstCall); // Store the current call
      lookupPatientByPhone(firstCall.phone_number);
    } else {
      // Call ended - keep patient info and last call for Duty Dr Query
      // Don't clear patientInfo immediately
    }
  }, [activeCalls]);

  // Watch for patient info changes and fetch appointments when EMIS number is available
  useEffect(() => {
    if (patientInfo?.['Patient Details EMIS Number']) {
      fetchAppointments(patientInfo['Patient Details EMIS Number']);
    } else {
      setAppointments([]);
    }
  }, [patientInfo]);

  // Watch for patient info changes and fetch recent calls when phone number is available
  useEffect(() => {
    const phone = patientInfo?.['Mobile Telephone'] || patientInfo?.['Home Telephone'] || patientInfo?.['Work Telephone'];
    if (phone) {
      fetchRecentCalls(phone);
    } else {
      setRecentCalls([]);
    }
  }, [patientInfo]);

  // Watch for patient info changes and fetch medications when EMIS number is available
  useEffect(() => {
    if (patientInfo?.['Patient Details EMIS Number']) {
      fetchMedications(patientInfo['Patient Details EMIS Number']);
    } else {
      setMedications([]);
      setAllMedicationsData([]);
    }
  }, [patientInfo]);

  // Handle interpreter warning auto-dismiss with progress bar
  useEffect(() => {
    if (interpreterWarning?.show) {
      const duration = 10000; // 10 seconds
      const interval = 50; // Update every 50ms for smooth progress
      const steps = duration / interval;
      let currentStep = 0;

      const timer = setInterval(() => {
        currentStep++;
        const progress = 100 - (currentStep / steps) * 100;
        setInterpreterProgress(progress);

        if (currentStep >= steps) {
          clearInterval(timer);
          setInterpreterWarning(prev => prev ? { ...prev, show: false } : null);
          setTimeout(() => setInterpreterWarning(null), 300); // Allow fade out animation
        }
      }, interval);

      return () => clearInterval(timer);
    }
  }, [interpreterWarning?.show]);

  // Auto-search slots when modal opens or filters change
  useEffect(() => {
    if (openModal === 'action_look_for_appointment_slot') {
      fetchAvailableSlots();
    }
  }, [openModal, slotFinderMode, selectedSlotTypes, selectedNurseSlotTypes, selectedSessionHolders]);

  // Auto-fetch X-on calls when Duty Dr Query modal opens or receptionist changes
  useEffect(() => {
    if (openModal === 'action_duty_dr_query') {
      fetchXonCalls();
    }
  }, [openModal, selectedReceptionist]);

  // Auto-fetch call history when modal opens or filters change
  useEffect(() => {
    if (openModal === 'action_call_history') {
      fetchCallHistory();
    }
  }, [openModal, callHistoryFilters]);

  // Find and auto-select agent with active call
  async function findAndSelectActiveAgent() {
    try {
      addDebug({ type: 'auto_mode_search_start' });

      // Get all active calls
      const { data, error } = await supabase
        .from('live_calls')
        .select('*')
        .eq('status', 'answered')
        .order('last_seen', { ascending: false });

      if (error) {
        console.error('Error fetching active calls for auto mode:', error);
        addDebug({ type: 'auto_mode_error', error: error.message });
        return;
      }

      if (data && data.length > 0) {
        // Get the most recent active call
        const activeCall = data[0];
        const agentName = activeCall.agent_name;
        
        addDebug({ 
          type: 'auto_mode_found_call', 
          agentName,
          totalActiveCalls: data.length,
          call: activeCall 
        });

        // Find matching receptionist by name
        const matchingReceptionist = receptionists.find(r => r.name === agentName);
        
        if (matchingReceptionist) {
          setSelectedReceptionist(matchingReceptionist.id);
          addDebug({ 
            type: 'auto_mode_agent_selected', 
            agentName, 
            receptionistId: matchingReceptionist.id 
          });
        } else {
          addDebug({ 
            type: 'auto_mode_agent_not_found', 
            agentName,
            availableReceptionists: receptionists.map(r => r.name)
          });
        }
      } else {
        addDebug({ type: 'auto_mode_no_active_calls' });
        setActiveCalls([]);
      }
    } catch (err) {
      console.error('Exception in auto mode:', err);
      addDebug({ type: 'auto_mode_exception', error: String(err) });
    }
  }

  // Fetch active calls for the selected receptionist
  async function fetchActiveCalls(agentName) {
    if (!agentName || agentName === 'loading' || agentName === 'none' || agentName === 'error') {
      setActiveCalls([]);
      addDebug({ type: 'fetch_skipped', reason: 'Invalid agent name', agentName });
      return;
    }

    try {
      addDebug({ type: 'fetch_calls_start', agent: agentName });

      const { data, error } = await supabase
        .from('live_calls')
        .select('*')
        .eq('agent_name', agentName)
        .eq('status', 'answered')
        .order('last_seen', { ascending: false });

      if (error) {
        console.error('Error fetching calls:', error);
        addDebug({ type: 'call_fetch_error', agent: agentName, error: error.message, code: error.code, details: error.details });
        setActiveCalls([]);
        return;
      }

      setActiveCalls(data || []);
      addDebug({ 
        type: 'calls_fetched', 
        agent: agentName, 
        count: data?.length || 0,
        calls: data || [],
        query: { agent_name: agentName, status: 'answered' }
      });
    } catch (err) {
      console.error('Exception fetching calls:', err);
      addDebug({ type: 'call_fetch_exception', agent: agentName, error: String(err) });
      setActiveCalls([]);
    }
  }

  // Subscribe to live_calls changes in real-time
  useEffect(() => {
    // Skip subscription if test lookup is active
    if (isTestLookupActive) {
      addDebug({ type: 'subscription_skip', reason: 'Test lookup active' });
      return;
    }

    if (!selectedReceptionist) {
      addDebug({ type: 'subscription_skip', reason: 'No receptionist selected' });
      setActiveCalls([]);
      return;
    }

    const selectedAgent = receptionists.find(r => r.id === selectedReceptionist);
    const agentName = selectedAgent?.name;

    addDebug({ 
      type: 'subscription_check', 
      selectedReceptionist, 
      selectedAgent, 
      agentName,
      allReceptionists: receptionists.map(r => ({ id: r.id, name: r.name }))
    });

    if (!agentName || agentName === 'Loading...' || agentName === 'No logged-in users found' || agentName.startsWith('Error')) {
      setActiveCalls([]);
      addDebug({ type: 'subscription_skip', reason: 'Invalid agent name', agentName });
      return;
    }

    // Initial fetch
    addDebug({ type: 'initial_fetch', agent: agentName });
    fetchActiveCalls(agentName);

    // Subscribe to real-time changes for ALL live_calls (we'll filter client-side)
    const channelName = `live_calls_${Date.now()}`;
    const subscription = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_calls'
        },
        (payload) => {
          addDebug({ 
            type: 'realtime_event', 
            event: payload.eventType, 
            agent_name: payload.new?.agent_name || payload.old?.agent_name,
            matches: (payload.new?.agent_name === agentName || payload.old?.agent_name === agentName),
            payload 
          });
          // Refresh calls when any change occurs that might affect this agent
          if (payload.new?.agent_name === agentName || payload.old?.agent_name === agentName) {
            fetchActiveCalls(agentName);
          }
        }
      )
      .subscribe((status) => {
        addDebug({ type: 'subscription_status', status, agent: agentName, channel: channelName });
      });

    addDebug({ type: 'subscription_started', agent: agentName, channel: channelName });

    return () => {
      subscription.unsubscribe();
      addDebug({ type: 'subscription_stopped', agent: agentName, channel: channelName });
    };
  }, [selectedReceptionist, receptionists, isTestLookupActive]);

  useEffect(() => {
    fetchReceptionists();
    // Only set up polling if test lookup is not active
    if (!isTestLookupActive) {
      pollRef.current = setInterval(fetchReceptionists, 10000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [isTestLookupActive]);

  // Auto mode polling - check for active calls every 5 seconds
  useEffect(() => {
    if (autoMode && !isTestLookupActive) {
      // Initial search
      findAndSelectActiveAgent();
      
      // Poll every 5 seconds for new active calls
      const autoInterval = setInterval(findAndSelectActiveAgent, 5000);
      
      addDebug({ type: 'auto_mode_enabled', pollingInterval: '5s' });
      
      return () => {
        clearInterval(autoInterval);
        addDebug({ type: 'auto_mode_disabled' });
      };
    }
  }, [autoMode, isTestLookupActive, receptionists]);

  // Realtime subscription for completed calls
  useEffect(() => {
    if (!patientInfo?.phone_number) return;

    // Subscribe to new inserts in call_logs_allfields
    const phoneNumber = patientInfo.phone_number;
    const searchNumber = phoneNumber.startsWith('0') ? phoneNumber : '0' + phoneNumber.substring(3);
    const originalNumber = phoneNumber.replace(/[\s\-\(\)]/g, '');

    addDebug({ type: 'realtime_subscription_setup', phone: phoneNumber });

    const channel = supabase
      .channel('call_logs_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_logs_allfields',
          filter: `caller_number=in.(${searchNumber},${originalNumber},+44${searchNumber.substring(1)})`
        },
        (payload) => {
          addDebug({ type: 'realtime_new_call', payload: payload.new });
          
          const newCall = payload.new;
          
          // Add to recentCalls if talk time > 5 seconds
          if (newCall.talk_sec > 5) {
            setRecentCalls(prev => {
              // Check if call already exists
              if (prev.some(call => call.id === newCall.id)) {
                return prev;
              }
              // Add new call to the beginning
              const updated = [newCall, ...prev].slice(0, 3); // Keep only top 3
              return updated;
            });

            // Mark this call as new for animation
            setNewCallIds(prev => new Set([...prev, newCall.id]));
            
            // Remove animation after 2 seconds
            setTimeout(() => {
              setNewCallIds(prev => {
                const next = new Set(prev);
                next.delete(newCall.id);
                return next;
              });
            }, 2000);
          }

          // Also add to allCallsData
          setAllCallsData(prev => {
            if (prev.some(call => call.id === newCall.id)) {
              return prev;
            }
            return [newCall, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      addDebug({ type: 'realtime_subscription_cleanup' });
    };
  }, [patientInfo?.phone_number]);

  // Recent emails, referrals and medications removed for now

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
      <style>{`
        @keyframes slideInFromRight {
          from { 
            opacity: 0; 
            transform: translateX(30px) scale(0.95);
          }
          to { 
            opacity: 1; 
            transform: translateX(0) scale(1);
          }
        }

        @keyframes newCallGlow {
          0% { 
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          }
          50% {
            box-shadow: 0 0 20px 8px rgba(16, 185, 129, 0.3);
          }
          100% { 
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }

        .new-call-animation {
          animation: slideInFromRight 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), 
                     newCallGlow 2s ease-out;
        }
      `}</style>
      {/* Header with Receptionist Selector */}
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
        }}>Call Centre</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label htmlFor="receptionist-select" style={{ 
            fontWeight: 500, 
            fontSize: '14px', 
            color: '#4b5563',
            letterSpacing: '-0.01em'
          }}>Receptionist:</label>
          <select
            id="receptionist-select"
            value={selectedReceptionist}
            onChange={(e) => {
              setSelectedReceptionist(e.target.value);
              // Disable auto mode when manually selecting
              if (autoMode) {
                setAutoMode(false);
              }
            }}
            disabled={autoMode}
            style={{
              padding: '8px 14px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              minWidth: '240px',
              background: autoMode ? '#f3f4f6' : 'white',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              cursor: autoMode ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
              opacity: autoMode ? 0.6 : 1
            }}
          >
            <option value="">Select your name...</option>
            {receptionists.map(r => (
              <option key={r.id} value={r.id}>{r.name} (ID: {r.id})</option>
            ))}
          </select>
          <button
            onClick={() => {
              setAutoMode(!autoMode);
              if (!autoMode) {
                // Enable auto mode - will trigger useEffect to start polling
                addDebug({ type: 'auto_mode_button_clicked', enabled: true });
              } else {
                // Disable auto mode
                addDebug({ type: 'auto_mode_button_clicked', enabled: false });
              }
            }}
            title={autoMode ? 'Auto mode enabled - automatically tracking active calls' : 'Enable auto mode to automatically select agent with active call'}
            style={{ 
              padding: '8px 16px', 
              fontSize: '13px',
              borderRadius: '8px',
              border: autoMode ? '2px solid #10b981' : '1px solid #e5e7eb',
              background: autoMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'white',
              color: autoMode ? 'white' : '#6b7280',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: autoMode ? '0 2px 8px rgba(16, 185, 129, 0.3)' : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
              minWidth: '80px'
            }}
            onMouseEnter={(e) => {
              if (!autoMode) {
                e.currentTarget.style.background = '#f9fafb';
                e.currentTarget.style.borderColor = '#d1d5db';
              } else {
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!autoMode) {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.borderColor = '#e5e7eb';
              } else {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
              }
            }}
          >
            {autoMode ? '✓ Auto' : 'Auto'}
          </button>
          <button
            onClick={fetchReceptionists}
            title="Refresh receptionists"
            style={{ 
              padding: '8px 16px', 
              fontSize: '13px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: 'white',
              color: '#6b7280',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f9fafb';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.borderColor = '#e5e7eb';
            }}
          >
            {loadingReceptionists ? '⟳ Refreshing...' : '↻ Refresh'}
          </button>
          <button
            onClick={() => {
              const testPhone = prompt('Enter phone number to lookup:');
              if (testPhone) {
                // Stop all polling and subscriptions
                setIsTestLookupActive(true);
                
                // Clear any existing polling interval
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                
                // Simulate a live call by creating a mock call object
                const mockCall = {
                  id: 'test-' + Date.now(),
                  phone_number: testPhone,
                  status: 'answered',
                  direction: 'inbound',
                  start_time: new Date().toISOString(),
                  call_id: 'TEST-' + Date.now()
                };
                // This triggers the same useEffect that watches activeCalls
                setActiveCalls([mockCall]);
                addDebug({ type: 'test_lookup', phone: testPhone, mockCall, note: 'Polling and subscriptions stopped' });
              }
            }}
            title="Test patient lookup with a phone number"
            style={{ 
              padding: '8px 16px', 
              fontSize: '13px', 
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px', 
              cursor: 'pointer',
              fontWeight: 500,
              boxShadow: '0 2px 4px 0 rgba(16, 185, 129, 0.2)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(16, 185, 129, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 4px 0 rgba(16, 185, 129, 0.2)';
            }}
          >
            Test Lookup
          </button>
          {isTestLookupActive && (
            <button
              onClick={() => {
                setIsTestLookupActive(false);
                setActiveCalls([]);
                setPatientInfo(null);
                setAppointments([]);
                setRecentCalls([]);
                addDebug({ type: 'test_lookup_cleared', note: 'Polling and subscriptions will resume' });
              }}
              title="Clear test lookup and resume normal operation"
              style={{ padding: '6px 8px', fontSize: 13, background: '#ef4444', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              Clear Test
            </button>
          )}
        </div>
      </div>

      {/* Interpreter Required Warning Banner */}
      {interpreterWarning?.show && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 2000,
          width: '90%',
          maxWidth: '420px',
          background: 'linear-gradient(135deg, #3b82f6, #0ea5e9)',
          color: 'white',
          padding: '16px 20px',
          borderRadius: '10px',
          boxShadow: '0 12px 40px rgba(59, 130, 246, 0.25)',
          animation: 'slideUpIn 0.4s ease-out',
          overflow: 'hidden'
        }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
              <div style={{ 
                fontSize: '28px',
                marginTop: '2px',
                animation: 'gentleBob 2s ease-in-out infinite'
              }}>
                🌍
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '3px', letterSpacing: '0.3px' }}>
                  Interpreter Needed
                </div>
                <div style={{ fontSize: '14px', fontWeight: 500, opacity: 0.95 }}>
                  Language: <span style={{ fontWeight: 700 }}>{interpreterWarning.language}</span>
                </div>
                <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '6px', lineHeight: 1.4 }}>
                  Please arrange an interpreter if booking an appointment.
                </div>
              </div>
              <button
                onClick={() => {
                  setInterpreterWarning(prev => prev ? { ...prev, show: false } : null);
                  setTimeout(() => setInterpreterWarning(null), 300);
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  color: 'white',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: '18px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s ease',
                  flexShrink: 0,
                  marginTop: '2px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'}
              >
                ×
              </button>
            </div>
          </div>
          
          {/* Progress bar */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: 'rgba(255, 255, 255, 0.15)',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              background: 'rgba(255, 255, 255, 0.7)',
              width: `${interpreterProgress}%`,
              transition: 'width 0.05s linear'
            }}></div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUpIn {
          from {
            transform: translateY(120%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes gentleBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>

      {/* Debug floating button and panel */}
      <div>
        <button
          onClick={() => setDebugVisible(true)}
          title="Open debug console"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 1200,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#111827',
            color: 'white',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Debug
        </button>

        {debugVisible && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '90%', maxHeight: '90%', background: 'white', borderRadius: 8, padding: 16, overflow: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Debug Console</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify({ env: { PROXY_BASE }, logs: debugLogs }, null, 2));
                      alert('Copied debug JSON to clipboard');
                    } catch (err) {
                      // fallback
                      const txt = JSON.stringify({ env: { PROXY_BASE }, logs: debugLogs }, null, 2);
                      const ta = document.createElement('textarea');
                      ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                      alert('Copied debug JSON to clipboard (fallback)');
                    }
                  }} style={{ padding: '6px 8px' }}>Copy All</button>
                  <button onClick={() => setDebugLogs([])} style={{ padding: '6px 8px' }}>Clear</button>
                  <button onClick={() => setDebugVisible(false)} style={{ padding: '6px 8px' }}>Close</button>
                </div>
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                <strong>Env Config</strong>
                <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, overflow: 'auto' }}>
{`PROXY_BASE=${PROXY_BASE}
Note: Fetching ALL logged-in users (no group filtering)`}
                </pre>
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                <strong>Selected Receptionist</strong>
                <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, overflow: 'auto' }}>
{selectedReceptionist ? `ID: ${selectedReceptionist}\nName: ${receptionists.find(r => r.id === selectedReceptionist)?.name || 'Unknown'}` : 'None selected'}
                </pre>
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                <strong>Patient Info</strong>
                <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, overflow: 'auto' }}>{JSON.stringify(patientInfo, null, 2)}</pre>
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                <strong>Active Calls ({activeCalls.length})</strong>
                <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(activeCalls, null, 2)}</pre>
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                <strong>Receptionists ({receptionists.length})</strong>
                <pre style={{ background: '#f3f4f6', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 150 }}>{JSON.stringify(receptionists, null, 2)}</pre>
              </div>

              <div style={{ fontSize: 13, color: '#374151' }}>
                <strong>Logs (most recent first)</strong>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {debugLogs.length === 0 && <div style={{ color: '#6b7280' }}>No logs yet</div>}
                  {debugLogs.map((log, idx) => (
                    <div key={idx} style={{ background: '#f9fafb', padding: 8, borderRadius: 6 }}>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{log.ts} • {log.type}</div>
                      <pre style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{JSON.stringify(log, null, 2)}</pre>
                      <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                        <button onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(log, null, 2)); alert('Copied'); } catch { const ta=document.createElement('textarea'); ta.value=JSON.stringify(log,null,2); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Copied (fallback)'); } }} style={{ padding: '6px 8px' }}>Copy</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active call alerts removed - showing patient header only */}

      {/* Patient Information Header - Dynamic from phone lookup (single-line layout) */}
      {patientInfo ? (
        <>
          <div style={{
            background: '#f0f9ff',
            border: '2px solid #3b82f6',
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '12px',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'nowrap' }}>
              {/* Left: name + IDs + address (ellipsis if too long) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>
                  {patientInfo['Full Name'] || patientInfo['Patient Details Full Name'] || 'Unknown'}
                </h2>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '12px', color: '#374151', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#64748b', fontWeight: 500 }}>EMIS:</span>
                    <span style={{ fontWeight: 500 }}>
                      {patientInfo['Patient Details EMIS Number'] || patientInfo['EMIS Number'] || patientInfo['EMIS No'] || 'N/A'}
                    </span>
                    <button
                      onClick={() => { 
                        const emis = patientInfo['Patient Details EMIS Number'] || patientInfo['EMIS Number'] || patientInfo['EMIS No'] || '';
                        navigator.clipboard.writeText(String(emis)).catch(() => {}); 
                      }}
                      title="Copy EMIS number"
                      style={{ padding: '2px 6px', fontSize: '11px', background: '#e0e7ff', border: '1px solid #c7d2fe', borderRadius: '3px', cursor: 'pointer', color: '#3b82f6', fontWeight: 500 }}
                    >
                      Copy
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#64748b', fontWeight: 500 }}>NHS:</span>
                    <span style={{ fontWeight: 500 }}>
                      {patientInfo['NHS No'] || patientInfo['NHS Number'] || 'N/A'}
                    </span>
                    <button
                      onClick={() => { 
                        const nhs = patientInfo['NHS No'] || patientInfo['NHS Number'] || '';
                        navigator.clipboard.writeText(String(nhs)).catch(() => {}); 
                      }}
                      title="Copy NHS number"
                      style={{ padding: '2px 6px', fontSize: '11px', background: '#e0e7ff', border: '1px solid #c7d2fe', borderRadius: '3px', cursor: 'pointer', color: '#3b82f6', fontWeight: 500 }}
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Address inline but truncated if too long */}
                {(patientInfo.Address || patientInfo['Patient Details Address']) && (
                  <div style={{ marginLeft: 12, fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    <span style={{ fontWeight: 500, marginRight: 6 }}>Address:</span>
                    <span>{patientInfo.Address || patientInfo['Patient Details Address']}</span>
                  </div>
                )}
              </div>

              {/* Right: DOB / Age / Phone */}
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#374151', whiteSpace: 'nowrap', marginLeft: 12 }}>
                <div><span style={{ color: '#64748b', fontWeight: 500 }}>DOB:</span> {patientInfo['Date of Birth'] ? new Date(patientInfo['Date of Birth']).toLocaleDateString('en-GB') : patientInfo['Date Of Birth'] ? new Date(patientInfo['Date Of Birth']).toLocaleDateString('en-GB') : 'N/A'}</div>
                <div><span style={{ color: '#64748b', fontWeight: 500 }}>Age:</span> {patientInfo.Age || patientInfo['Patient Details Age'] || 'N/A'}</div>
                <div><span style={{ color: '#64748b', fontWeight: 500 }}>Phone:</span> {patientInfo['Mobile Telephone'] || patientInfo['Home Telephone'] || patientInfo['Work Telephone'] || 'N/A'}</div>
              </div>
            </div>
          </div>

          {/* Patient Warnings Alert */}
          {patientInfo['Patient Warnings'] && (
            <div style={{
              background: '#fef3c7',
              border: '2px solid #fcd34d',
              padding: '10px 14px',
              borderRadius: '6px',
              marginBottom: '12px',
              fontSize: '12px',
              color: '#92400e'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚠️ Patient Warnings
              </div>
              <div>{patientInfo['Patient Warnings']}</div>
            </div>
          )}
        </>
      ) : (
        <div style={{
          background: '#f9fafb',
          border: '2px solid #d1d5db',
          padding: '12px 16px',
          borderRadius: '6px',
          marginBottom: '12px',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          No active call - patient information will appear when a call is connected
        </div>
      )}

      {/* Main Content Grid - Two Rows */}
      <div style={{ 
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        flex: 1,
        overflow: 'hidden'
      }}>
        
        {/* Top Row - Quick Info and Actions */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: '16px',
          minHeight: '200px'
        }}>
          
          {/* Quick Info Card - Merged Patient Information */}
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.85)', 
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '16px', 
            borderRadius: '12px', 
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)', 
            border: '1px solid rgba(255, 255, 255, 0.6)',
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden' 
          }}>
            <h3 style={{ 
              margin: '0 0 12px 0', 
              fontSize: '15px', 
              fontWeight: 600, 
              color: '#111827',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '-0.01em'
            }}>
              <span>ℹ️</span>
              <span>Quick Info</span>
            </h3>
            
            {patientInfo ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>
                {/* Patient Details */}
                <div style={{ 
                  padding: '12px', 
                  background: '#f9fafb', 
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'auto 1fr', 
                    gap: '8px 16px',
                    fontSize: '13px'
                  }}>
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>Name:</div>
                    <div style={{ color: '#111827', fontWeight: 600 }}>
                      {patientInfo['Full Name'] || patientInfo['Patient Details Full Name'] || 'Unknown'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>EMIS:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo['Patient Details EMIS Number'] || patientInfo['EMIS Number'] || patientInfo['EMIS No'] || 'N/A'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>NHS:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo['NHS No'] || patientInfo['NHS Number'] || 'N/A'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>DOB:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo['Date of Birth'] ? new Date(patientInfo['Date of Birth']).toLocaleDateString('en-GB') : 
                       patientInfo['Date Of Birth'] ? new Date(patientInfo['Date Of Birth']).toLocaleDateString('en-GB') : 'N/A'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>Age:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo.Age || patientInfo['Patient Details Age'] || 'N/A'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>Address:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo.Address || patientInfo['Patient Details Address'] || 'N/A'}
                    </div>
                    
                    <div style={{ fontWeight: 700, color: '#6b7280' }}>Phone:</div>
                    <div style={{ color: '#111827' }}>
                      {patientInfo['Mobile Telephone'] || patientInfo['Home Telephone'] || patientInfo['Work Telephone'] || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                fontSize: '13px',
                textAlign: 'center',
                padding: '20px'
              }}>
                No active call - patient information will appear when a call is connected
              </div>
            )}
          </div>

          {/* Action Area */}
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.85)', 
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '16px', 
            borderRadius: '12px', 
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)', 
            border: '1px solid rgba(255, 255, 255, 0.6)',
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ 
                margin: 0, 
                fontSize: '15px', 
                fontWeight: 600, 
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                letterSpacing: '-0.01em'
              }}>
                <span>⚡</span>
                <span>Actions</span>
              </h3>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Quick tools</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { icon: '🔎', label: 'Look for appointment slot', action: 'action_look_for_appointment_slot' },
                { icon: '🧪', label: 'Sample Checker', action: 'action_sample_checker' },
                { icon: '📨', label: 'Duty Dr Query', action: 'action_duty_dr_query' },
                { icon: '📜', label: 'Call History', action: 'action_call_history' }
              ].map((btn) => (
                <button
                  key={btn.action}
                  onClick={() => { 
                    addDebug({ type: 'action_clicked', action: btn.action }); 
                    setOpenModal(btn.action); 
                  }}
                  style={{ 
                    padding: '12px 14px', 
                    borderRadius: '10px', 
                    border: '1px solid rgba(229, 231, 235, 0.8)', 
                    background: 'white', 
                    cursor: 'pointer', 
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: '#374151',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)';
                    e.currentTarget.style.transform = 'translateX(4px)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{btn.icon}</span>
                  <span>{btn.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Row - Appointments, Calls, Medications */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '16px',
          flex: 1,
          overflow: 'hidden'
        }}>
          
          {/* Recent Appointments */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.85)', 
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          padding: '16px', 
          borderRadius: '12px', 
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)', 
          border: '1px solid rgba(255, 255, 255, 0.6)',
          display: 'flex', 
          flexDirection: 'column', 
          overflow: 'hidden' 
        }}>
          <div 
            onClick={() => setOpenModal('appointments')}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '12px',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: '8px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(243, 244, 246, 0.7)';
              e.currentTarget.style.transform = 'translateX(2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <h3 style={{ 
              margin: 0, 
              fontSize: '15px', 
              fontWeight: 600, 
              color: '#111827',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '-0.01em'
            }}>
              <span>📅</span>
              <span>Appointments</span>
            </h3>
            <span style={{ 
              fontSize: '12px', 
              color: '#6b7280',
              fontWeight: 500
            }}>View all →</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', flex: 1 }}>
            {appointments.length > 0 ? (
              appointments.map((apt, idx) => {
                const now = new Date();
                const parseDate = (dateStr, timeStr) => {
                  if (!dateStr) return new Date(0);
                  try {
                    const [day, monthStr, year] = dateStr.split('-');
                    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
                    const month = months[monthStr] || 0;
                    const [hour = 0, min = 0] = (timeStr || '00:00').split(':').map(Number);
                    return new Date(parseInt(year), month, parseInt(day), hour, min);
                  } catch (e) {
                    return new Date(0);
                  }
                };
                const aptDate = parseDate(apt['Appointment Date'], apt['Appointment Time']);
                const isFuture = aptDate >= now;
                
                return (
                  <div key={apt['Slot ID'] || idx} style={{ 
                    padding: '8px', 
                    background: '#f9fafb', 
                    borderRadius: '4px',
                    borderLeft: `2px solid ${isFuture ? '#10b981' : '#3b82f6'}`,
                    fontSize: '12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '3px', fontWeight: 600 }}>
                      <span>{apt['Appointment Date']} {apt['Appointment Time']}</span>
                    </div>
                    <div style={{ color: '#374151', marginBottom: '2px' }}>
                      {apt['Slot Type']}
                      {apt['Appointment Reason'] && ` - ${apt['Appointment Reason']}`}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '11px' }}>
                      {apt["Session Holders Full Name"]}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ 
                padding: '12px', 
                color: '#6b7280', 
                fontSize: '12px', 
                textAlign: 'center',
                background: '#f9fafb',
                borderRadius: '4px'
              }}>
                {patientInfo ? 'No appointments found' : 'Select a call to view appointments'}
              </div>
            )}
          </div>
        </div>

        {/* Recent Emails removed */}

        {/* Recent Calls */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.85)', 
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          padding: '16px', 
          borderRadius: '12px', 
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)', 
          border: '1px solid rgba(255, 255, 255, 0.6)',
          display: 'flex', 
          flexDirection: 'column', 
          overflow: 'hidden' 
        }}>
          <div 
            onClick={() => setOpenModal('calls')}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '12px',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: '8px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(243, 244, 246, 0.7)';
              e.currentTarget.style.transform = 'translateX(2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <h3 style={{ 
              margin: 0, 
              fontSize: '15px', 
              fontWeight: 600, 
              color: '#111827',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '-0.01em'
            }}>
              <span>📞</span>
              <span>Calls</span>
            </h3>
            <span style={{ 
              fontSize: '12px', 
              color: '#6b7280',
              fontWeight: 500
            }}>View all →</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', flex: 1 }}>
            {recentCalls.length > 0 ? (
              recentCalls
                .filter(call => call.talk_sec && call.talk_sec > 5) // Client-side safety filter for answered calls
                .map((call, idx) => {
                const callDate = call.started_at ? new Date(call.started_at) : null;
                const dateStr = callDate ? callDate.toLocaleDateString('en-GB') : 'Unknown';
                const timeStr = callDate ? callDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                const durationStr = call.talk_sec ? `${Math.floor(call.talk_sec / 60)}m ${call.talk_sec % 60}s` : 'N/A';
                const isNew = newCallIds.has(call.id);
                
                return (
                  <div 
                    key={call.id || idx} 
                    className={isNew ? 'new-call-animation' : ''}
                    style={{
                      padding: '8px',
                      background: isNew ? 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' : '#f9fafb',
                      borderRadius: '4px',
                      borderLeft: isNew ? '3px solid #10b981' : '2px solid #10b981',
                      fontSize: '12px',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontWeight: 700 }}>
                      <div style={{ fontSize: '14px' }}>{dateStr} {timeStr}</div>
                      <div style={{ color: '#6b7280', fontSize: '13px', fontWeight: 600 }}>{durationStr}</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', columnGap: 12, rowGap: 6, alignItems: 'start' }}>
                      <div style={{ color: '#374151', fontWeight: 700 }}>Call Reason:</div>
                      <div style={{ color: '#374151', wordBreak: 'break-word', whiteSpace: 'normal' }}>{call.reason_for_call || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No reason recorded</span>}</div>

                      <div style={{ color: '#374151', fontWeight: 700 }}>Outcome:</div>
                      <div style={{ color: '#374151', wordBreak: 'break-word', whiteSpace: 'normal' }}>{call.outcome_summary || ''}</div>
                    </div>

                    <div style={{ marginTop: 8, color: '#6b7280', fontSize: '11px' }}>
                      {call.agent_user_name || 'Unknown handler'}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ 
                padding: '12px', 
                color: '#6b7280', 
                fontSize: '12px', 
                textAlign: 'center',
                background: '#f9fafb',
                borderRadius: '4px'
              }}>
                {patientInfo ? 'No recent calls found' : 'Select a call to view history'}
              </div>
            )}
          </div>
        </div>

        {/* Medications Card */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.85)', 
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          padding: '16px', 
          borderRadius: '12px', 
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)', 
          border: '1px solid rgba(255, 255, 255, 0.6)',
          display: 'flex', 
          flexDirection: 'column', 
          overflow: 'hidden' 
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: '15px', 
              fontWeight: 600, 
              color: '#111827',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              letterSpacing: '-0.01em'
            }}>
              <span>💊</span>
              <span>Medications</span>
            </h3>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setMedicationView('issued')}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: '1px solid #10b981',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                Issued
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto', flex: 1 }}>
            {medications.length > 0 ? (
              medications
                .filter(med => med['Request Item Status'] === 'Issued')
                .slice(0, 5)
                .map((med, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '8px', 
                      background: '#f9fafb', 
                      borderRadius: '4px',
                      borderLeft: `2px solid #10b981`,
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => setOpenModal('medications')}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f3f4f6';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#f9fafb';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '4px', color: '#111827' }}>
                      {med['Medication Issues Name, Dosage and Quantity']}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '2px' }}>
                      {med['Medication Requests Request Date']}
                    </div>
                    <div style={{ 
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: med['Request Item Status'] === 'Issued' ? '#d1fae5' : '#fef3c7',
                      color: med['Request Item Status'] === 'Issued' ? '#065f46' : '#92400e'
                    }}>
                      {med['Request Item Status'] || med['Medication Requests Request Status']}
                    </div>
                    {med['Medication Requests Request Query'] && (
                      <div style={{ color: '#374151', fontSize: '11px', marginTop: '4px', fontStyle: 'italic' }}>
                        Note: {med['Medication Requests Request Query']}
                      </div>
                    )}
                  </div>
                ))
              ) : (
              <div style={{ 
                padding: '12px', 
                color: '#6b7280', 
                fontSize: '12px', 
                textAlign: 'center',
                background: '#f9fafb',
                borderRadius: '4px'
              }}>
                {patientInfo ? 'No issued medications found' : 'Select a call to view medications'}
              </div>
            )}
          </div>
          {medications.length > 0 && (
            <div 
              onClick={() => setOpenModal('medications')}
              style={{ 
                marginTop: '8px',
                padding: '6px',
                textAlign: 'center',
                fontSize: '11px',
                color: '#6b7280',
                fontWeight: 500,
                cursor: 'pointer',
                borderRadius: '4px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
                e.currentTarget.style.color = '#374151';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#6b7280';
              }}
            >
              View all →
            </div>
          )}
        </div>
        
        </div>
      </div>

      {/* Modal Overlay - Data Modals (Appointments, Calls & Medications) */}
      {openModal && (openModal === 'appointments' || openModal === 'calls' || openModal === 'medications') && (
        <div 
          onClick={() => setOpenModal(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              maxWidth: '1200px',
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                {openModal === 'appointments' && '📅 All Appointments'}
                {openModal === 'calls' && '📞 All Calls'}
                {openModal === 'medications' && '💊 All Medications'}
                {patientInfo && (
                  <span style={{ fontSize: '14px', fontWeight: 400, color: '#6b7280', marginLeft: '12px' }}>
                    {patientInfo.name}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setOpenModal(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: '0 8px',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflow: 'auto',
              flex: 1
            }}>
              {openModal === 'appointments' ? (
                // Appointments Modal
                allAppointmentsData.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {allAppointmentsData.map((apt, idx) => (
                      <div key={apt['Slot ID'] || idx} style={{
                        padding: '16px',
                        background: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px', fontSize: '13px' }}>
                          <div style={{ fontWeight: 600, color: '#374151' }}>Date:</div>
                          <div style={{ color: '#1f2937' }}>{apt['Appointment Date'] || 'N/A'}</div>

                          <div style={{ fontWeight: 600, color: '#374151' }}>Time:</div>
                          <div style={{ color: '#1f2937' }}>{apt['Appointment Time'] || 'N/A'}</div>

                          <div style={{ fontWeight: 600, color: '#374151' }}>Current Slot Status:</div>
                          <div style={{ color: '#1f2937' }}>{apt['Current Slot Status'] || 'N/A'}</div>

                          <div style={{ fontWeight: 600, color: '#374151' }}>Slot Type:</div>
                          <div style={{ color: '#1f2937' }}>{apt['Slot Type'] || 'N/A'}</div>

                          <div style={{ fontWeight: 600, color: '#374151' }}>Session Holder:</div>
                          <div style={{ color: '#1f2937' }}>{apt['Session Holders Full Name'] || 'N/A'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ 
                    padding: '40px', 
                    textAlign: 'center', 
                    color: '#6b7280',
                    fontSize: '14px'
                  }}>
                    No appointments found
                  </div>
                )
              ) : openModal === 'medications' ? (
                // Medications Modal
                allMedicationsData.length > 0 ? (
                  <>
                    {/* Filters (Issued only) */}
                    <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setMedicationView('issued')}
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          borderRadius: '8px',
                          border: '1px solid #10b981',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: 'white',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Issued
                      </button>
                    </div>

                    {/* Medications List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {allMedicationsData
                        .filter(med => med['Request Item Status'] === 'Issued')
                        .map((med, idx) => (
                          <div key={idx} style={{
                            padding: '16px',
                            background: '#f9fafb',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb'
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px', fontSize: '13px' }}>
                              <div style={{ fontWeight: 600, color: '#374151' }}>Medication:</div>
                              <div style={{ color: '#1f2937', fontWeight: 600 }}>
                                {med['Medication Issues Name, Dosage and Quantity'] || 'N/A'}
                              </div>

                              <div style={{ fontWeight: 600, color: '#374151' }}>Request Date:</div>
                              <div style={{ color: '#1f2937' }}>{med['Medication Requests Request Date'] || 'N/A'}</div>

                              <div style={{ fontWeight: 600, color: '#374151' }}>Status:</div>
                              <div>
                                <span style={{ 
                                  display: 'inline-block',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  background: med['Request Item Status'] === 'Issued' ? '#d1fae5' : '#fef3c7',
                                  color: med['Request Item Status'] === 'Issued' ? '#065f46' : '#92400e'
                                }}>
                                  {med['Request Item Status'] || med['Medication Requests Request Status'] || 'Unknown'}
                                </span>
                              </div>

                              {med['Medication Requests Request Query'] && (
                                <>
                                  <div style={{ fontWeight: 600, color: '#374151' }}>Query/Note:</div>
                                  <div style={{ color: '#1f2937', fontStyle: 'italic' }}>
                                    {med['Medication Requests Request Query']}
                                  </div>
                                </>
                              )}

                              {med['Rejection Reason'] && (
                                <>
                                  <div style={{ fontWeight: 600, color: '#dc2626' }}>Rejection Reason:</div>
                                  <div style={{ color: '#dc2626', fontWeight: 500 }}>
                                    {med['Rejection Reason']}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      {allMedicationsData.filter(med => med['Request Item Status'] === 'Issued').length === 0 && (
                        <div style={{ 
                          padding: '40px', 
                          textAlign: 'center', 
                          color: '#6b7280',
                          fontSize: '14px'
                        }}>
                          No issued medications found
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ 
                    padding: '40px', 
                    textAlign: 'center', 
                    color: '#6b7280',
                    fontSize: '14px'
                  }}>
                    No medications found
                  </div>
                )
              ) : (
                // Calls Modal
                allCallsData.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {allCallsData.map((call, idx) => {
                      const callDate = call.started_at ? new Date(call.started_at) : null;
                      const endDate = call.ended_at ? new Date(call.ended_at) : null;
                      const dateStr = callDate ? callDate.toLocaleDateString('en-GB') : 'Unknown';
                      const timeStr = callDate ? callDate.toLocaleTimeString('en-GB') : '';
                      const endTimeStr = endDate ? endDate.toLocaleTimeString('en-GB') : '';
                      const durationStr = call.talk_sec ? `${Math.floor(call.talk_sec / 60)}m ${call.talk_sec % 60}s` : 'N/A';
                      
                      return (
                        <div key={call.id || idx} style={{
                          padding: '16px',
                          background: '#f9fafb',
                          borderRadius: '6px',
                          border: '1px solid #e5e7eb'
                        }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 16px', fontSize: '13px' }}>
                            <div style={{ fontWeight: 600, color: '#374151' }}>Date & Time:</div>
                            <div style={{ color: '#1f2937' }}>{dateStr} {timeStr}</div>

                            <div style={{ fontWeight: 600, color: '#374151' }}>Duration:</div>
                            <div style={{ color: '#1f2937' }}>{durationStr}</div>

                            <div style={{ fontWeight: 600, color: '#374151' }}>Handler:</div>
                            <div style={{ color: '#1f2937' }}>{call.agent_user_name || 'Unknown'}</div>

                            {call.reason_for_call && (
                              <>
                                <div style={{ fontWeight: 600, color: '#374151' }}>Reason:</div>
                                <div style={{ color: '#1f2937' }}>{call.reason_for_call}</div>
                              </>
                            )}

                            {call.outcome_summary && (
                              <>
                                <div style={{ fontWeight: 600, color: '#374151' }}>Summary:</div>
                                <div style={{ color: '#1f2937' }}>{call.outcome_summary}</div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ 
                    padding: '40px', 
                    textAlign: 'center', 
                    color: '#6b7280',
                    fontSize: '14px'
                  }}>
                    No calls found
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Overlay - Action Modals (nearly full screen, blank) */}
      {openModal && openModal.startsWith('action_') && (
        <div 
          onClick={() => setOpenModal(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(17, 24, 39, 0.75)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(255, 255, 255, 0.98)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              borderRadius: '16px',
              width: '95vw',
              height: '95vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.8)',
              animation: 'slideUp 0.3s ease-out'
            }}
          >
            {/* Modal Header */}
            <div style={{
              padding: '24px 28px',
              borderBottom: '1px solid rgba(229, 231, 235, 0.8)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.95), rgba(249,250,251,0.95))'
            }}>
              <h2 style={{ 
                margin: 0, 
                fontSize: '20px', 
                fontWeight: 600, 
                color: '#111827',
                letterSpacing: '-0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                {openModal === 'action_look_for_appointment_slot' && <><span>🔎</span><span>Look for appointment slot</span></>}
                {openModal === 'action_sample_checker' && <><span>🧪</span><span>Sample Checker</span></>}
                {openModal === 'action_duty_dr_query' && <><span>📨</span><span>Duty Dr Query</span></>}
                {openModal === 'action_call_history' && <><span>📜</span><span>Call History</span></>}
                {openModal === 'action_placeholder_3' && <><span>⚙️</span><span>Action 3</span></>}
              </h2>
              <button
                onClick={() => setOpenModal(null)}
                style={{
                  background: 'rgba(243, 244, 246, 0.8)',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  padding: '8px 12px',
                  lineHeight: 1,
                  borderRadius: '8px',
                  fontWeight: 500,
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(229, 231, 235, 1)';
                  e.currentTarget.style.color = '#374151';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(243, 244, 246, 0.8)';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '20px',
              overflow: 'auto',
              flex: 1
            }}>
              {openModal === 'action_look_for_appointment_slot' ? (
                // COMPLETELY REDESIGNED Slot Finder
                <div style={{ display: 'flex', height: '100%', gap: '0', overflow: 'hidden' }}>
                  {/* LEFT SIDEBAR - Filters */}
                  <div style={{
                    width: '320px',
                    background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                    borderRight: '1px solid rgba(226, 232, 240, 0.8)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}>
                    {/* Sidebar Header */}
                    <div style={{
                      padding: '24px 20px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                      color: 'white',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      <h3 style={{ 
                        margin: '0 0 8px 0', 
                        fontSize: '18px', 
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                      }}>
                        <span style={{ fontSize: '24px' }}>⚙️</span>
                        <span>Filters</span>
                      </h3>
                      <p style={{ margin: 0, fontSize: '13px', opacity: 0.9, fontWeight: 400 }}>
                        Customize your search
                      </p>
                    </div>

                    {/* Mode Toggle - Full Width Pills */}
                    <div style={{ padding: '20px', background: 'white', borderBottom: '1px solid #e2e8f0' }}>
                      <label style={{ 
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#64748b',
                        marginBottom: '10px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Provider Type
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => {
                            setSlotFinderMode('gp');
                            setAvailableSlots([]);
                          }}
                          style={{
                            flex: 1,
                            padding: '14px 20px',
                            borderRadius: '12px',
                            border: slotFinderMode === 'gp' ? '2px solid #6366f1' : '2px solid transparent',
                            background: slotFinderMode === 'gp' 
                              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                              : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            color: slotFinderMode === 'gp' ? 'white' : '#64748b',
                            fontWeight: 700,
                            fontSize: '14px',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: slotFinderMode === 'gp' ? '0 4px 12px rgba(99, 102, 241, 0.3)' : 'none'
                          }}
                          onMouseEnter={(e) => {
                            if (slotFinderMode !== 'gp') {
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            if (slotFinderMode !== 'gp') {
                              e.currentTarget.style.boxShadow = 'none';
                            }
                          }}
                        >
                          <span style={{ fontSize: '28px' }}>👨‍⚕️</span>
                          <span>GPs</span>
                        </button>
                        <button
                          onClick={() => {
                            setSlotFinderMode('nurse');
                            setAvailableSlots([]);
                          }}
                          style={{
                            flex: 1,
                            padding: '14px 20px',
                            borderRadius: '12px',
                            border: slotFinderMode === 'nurse' ? '2px solid #6366f1' : '2px solid transparent',
                            background: slotFinderMode === 'nurse' 
                              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                              : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                            color: slotFinderMode === 'nurse' ? 'white' : '#64748b',
                            fontWeight: 700,
                            fontSize: '14px',
                            cursor: 'pointer',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: slotFinderMode === 'nurse' ? '0 4px 12px rgba(99, 102, 241, 0.3)' : 'none'
                          }}
                          onMouseEnter={(e) => {
                            if (slotFinderMode !== 'nurse') {
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            if (slotFinderMode !== 'nurse') {
                              e.currentTarget.style.boxShadow = 'none';
                            }
                          }}
                        >
                          <span style={{ fontSize: '28px' }}>👩‍⚕️</span>
                          <span>Nurses</span>
                        </button>
                      </div>
                    </div>

                    {/* Scrollable Filter Content */}
                    <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
                      {/* Slot Types */}
                      <div style={{ marginBottom: '28px' }}>
                        <label style={{ 
                          display: 'block',
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#64748b',
                          marginBottom: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        }}>
                          Slot Types
                        </label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {slotFinderMode === 'gp' ? (
                            ['Appointment Within 1 Week', 'Appointment 1 to 2 Weeks', 'Book on the Day', 'Telephone Appointment Slot'].map(type => (
                              <label 
                                key={type}
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '10px',
                                  cursor: 'pointer',
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  background: selectedSlotTypes[type] ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)' : 'white',
                                  border: '1px solid ' + (selectedSlotTypes[type] ? '#c4b5fd' : '#e2e8f0'),
                                  transition: 'all 0.2s ease',
                                  boxShadow: selectedSlotTypes[type] ? '0 2px 4px rgba(139, 92, 246, 0.15)' : 'none'
                                }}
                                onMouseEnter={(e) => {
                                  if (!selectedSlotTypes[type]) {
                                    e.currentTarget.style.background = '#fafafa';
                                    e.currentTarget.style.borderColor = '#cbd5e1';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!selectedSlotTypes[type]) {
                                    e.currentTarget.style.background = 'white';
                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                  }
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSlotTypes[type] || false}
                                  onChange={(e) => setSelectedSlotTypes(prev => ({ ...prev, [type]: e.target.checked }))}
                                  style={{ 
                                    width: '18px', 
                                    height: '18px', 
                                    cursor: 'pointer',
                                    accentColor: '#8b5cf6'
                                  }}
                                />
                                <span style={{ 
                                  fontSize: '13px', 
                                  fontWeight: selectedSlotTypes[type] ? 600 : 400,
                                  color: selectedSlotTypes[type] ? '#5b21b6' : '#334155',
                                  flex: 1
                                }}>
                                  {type}
                                </span>
                              </label>
                            ))
                          ) : (
                            [
                              'ANNUAL REVIEW MULTIPLE',
                              'Appointment 1 to 2 Weeks',
                              'Appointment Within 1 Week',
                              'Asthma Reviews due',
                              'B12',
                              'Baby Imms',
                              'Blood Clinic',
                              'Blood Pressure due',
                              'CHD review',
                              'COPD review',
                              'Child or Pregnant Flu',
                              'Diabetes review',
                              'ECG',
                              'Flu Clinic',
                              'HYPERTEN ANNUAL REVIEW',
                              'HYPERTEN OR CKD REVIEW',
                              'Interface Type 2 Diabetes',
                              'Keep Well Health Check',
                              'NHS Health Check',
                              'PILL CHECK',
                              'Prebookable',
                              'RSV Vaccine',
                              'Smear',
                              'Spirometry',
                              'Spirometry and FeNO',
                              'Vaccine Clinic',
                              'Wellbeing Check',
                              'Wound Check',
                              'ZOLADEX HORMONE INJECTION'
                            ].map(type => (
                              <label 
                                key={type}
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '10px',
                                  cursor: 'pointer',
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  background: selectedNurseSlotTypes[type] ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)' : 'white',
                                  border: '1px solid ' + (selectedNurseSlotTypes[type] ? '#c4b5fd' : '#e2e8f0'),
                                  transition: 'all 0.2s ease',
                                  boxShadow: selectedNurseSlotTypes[type] ? '0 2px 4px rgba(139, 92, 246, 0.15)' : 'none'
                                }}
                                onMouseEnter={(e) => {
                                  if (!selectedNurseSlotTypes[type]) {
                                    e.currentTarget.style.background = '#fafafa';
                                    e.currentTarget.style.borderColor = '#cbd5e1';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!selectedNurseSlotTypes[type]) {
                                    e.currentTarget.style.background = 'white';
                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                  }
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedNurseSlotTypes[type] || false}
                                  onChange={(e) => setSelectedNurseSlotTypes(prev => ({ ...prev, [type]: e.target.checked }))}
                                  style={{ 
                                    width: '18px', 
                                    height: '18px', 
                                    cursor: 'pointer',
                                    accentColor: '#8b5cf6'
                                  }}
                                />
                                <span style={{ 
                                  fontSize: '13px', 
                                  fontWeight: selectedNurseSlotTypes[type] ? 600 : 400,
                                  color: selectedNurseSlotTypes[type] ? '#5b21b6' : '#334155',
                                  flex: 1
                                }}>
                                  {type}
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Session Holders */}
                      {availableSlots.length > 0 && (
                        <div>
                          <label style={{ 
                            display: 'block',
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#64748b',
                            marginBottom: '12px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            Session Holder
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {[...new Set(availableSlots.map(s => s['Full Name of the Session Holder of the Session']))].sort().map(holder => (
                              <label 
                                key={holder}
                                style={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '10px',
                                  cursor: 'pointer',
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  background: selectedSessionHolders[holder] ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)' : 'white',
                                  border: '1px solid ' + (selectedSessionHolders[holder] ? '#c4b5fd' : '#e2e8f0'),
                                  transition: 'all 0.2s ease',
                                  boxShadow: selectedSessionHolders[holder] ? '0 2px 4px rgba(139, 92, 246, 0.15)' : 'none'
                                }}
                                onMouseEnter={(e) => {
                                  if (!selectedSessionHolders[holder]) {
                                    e.currentTarget.style.background = '#fafafa';
                                    e.currentTarget.style.borderColor = '#cbd5e1';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!selectedSessionHolders[holder]) {
                                    e.currentTarget.style.background = 'white';
                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                  }
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedSessionHolders[holder] || false}
                                  onChange={(e) => setSelectedSessionHolders(prev => ({ ...prev, [holder]: e.target.checked }))}
                                  style={{ 
                                    width: '18px', 
                                    height: '18px', 
                                    cursor: 'pointer',
                                    accentColor: '#8b5cf6'
                                  }}
                                />
                                <span style={{ 
                                  fontSize: '13px', 
                                  fontWeight: selectedSessionHolders[holder] ? 600 : 400,
                                  color: selectedSessionHolders[holder] ? '#5b21b6' : '#334155',
                                  flex: 1
                                }}>
                                  {holder || 'Unknown'}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT CONTENT - Results & View Toggle */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Top Bar with View Toggle & Stats */}
                    <div style={{
                      padding: '16px 24px',
                      background: 'linear-gradient(180deg, white 0%, #fafafa 100%)',
                      borderBottom: '1px solid #e2e8f0',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      {/* Stats */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{
                          padding: '10px 16px',
                          background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                          border: '1px solid #86efac',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span style={{ fontSize: '20px' }}>📊</span>
                          <div>
                            <div style={{ fontSize: '20px', fontWeight: 700, color: '#166534', lineHeight: 1 }}>
                              {availableSlots.filter(slot => {
                                const enabledHolders = Object.keys(selectedSessionHolders).filter(k => selectedSessionHolders[k]);
                                if (enabledHolders.length === 0) return true;
                                return enabledHolders.includes(slot['Full Name of the Session Holder of the Session']);
                              }).length}
                            </div>
                            <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>
                              Available
                            </div>
                          </div>
                        </div>

                        {loadingSlots && (
                          <div style={{
                            padding: '10px 16px',
                            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                            border: '1px solid #fde047',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            animation: 'pulse 2s ease-in-out infinite'
                          }}>
                            <span style={{ fontSize: '20px', animation: 'spin 2s linear infinite' }}>⏳</span>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#713f12' }}>Searching slots...</span>
                          </div>
                        )}
                      </div>

                      {/* View Toggle - Compact Pills */}
                      <div style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '6px',
                        background: '#f1f5f9',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0'
                      }}>
                        <button
                          onClick={() => setSlotFinderView('list')}
                          style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: 'none',
                            background: slotFinderView === 'list' 
                              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                              : 'transparent',
                            color: slotFinderView === 'list' ? 'white' : '#64748b',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: slotFinderView === 'list' ? '0 2px 8px rgba(99, 102, 241, 0.3)' : 'none'
                          }}
                        >
                          <span>📋</span>
                          <span>List</span>
                        </button>
                        <button
                          onClick={() => setSlotFinderView('calendar')}
                          style={{
                            padding: '10px 20px',
                            borderRadius: '8px',
                            border: 'none',
                            background: slotFinderView === 'calendar' 
                              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                              : 'transparent',
                            color: slotFinderView === 'calendar' ? 'white' : '#64748b',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: slotFinderView === 'calendar' ? '0 2px 8px rgba(99, 102, 241, 0.3)' : 'none'
                          }}
                        >
                          <span>📅</span>
                          <span>Calendar</span>
                        </button>
                      </div>
                    </div>

                    {/* Results Area */}
                    <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: '#fafafa' }}>
                      {slotFinderView === 'list' ? (
                        // MODERN LIST VIEW
                        availableSlots.filter(slot => {
                          const enabledHolders = Object.keys(selectedSessionHolders).filter(k => selectedSessionHolders[k]);
                          if (enabledHolders.length === 0) return true;
                          return enabledHolders.includes(slot['Full Name of the Session Holder of the Session']);
                        }).length > 0 ? (
                          <div style={{ display: 'grid', gap: '12px' }}>
                            {availableSlots
                              .filter(slot => {
                                const enabledHolders = Object.keys(selectedSessionHolders).filter(k => selectedSessionHolders[k]);
                                if (enabledHolders.length === 0) return true;
                                return enabledHolders.includes(slot['Full Name of the Session Holder of the Session']);
                              })
                              .map((slot, idx) => (
                                <div 
                                  key={idx}
                                  style={{
                                    background: 'linear-gradient(135deg, white 0%, #fefefe 100%)',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '14px',
                                    padding: '18px 22px',
                                    display: 'grid',
                                    gridTemplateColumns: '140px 90px 1fr 220px',
                                    gap: '20px',
                                    alignItems: 'center',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    cursor: 'pointer',
                                    position: 'relative',
                                    overflow: 'hidden'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.005)';
                                    e.currentTarget.style.boxShadow = '0 12px 24px rgba(99, 102, 241, 0.15)';
                                    e.currentTarget.style.borderColor = '#8b5cf6';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                    e.currentTarget.style.boxShadow = 'none';
                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                  }}
                                >
                                  {/* Subtle gradient overlay on hover */}
                                  <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(139, 92, 246, 0.03) 100%)',
                                    opacity: 0,
                                    transition: 'opacity 0.3s ease',
                                    pointerEvents: 'none'
                                  }}></div>
                                  
                                  <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#64748b', 
                                      fontWeight: 600,
                                      marginBottom: '4px',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Date
                                    </div>
                                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                                      {slot['Appointment Date']}
                                    </div>
                                  </div>

                                  <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#64748b', 
                                      fontWeight: 600,
                                      marginBottom: '4px',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Time
                                    </div>
                                    <div style={{
                                      fontSize: '16px',
                                      fontWeight: 700,
                                      color: 'white',
                                      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                      padding: '6px 14px',
                                      borderRadius: '8px',
                                      display: 'inline-block',
                                      boxShadow: '0 2px 8px rgba(99, 102, 241, 0.25)'
                                    }}>
                                      {slot['Appointment Time']}
                                    </div>
                                  </div>

                                  <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#64748b', 
                                      fontWeight: 600,
                                      marginBottom: '4px',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Type
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}>
                                      {slot['Slot Type']}
                                    </div>
                                  </div>

                                  <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ 
                                      fontSize: '13px', 
                                      color: '#64748b', 
                                      fontWeight: 600,
                                      marginBottom: '4px',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Provider
                                    </div>
                                    <div style={{ 
                                      fontSize: '14px', 
                                      color: '#1e293b', 
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px'
                                    }}>
                                      <span>{slotFinderMode === 'gp' ? '👨‍⚕️' : '👩‍⚕️'}</span>
                                      <span>{slot['Full Name of the Session Holder of the Session']}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: '#94a3b8'
                          }}>
                            <div style={{ fontSize: '80px', marginBottom: '20px', opacity: 0.3 }}>📅</div>
                            <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: '#64748b' }}>
                              {loadingSlots ? 'Searching for slots...' : 'No slots found'}
                            </div>
                            <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                              {loadingSlots ? 'Please wait' : 'Try adjusting your filters'}
                            </div>
                          </div>
                        )
                      ) : (
                        // MODERN CALENDAR VIEW
                        (() => {
                          const filteredSlots = availableSlots.filter(slot => {
                            const enabledHolders = Object.keys(selectedSessionHolders).filter(k => selectedSessionHolders[k]);
                            if (enabledHolders.length === 0) return true;
                            return enabledHolders.includes(slot['Full Name of the Session Holder of the Session']);
                          });

                          const groupedByDate = filteredSlots.reduce((acc, slot) => {
                            const date = slot['Appointment Date'];
                            if (!acc[date]) acc[date] = [];
                            acc[date].push(slot);
                            return acc;
                          }, {});

                          const dates = Object.keys(groupedByDate).sort();

                          return dates.length > 0 ? (
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                              gap: '16px'
                            }}>
                              {dates.map((date, idx) => (
                                <div 
                                  key={date}
                                  style={{
                                    background: 'linear-gradient(180deg, white 0%, #fefefe 100%)',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '16px',
                                    padding: '20px',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    cursor: 'pointer',
                                    minHeight: '160px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    animation: `fadeInUp 0.4s ease-out ${idx * 0.05}s both`
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-6px) scale(1.02)';
                                    e.currentTarget.style.boxShadow = '0 16px 32px rgba(99, 102, 241, 0.15)';
                                    e.currentTarget.style.borderColor = '#8b5cf6';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                    e.currentTarget.style.boxShadow = 'none';
                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                  }}
                                >
                                  <div style={{
                                    fontSize: '16px',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    marginBottom: '12px',
                                    paddingBottom: '12px',
                                    borderBottom: '3px solid #6366f1'
                                  }}>
                                    {date}
                                  </div>
                                  <div style={{
                                    fontSize: '28px',
                                    fontWeight: 800,
                                    color: '#6366f1',
                                    marginBottom: '8px'
                                  }}>
                                    {groupedByDate[date].length}
                                  </div>
                                  <div style={{
                                    fontSize: '12px',
                                    color: '#64748b',
                                    fontWeight: 600,
                                    marginBottom: '12px'
                                  }}>
                                    {groupedByDate[date].length === 1 ? 'slot available' : 'slots available'}
                                  </div>
                                  <div style={{
                                    marginTop: 'auto',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '6px'
                                  }}>
                                    {groupedByDate[date].slice(0, 3).map((slot, sidx) => (
                                      <div key={sidx} style={{
                                        padding: '4px 10px',
                                        background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                                        color: '#5b21b6',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        borderRadius: '6px',
                                        border: '1px solid #c4b5fd'
                                      }}>
                                        {slot['Appointment Time']}
                                      </div>
                                    ))}
                                    {groupedByDate[date].length > 3 && (
                                      <div style={{
                                        padding: '4px 10px',
                                        background: '#f1f5f9',
                                        color: '#64748b',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        borderRadius: '6px',
                                        border: '1px solid #cbd5e1'
                                      }}>
                                        +{groupedByDate[date].length - 3}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '100%',
                              color: '#94a3b8'
                            }}>
                              <div style={{ fontSize: '80px', marginBottom: '20px', opacity: 0.3 }}>📅</div>
                              <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: '#64748b' }}>
                                {loadingSlots ? 'Searching for slots...' : 'No slots found'}
                              </div>
                              <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                                {loadingSlots ? 'Please wait' : 'Try adjusting your filters'}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                </div>
              ) : openModal === 'action_duty_dr_query' ? (
                // Duty Dr Query - Recent Call with Dropdown
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
                  {/* Info Banner with Call Selector */}
                  <div style={{
                    padding: '20px 24px',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    borderRadius: '12px',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.2)'
                  }}>
                    <div style={{ 
                      fontSize: '40px',
                      lineHeight: 1,
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))'
                    }}>📞</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        fontWeight: 600, 
                        fontSize: '18px', 
                        marginBottom: '4px',
                        letterSpacing: '-0.01em'
                      }}>
                        Call Details
                      </div>
                      <div style={{ 
                        fontSize: '14px', 
                        opacity: 0.9,
                        fontWeight: 400
                      }}>
                        Viewing call from X-on platform
                      </div>
                    </div>
                    {loadingXonCalls && (
                      <div style={{ 
                        fontSize: '14px',
                        padding: '6px 12px',
                        background: 'rgba(255,255,255,0.2)',
                        borderRadius: '6px',
                        fontWeight: 500
                      }}>
                        ⏳ Loading...
                      </div>
                    )}
                  </div>

                  {/* Call Selector Dropdown */}
                  {xonCalls.length > 1 && (
                    <div style={{
                      background: 'rgba(249, 250, 251, 0.6)',
                      border: '1px solid rgba(229, 231, 235, 0.8)',
                      borderRadius: '12px',
                      padding: '16px 20px'
                    }}>
                      <label style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '14px', 
                        fontWeight: 600, 
                        color: '#374151',
                        marginBottom: '10px',
                        letterSpacing: '-0.01em'
                      }}>
                        <span>📋</span>
                        <span>Select a different call:</span>
                      </label>
                      <select
                        value={selectedXonCall?.id || ''}
                        onChange={(e) => {
                          const call = xonCalls.find(c => c.id === parseInt(e.target.value));
                          setSelectedXonCall(call);
                          addDebug({ type: 'xon_call_selected', callId: e.target.value });
                        }}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          fontSize: '14px',
                          borderRadius: '10px',
                          border: '1px solid #d1d5db',
                          background: 'white',
                          cursor: 'pointer',
                          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                          outline: 'none',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {xonCalls.map((call) => {
                          const startTime = call.start_time ? new Date(call.start_time) : null;
                          const dateStr = startTime ? startTime.toLocaleDateString('en-GB') : 'Unknown';
                          const timeStr = startTime ? startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                          const callerNumber = call.caller?.number || call.dialled?.number || 'Unknown';
                          const agentName = call.agent?.name || 'Unknown Agent';
                          
                          return (
                            <option key={call.id} value={call.id}>
                              {callerNumber} • {agentName} • {dateStr} {timeStr}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {/* Selected Call Display */}
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    {loadingXonCalls ? (
                      <div style={{
                        padding: '60px 20px',
                        textAlign: 'center',
                        color: '#9ca3af',
                        fontSize: '14px'
                      }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📡</div>
                        <div>Fetching calls from X-on API...</div>
                      </div>
                    ) : selectedXonCall ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {(() => {
                          const call = selectedXonCall;
                          // Parse call details
                          const startTime = call.start_time ? new Date(call.start_time) : null;
                          const endTime = call.end_time ? new Date(call.end_time) : null;
                          const dateStr = startTime ? startTime.toLocaleDateString('en-GB') : 'Unknown';
                          const timeStr = startTime ? startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
                          
                          // Calculate duration
                          let durationStr = 'N/A';
                          if (startTime && endTime) {
                            const durationSec = Math.floor((endTime - startTime) / 1000);
                            const mins = Math.floor(durationSec / 60);
                            const secs = durationSec % 60;
                            durationStr = `${mins}m ${secs}s`;
                          }

                          return (
                            <div key={call.id} style={{
                              background: 'linear-gradient(to bottom, white, rgba(249, 250, 251, 0.5))',
                              border: '1px solid rgba(229, 231, 235, 0.8)',
                              borderRadius: '12px',
                              padding: '20px',
                              transition: 'all 0.3s ease',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.boxShadow = '0 8px 16px rgba(59, 130, 246, 0.12)';
                              e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                              e.currentTarget.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.04)';
                              e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                              e.currentTarget.style.transform = 'translateY(0)';
                            }}
                            >
                              {/* Header Row */}
                              <div style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center',
                                marginBottom: '16px',
                                paddingBottom: '16px',
                                borderBottom: '1px solid rgba(243, 244, 246, 0.8)'
                              }}>
                                <div>
                                  <div style={{ 
                                    fontSize: '17px', 
                                    fontWeight: 600, 
                                    color: '#111827', 
                                    marginBottom: '6px',
                                    letterSpacing: '-0.01em'
                                  }}>
                                    Call #{call.id}
                                  </div>
                                  <div style={{ 
                                    fontSize: '14px', 
                                    color: '#6b7280',
                                    fontWeight: 400
                                  }}>
                                    {dateStr} at {timeStr}
                                  </div>
                                </div>
                                <div style={{
                                  padding: '8px 14px',
                                  background: call.outcome === 'CALLER_CLEAR' 
                                    ? 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)' 
                                    : 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                                  color: call.outcome === 'CALLER_CLEAR' ? '#1e40af' : '#6b7280',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  border: `1px solid ${call.outcome === 'CALLER_CLEAR' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(209, 213, 219, 0.5)'}`
                                }}>
                                  {call.outcome || 'Unknown'}
                                </div>
                              </div>

                              {/* Details Grid */}
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr',
                                gap: '8px 16px',
                                fontSize: '13px'
                              }}>
                                <div style={{ color: '#6b7280', fontWeight: 500 }}>Direction:</div>
                                <div style={{ color: '#1f2937', fontWeight: 500 }}>
                                  {call.direction === 'INBOUND' ? '📥 Inbound' : '📤 Outbound'}
                                </div>

                                <div style={{ color: '#6b7280', fontWeight: 500 }}>Duration:</div>
                                <div style={{ color: '#1f2937', fontWeight: 500 }}>{durationStr}</div>

                                {call.caller?.number && (
                                  <>
                                    <div style={{ color: '#6b7280', fontWeight: 500 }}>Caller:</div>
                                    <div style={{ color: '#1f2937', fontWeight: 500 }}>{call.caller.number}</div>
                                  </>
                                )}

                                {call.dialled?.number && (
                                  <>
                                    <div style={{ color: '#6b7280', fontWeight: 500 }}>Dialled:</div>
                                    <div style={{ color: '#1f2937', fontWeight: 500 }}>{call.dialled.number}</div>
                                  </>
                                )}

                                {call.agent?.name && (
                                  <>
                                    <div style={{ color: '#6b7280', fontWeight: 500 }}>Agent:</div>
                                    <div style={{ color: '#1f2937', fontWeight: 500 }}>{call.agent.name}</div>
                                  </>
                                )}

                                {call.type && (
                                  <>
                                    <div style={{ color: '#6b7280', fontWeight: 500 }}>Type:</div>
                                    <div style={{ color: '#1f2937', fontWeight: 500 }}>{call.type}</div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Generate Duty Query Button */}
                        <div style={{ marginTop: '20px' }}>
                          <button
                            onClick={generateDutyQuery}
                            disabled={generatingQuery || !selectedXonCall}
                            style={{
                              width: '100%',
                              padding: '16px 24px',
                              background: generatingQuery 
                                ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)' 
                                : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '12px',
                              fontSize: '15px',
                              fontWeight: 600,
                              cursor: generatingQuery || !selectedXonCall ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '12px',
                              transition: 'all 0.3s ease',
                              boxShadow: generatingQuery ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.3)',
                              letterSpacing: '-0.01em'
                            }}
                            onMouseEnter={(e) => {
                              if (!generatingQuery && selectedXonCall) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 8px 20px rgba(16, 185, 129, 0.4)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = generatingQuery ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.3)';
                            }}
                          >
                            {generatingQuery ? (
                              <>
                                {queryGenerationStep === 'transcribing' && (
                                  <>
                                    <span style={{ 
                                      display: 'inline-block',
                                      animation: 'spin 1s linear infinite'
                                    }}>🎤</span>
                                    <span>Transcribing audio...</span>
                                  </>
                                )}
                                {queryGenerationStep === 'generating' && (
                                  <>
                                    <span style={{ 
                                      display: 'inline-block',
                                      animation: 'pulse 1.5s ease-in-out infinite'
                                    }}>✍️</span>
                                    <span>Writing query...</span>
                                  </>
                                )}
                                {!queryGenerationStep && (
                                  <>
                                    <span style={{ 
                                      display: 'inline-block',
                                      animation: 'spin 1s linear infinite'
                                    }}>⏳</span>
                                    <span>Processing...</span>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <span>🤖</span>
                                <span>Generate Duty Doctor Query</span>
                              </>
                            )}
                          </button>
                          <style>{`
                            @keyframes spin {
                              from { transform: rotate(0deg); }
                              to { transform: rotate(360deg); }
                            }
                            @keyframes pulse {
                              0%, 100% { opacity: 1; transform: scale(1); }
                              50% { opacity: 0.7; transform: scale(1.1); }
                            }
                            @keyframes fadeIn {
                              from { opacity: 0; }
                              to { opacity: 1; }
                            }
                            @keyframes fadeInUp {
                              from { 
                                opacity: 0;
                                transform: translateY(30px); 
                              }
                              to { 
                                opacity: 1;
                                transform: translateY(0); 
                              }
                            }
                            @keyframes slideUp {
                              from { 
                                opacity: 0;
                                transform: translateY(20px) scale(0.98); 
                              }
                              to { 
                                opacity: 1;
                                transform: translateY(0) scale(1); 
                              }
                            }
                            @keyframes slideInRight {
                              from {
                                opacity: 0;
                                transform: translateX(100px);
                              }
                              to {
                                opacity: 1;
                                transform: translateX(0);
                              }
                            }
                            @keyframes slideOutRight {
                              from {
                                opacity: 1;
                                transform: translateX(0);
                              }
                              to {
                                opacity: 0;
                                transform: translateX(100px);
                              }
                            }
                          `}</style>
                        </div>

                        {/* Generated Query Display */}
                        {generatedQuery && (
                          <div style={{
                            marginTop: '24px',
                            padding: '24px',
                            background: 'linear-gradient(135deg, rgba(240, 253, 244, 0.9) 0%, rgba(220, 252, 231, 0.8) 100%)',
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                            border: '2px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: '14px',
                            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)'
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
                                color: '#065f46',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                letterSpacing: '-0.01em'
                              }}>
                                <span style={{ fontSize: '20px' }}>✅</span>
                                <span>Generated Duty Doctor Query</span>
                              </h3>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(generatedQuery).then(() => {
                                    // Create a nice toast notification
                                    const toast = document.createElement('div');
                                    toast.textContent = '✓ Copied to clipboard!';
                                    toast.style.cssText = `
                                      position: fixed;
                                      top: 20px;
                                      right: 20px;
                                      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                                      color: white;
                                      padding: 12px 20px;
                                      border-radius: 10px;
                                      font-size: 14px;
                                      font-weight: 600;
                                      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
                                      z-index: 10000;
                                      animation: slideInRight 0.3s ease-out;
                                    `;
                                    document.body.appendChild(toast);
                                    setTimeout(() => {
                                      toast.style.animation = 'slideOutRight 0.3s ease-out';
                                      setTimeout(() => document.body.removeChild(toast), 300);
                                    }, 2000);
                                  }).catch(() => {
                                    // Fallback
                                    const ta = document.createElement('textarea');
                                    ta.value = generatedQuery;
                                    document.body.appendChild(ta);
                                    ta.select();
                                    document.execCommand('copy');
                                    ta.remove();
                                    alert('Query copied to clipboard!');
                                  });
                                }}
                                style={{
                                  padding: '10px 18px',
                                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '10px',
                                  fontSize: '14px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  transition: 'all 0.2s ease',
                                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                                  letterSpacing: '-0.01em'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
                                  e.currentTarget.style.transform = 'translateY(-2px)';
                                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
                                  e.currentTarget.style.transform = 'translateY(0)';
                                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
                                }}
                              >
                                <span>📋</span>
                                <span>Copy Query</span>
                              </button>
                            </div>
                            <div style={{
                              padding: '20px',
                              background: 'rgba(255, 255, 255, 0.9)',
                              borderRadius: '10px',
                              fontSize: '14px',
                              lineHeight: '1.7',
                              color: '#111827',
                              whiteSpace: 'pre-wrap',
                              border: '1px solid rgba(187, 247, 208, 0.5)',
                              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                              fontWeight: 400
                            }}>
                              {generatedQuery}
                            </div>
                            
                            {/* Transcript viewer removed per request - transcript stored in state but not displayed here */}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{
                        padding: '60px 20px',
                        textAlign: 'center',
                        color: '#9ca3af',
                        fontSize: '14px'
                      }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
                        <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px' }}>No calls found</div>
                        <div>No ended calls available from the X-on API</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // Other action modals remain blank
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#d1d5db',
                  fontSize: '16px',
                  height: '100%'
                }}>
                  {openModal === 'action_call_history' && (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* Filters */}
                      <div style={{
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        padding: '20px',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0'
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                          {/* Search */}
                          <input
                            type="text"
                            placeholder="🔍 Search caller, agent, reason..."
                            value={callHistoryFilters.searchTerm}
                            onChange={(e) => setCallHistoryFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                            style={{
                              padding: '10px 14px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '14px',
                              outline: 'none',
                              transition: 'all 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                          />

                          {/* Date From */}
                          <input
                            type="date"
                            value={callHistoryFilters.startDate}
                            onChange={(e) => setCallHistoryFilters(prev => ({ ...prev, startDate: e.target.value }))}
                            style={{
                              padding: '10px 14px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '14px',
                              outline: 'none',
                              transition: 'all 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                          />

                          {/* Date To */}
                          <input
                            type="date"
                            value={callHistoryFilters.endDate}
                            onChange={(e) => setCallHistoryFilters(prev => ({ ...prev, endDate: e.target.value }))}
                            style={{
                              padding: '10px 14px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '14px',
                              outline: 'none',
                              transition: 'all 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                          />

                          {/* Direction Filter */}
                          <select
                            value={callHistoryFilters.directionFilter}
                            onChange={(e) => setCallHistoryFilters(prev => ({ ...prev, directionFilter: e.target.value }))}
                            style={{
                              padding: '10px 14px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '14px',
                              outline: 'none',
                              background: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            <option value="all">All Directions</option>
                            <option value="inbound">📞 Inbound</option>
                            <option value="outbound">📱 Outbound</option>
                          </select>

                          {/* Clear Filters */}
                          <button
                            onClick={() => setCallHistoryFilters({
                              searchTerm: '',
                              agentFilter: '',
                              startDate: '',
                              endDate: '',
                              directionFilter: 'all'
                            })}
                            style={{
                              padding: '10px 14px',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '14px',
                              background: 'white',
                              cursor: 'pointer',
                              fontWeight: 600,
                              color: '#64748b',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = '#f8fafc';
                              e.target.style.borderColor = '#94a3b8';
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = 'white';
                              e.target.style.borderColor = '#cbd5e1';
                            }}
                          >
                            🔄 Clear Filters
                          </button>
                        </div>

                        {/* Results count */}
                        <div style={{ marginTop: '12px', fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                          Showing {callHistory.length} call{callHistory.length !== 1 ? 's' : ''}
                        </div>
                      </div>

                      {/* Call History List */}
                      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {loadingCallHistory ? (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '200px',
                            color: '#94a3b8',
                            fontSize: '14px'
                          }}>
                            Loading call history...
                          </div>
                        ) : callHistory.length === 0 ? (
                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '200px',
                            color: '#94a3b8'
                          }}>
                            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📞</div>
                            <div style={{ fontSize: '16px', fontWeight: 600 }}>No calls found</div>
                            <div style={{ fontSize: '13px', marginTop: '4px' }}>Try adjusting your filters</div>
                          </div>
                        ) : (
                          callHistory.map((call, index) => {
                            const startedAt = call.started_at ? new Date(call.started_at) : null;
                            const endedAt = call.ended_at ? new Date(call.ended_at) : null;
                            const duration = call.talk_sec || 0;
                            const queueTime = call.queue_sec || 0;

                            return (
                              <div
                                key={call.id || index}
                                style={{
                                  background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '12px',
                                  padding: '16px',
                                  transition: 'all 0.2s',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                                  e.currentTarget.style.borderColor = '#3b82f6';
                                  e.currentTarget.style.transform = 'translateY(-2px)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.boxShadow = 'none';
                                  e.currentTarget.style.borderColor = '#e2e8f0';
                                  e.currentTarget.style.transform = 'translateY(0)';
                                }}
                              >
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                  {/* Column 1: Basic Info */}
                                  <div>
                                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                                      {call.direction === 'INBOUND' ? '📞 INBOUND' : '📱 OUTBOUND'}
                                    </div>
                                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                                      {call.patientName}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#3b82f6', marginBottom: '6px' }}>
                                      📱 {call.caller_number || 'Unknown'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                                      📅 {startedAt ? startedAt.toLocaleDateString('en-GB') : 'N/A'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                                      🕐 {startedAt ? startedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '2px' }}>
                                      ⏱️ Talk: {Math.floor(duration / 60)}m {duration % 60}s
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                                      👤 {call.agent_user_name || 'Unknown Agent'}
                                    </div>
                                  </div>

                                  {/* Column 2: Reason */}
                                  <div>
                                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>
                                      Reason for Call
                                    </div>
                                    <div style={{
                                      fontSize: '13px',
                                      color: '#334155',
                                      lineHeight: '1.5',
                                      padding: '8px',
                                      background: '#f8fafc',
                                      borderRadius: '6px',
                                      border: '1px solid #e2e8f0'
                                    }}>
                                      {call.reason_for_call || 'Not recorded'}
                                    </div>
                                  </div>

                                  {/* Column 3: Outcome */}
                                  <div>
                                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>
                                      Outcome Summary
                                    </div>
                                    <div style={{
                                      fontSize: '13px',
                                      color: '#334155',
                                      lineHeight: '1.5',
                                      padding: '8px',
                                      background: '#f0fdf4',
                                      borderRadius: '6px',
                                      border: '1px solid #bbf7d0'
                                    }}>
                                      {call.outcome_summary || 'Not recorded'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                  {openModal === 'action_sample_checker' && 'Content area for Sample Checker'}
                  {openModal === 'action_placeholder_3' && 'Content area for Action 3'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
