/**
 * Single source of truth: required vs optional gym member profile fields.
 * Used by: GET /gym-memberships/me (profileCompletion), POST /gym-memberships/profile,
 * POST /gym-memberships/create, POST /gym-memberships/confirm-migration,
 * and client UIs (via GET /gym-memberships/profile-schema).
 *
 * Required: identity + contact + service address (no DOB, no emergency contact).
 * Optional: DOB + emergency contact (validated when provided).
 */

const REQUIRED_FIELDS = [
  { dbKey: 'first_name', label: 'First name', profileKey: 'firstName' },
  { dbKey: 'last_name', label: 'Last name', profileKey: 'lastName' },
  { dbKey: 'gender', label: 'Gender', profileKey: 'gender' },
  { dbKey: 'phone', label: 'Phone', profileKey: 'phone' },
  { dbKey: 'street', label: 'Street address', addressKey: 'street' },
  { dbKey: 'city', label: 'City', addressKey: 'city' },
  { dbKey: 'state', label: 'State', addressKey: 'state' },
  { dbKey: 'zip', label: 'Zip code', addressKey: 'zip' }
];

const OPTIONAL_FIELDS = [
  { dbKey: 'date_of_birth', label: 'Date of birth', profileKey: 'dateOfBirth' },
  { dbKey: 'emergency_contact_name', label: 'Emergency contact name', emergencyKey: 'name' },
  { dbKey: 'emergency_contact_phone', label: 'Emergency contact phone', emergencyKey: 'phone' }
];

function isBlank(v) {
  return v == null || String(v).trim() === '';
}

/**
 * Labels of required fields missing from a customer_profiles row (snake_case keys).
 */
function getMissingRequiredLabelsFromCustomerProfileRow(row) {
  if (!row) {
    return REQUIRED_FIELDS.map((f) => f.label);
  }
  return REQUIRED_FIELDS.filter((f) => isBlank(row[f.dbKey])).map((f) => f.label);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeDob(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let month;
  let day;
  let year;
  if (/^\d{2}\/\d{2}$/.test(raw)) {
    const [m, d] = raw.split('/').map((n) => parseInt(n, 10));
    month = m;
    day = d;
    year = 2000;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split('/').map((n) => parseInt(n, 10));
    month = m;
    day = d;
    year = y;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map((n) => parseInt(n, 10));
    month = m;
    day = d;
    year = y;
  } else {
    return null;
  }
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

function normalizeState(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function normalizeZip(value) {
  const z = String(value || '').trim();
  return /^\d{5}(-\d{4})?$/.test(z) ? z : null;
}

function normalizeGender(value) {
  const raw = String(value || '').trim();
  const upperMap = {
    MALE: 'male',
    FEMALE: 'female',
    PREFER_NOT_TO_SAY: 'prefer not to say'
  };
  let g = upperMap[raw];
  if (!g) {
    g = raw.toLowerCase();
  }
  const allowed = ['male', 'female', 'non-binary', 'nonbinary', 'prefer not to say', 'other'];
  if (!allowed.includes(g)) return null;
  if (g === 'nonbinary') return 'non-binary';
  return g;
}

/**
 * Validate + normalize body like POST /gym-memberships/profile.
 * Returns { ok, missing, invalid, normalized }.
 */
function validateGymMembershipProfilePayload(body) {
  const profile = body?.profile || {};
  const address = body?.address || {};
  const emergencyContact = body?.emergencyContact || {};

  const requiredChecks = [
    ['First name', profile.firstName],
    ['Last name', profile.lastName],
    ['Gender', profile.gender],
    ['Phone', profile.phone],
    ['Street address', address.street],
    ['City', address.city],
    ['State', address.state],
    ['Zip code', address.zip]
  ];
  const missing = requiredChecks.filter(([, v]) => isBlank(v)).map(([label]) => label);
  if (missing.length > 0) {
    return { ok: false, missing, invalid: [], normalized: null };
  }

  const normalizedDob = profile.dateOfBirth ? normalizeDob(profile.dateOfBirth) : null;
  const normalizedPhone = normalizePhone(profile.phone);
  const normalizedEmergencyPhone = emergencyContact.phone ? normalizePhone(emergencyContact.phone) : null;
  const normalizedState = normalizeState(address.state);
  const normalizedZip = normalizeZip(address.zip);
  const normalizedGender = normalizeGender(profile.gender);

  const invalid = [];
  if (profile.dateOfBirth && !normalizedDob) invalid.push('Date of birth must be MM/DD or MM/DD/YYYY');
  if (!normalizedPhone) invalid.push('Phone must be a valid 10-digit US phone');
  if (emergencyContact.phone && !normalizedEmergencyPhone) {
    invalid.push('Emergency contact phone must be a valid 10-digit US phone');
  }
  if (!normalizedState) invalid.push('State must be 2 letters (e.g., UT)');
  if (!normalizedZip) invalid.push('Zip code must be 5 digits or ZIP+4');
  if (!normalizedGender) invalid.push('Gender must be one of: male, female, non-binary, other, prefer not to say');
  if (invalid.length > 0) {
    return { ok: false, missing: [], invalid, normalized: null };
  }

  return {
    ok: true,
    missing: [],
    invalid: [],
    normalized: {
      profile: {
        ...profile,
        dateOfBirth: normalizedDob || null,
        phone: normalizedPhone,
        gender: normalizedGender
      },
      address: {
        ...address,
        state: normalizedState,
        zip: normalizedZip
      },
      emergencyContact: {
        ...emergencyContact,
        phone: normalizedEmergencyPhone || null
      }
    }
  };
}

/**
 * For POST /gym-memberships/create — same rules as profile save; uses validateGymMembershipProfilePayload shape.
 */
function validateCreateMembershipProfilePayload(profile, address, emergencyContact) {
  return validateGymMembershipProfilePayload({
    profile: profile || {},
    address: address || {},
    emergencyContact: emergencyContact || {}
  });
}

module.exports = {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  getMissingRequiredLabelsFromCustomerProfileRow,
  validateGymMembershipProfilePayload,
  validateCreateMembershipProfilePayload,
  normalizePhone,
  normalizeDob,
  normalizeState,
  normalizeZip,
  normalizeGender
};
