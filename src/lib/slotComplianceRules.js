// Slot Compliance Rules
// These rules are used to check if slots violate any compliance requirements

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

/**
 * Check if a slot violates any compliance rules
 * @param {Object} slot - The slot object containing type, clinician, and duration
 * @returns {Array<string>} - Array of warning messages (empty if compliant)
 */
export function checkSlotCompliance(slot) {
  const clinician = slot.clinician || slot['Full Name of the Session Holder of the Session'] || '';
  const type = slot.type || slot['Slot Type'] || '';
  const rawDuration = slot.slotDuration || slot['Slot Duration'] || null;
  const slotDuration = rawDuration == null ? null : Number(rawDuration);
  const warnings = [];

  const slotType = type.toString().trim().toLowerCase();

  // Rule: 'Blood Clinic' must be >= 10 minutes and be with a Kelly (AMISON or MANSELL)
  if (slotType === 'blood clinic') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 10)) {
      warnings.push(`Blood Clinic slots should be at least 10 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isKelly = /MANSELL\s*,\s*Kelly|AMISON\s*,\s*Kelly/i.test(clinician);
    if (!isKelly) {
      warnings.push(`Blood Clinic slots should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'ECG' must be 30 minutes and be with a Kelly (AMISON or MANSELL)
  if (slotType === 'ecg') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
      warnings.push(`ECG appointments should be 30 minutes or longer (found ${rawDuration ?? 'no duration'})`);
    }
    const isKelly = /MANSELL\s*,\s*Kelly|AMISON\s*,\s*Kelly/i.test(clinician);
    if (!isKelly) {
      warnings.push(`ECG appointments should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'Wound Check' must be 30 minutes and be with a Nurse
  if (slotType === 'wound check') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
      warnings.push(`Wound Check appointments should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isNurse = NURSE_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
    if (!isNurse) {
      warnings.push(`Wound Checks should be performed by a nurse. Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'ANNUAL REVIEW MULTIPLE' must be 45 minutes and be with a Nurse
  if (slotType === 'annual review multiple') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 45)) {
      warnings.push(`Annual review (multiple) should be at least 45 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isNurse = NURSE_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
    if (!isNurse) {
      warnings.push(`Annual review (multiple) should be done by a nurse. Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'HYPERTEN ANNUAL REVIEW' must be 30 minutes and be with a Kelly
  if (slotType === 'hyperten annual review') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
      warnings.push(`Hypertension annual review should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isKelly = KELLY_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
    if (!isKelly) {
      warnings.push(`Hypertension annual reviews should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'HYPERTEN OR CKD REVIEW' must be 30 minutes and be with Kelly M (MANSELL)
  if (slotType === 'hyperten or ckd review') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 30)) {
      warnings.push(`Hypertension/CKD review should be at least 30 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isKellyM = (clinician || '').toLowerCase() === KELLY_M_NAME.toLowerCase();
    if (!isKellyM) {
      warnings.push(`This review must be run by Kelly Mansell. Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'Flu Clinic' clinician check
  if (slotType === 'flu clinic') {
    const isKelly = KELLY_NAMES.map((n) => n.toLowerCase()).includes((clinician || '').toLowerCase());
    if (!isKelly) {
      warnings.push(`Flu Clinics should be run by Kelly (Amison or Mansell). Found: ${clinician || 'Unknown'}`);
    }
  }
  
  // Rule: 'B12' must be 10 minutes and be with Kelly A (AMISON)
  if (slotType === 'b12') {
    if (!(Number.isFinite(slotDuration) && slotDuration >= 10)) {
      warnings.push(`B12 appointments should be at least 10 minutes (found ${rawDuration ?? 'no duration'})`);
    }
    const isKellyA = (clinician || '').toLowerCase() === KELLY_A_NAME.toLowerCase();
    if (!isKellyA) {
      warnings.push(`B12 injections should be performed by Kelly Amison. Found: ${clinician || 'Unknown'}`);
    }
  }

  return warnings;
}
