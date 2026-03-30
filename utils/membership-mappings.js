/**
 * Mapping utilities for converting between database format and JSON format
 * Resolves naming convention conflicts between database (snake_case) and JSON (UPPER_SNAKE_CASE)
 */

/**
 * Convert membership type from database format to JSON format
 * @param {string} dbType - Database format (snake_case, lowercase)
 * @returns {string} JSON format (UPPER_SNAKE_CASE)
 */
function membershipTypeToJson(dbType) {
  const mapping = {
    'standard': 'STANDARD',
    'immediate_family_member': 'IMMEDIATE_FAMILY',
    'expecting_or_recovering_mother': 'EXPECTING_RECOVERING',
    'entire_family': 'FULL_FAMILY'
  };
  return mapping[dbType] || dbType.toUpperCase();
}

/**
 * Convert membership type from JSON format to database format
 * @param {string} jsonType - JSON format (UPPER_SNAKE_CASE)
 * @returns {string} Database format (snake_case, lowercase)
 */
function membershipTypeToDb(jsonType) {
  const mapping = {
    'STANDARD': 'standard',
    'IMMEDIATE_FAMILY': 'immediate_family_member',
    'EXPECTING_RECOVERING': 'expecting_or_recovering_mother',
    'FULL_FAMILY': 'entire_family'
  };
  return mapping[jsonType] || jsonType.toLowerCase();
}

/**
 * Convert status from database format to JSON format
 * @param {string} dbStatus - Database format (lowercase)
 * @returns {string} JSON format (UPPER_SNAKE_CASE)
 */
function statusToJson(dbStatus) {
  const mapping = {
    'active': 'ACTIVE',
    'paused': 'PAUSED',
    'inactive': 'INACTIVE',
    'expired': 'EXPIRED'
  };
  return mapping[dbStatus] || dbStatus.toUpperCase();
}

/**
 * Convert status from JSON format to database format
 * @param {string} jsonStatus - JSON format (UPPER_SNAKE_CASE)
 * @returns {string} Database format (lowercase)
 */
function statusToDb(jsonStatus) {
  const mapping = {
    'ACTIVE': 'active',
    'PAUSED': 'paused',
    'INACTIVE': 'inactive',
    'EXPIRED': 'expired'
  };
  return mapping[jsonStatus] || jsonStatus.toLowerCase();
}

/**
 * Validate membership type exists in both formats
 * @param {string} type - Membership type in either format
 * @returns {boolean}
 */
function isValidMembershipType(type) {
  const validTypes = [
    'standard', 'STANDARD',
    'immediate_family_member', 'IMMEDIATE_FAMILY',
    'expecting_or_recovering_mother', 'EXPECTING_RECOVERING',
    'entire_family', 'FULL_FAMILY'
  ];
  return validTypes.includes(type);
}

/**
 * Validate status exists in both formats
 * @param {string} status - Status in either format
 * @returns {boolean}
 */
function isValidStatus(status) {
  const validStatuses = [
    'active', 'ACTIVE',
    'paused', 'PAUSED',
    'inactive', 'INACTIVE',
    'expired', 'EXPIRED'
  ];
  return validStatuses.includes(status);
}

module.exports = {
  membershipTypeToJson,
  membershipTypeToDb,
  statusToJson,
  statusToDb,
  isValidMembershipType,
  isValidStatus
};











