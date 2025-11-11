import { supabase } from '../src/lib/supabaseClient.js';

const pad = (n) => n.toString().padStart(2, '0');
const revMonth = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function buildDates(rangeDays = 28) {
  const dates = [];
  for (let i = 0; i < rangeDays; i += 1) {
    const d = new Date(); d.setDate(d.getDate() + i);
    dates.push(`${pad(d.getDate())}-${revMonth[d.getMonth()]}-${d.getFullYear()}`);
  }
  return dates;
}

(async () => {
  try {
    const rangeDays = 28;
    const dates = buildDates(rangeDays);
    console.log('Querying for dates (first 5):', dates.slice(0,5));

    const namesToFilter = [
      'MANSELL, Kelly (Miss)',
      'AMISON, Kelly (Miss)',
      'MASTERSON, Sarah (Miss)',
      'MORETON, Alexa (Mrs)',
      'GRIFFITHS, Diana (Mrs)'
    ];

    const selectCols = [
      'appointment_date:"Appointment Date"',
      'appointment_time:"Appointment Time"',
      'full_name:"Full Name of the Session Holder of the Session"',
      'slot_type:"Slot Type"',
      'slot_duration:"Slot Duration"',
      'availability:"Availability"'
    ].join(', ');

    // total count
    const tot = await supabase.from('Apps_Calendar_Year').select('*', { count: 'exact', head: true });
    console.log('Total rows in Apps_Calendar_Year:', tot.count ?? 'unknown', tot.error ? 'ERROR:' + tot.error.message : '');

    // date-range count
    const dc = await supabase.from('Apps_Calendar_Year').select('*', { count: 'exact', head: true }).in('Appointment Date', dates);
    console.log(`Rows matching date range (${dates.length} days):`, dc.count ?? 'unknown', dc.error ? 'ERROR:' + dc.error.message : '');

    // fetch sample rows for the range and names filter
    let qb = supabase.from('Apps_Calendar_Year').select(selectCols).in('Appointment Date', dates).limit(2000);
    if (namesToFilter && namesToFilter.length > 0) qb = qb.in('Full Name of the Session Holder of the Session', namesToFilter);
    const res = await qb;
    if (res.error) {
      console.error('Query error:', res.error.message || res.error);
    } else {
      console.log('Pulled rows:', (res.data || []).length);
      console.log('Sample rows (first 10):');
      console.log(JSON.stringify((res.data || []).slice(0, 10), null, 2));
    }
  } catch (e) {
    console.error('Unexpected error', e);
    process.exit(2);
  }
})();
