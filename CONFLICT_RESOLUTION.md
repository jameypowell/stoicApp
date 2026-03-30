# Conflict Resolution Summary

## How Conflicts Were Resolved

### 1. ✅ Naming Convention Conflicts

**Problem:** Database uses `snake_case` (lowercase) while JSON files use `UPPER_SNAKE_CASE`.

**Solution:** Created `utils/membership-mappings.js` with mapping functions:
- `membershipTypeToJson()` - Converts database format to JSON format
- `membershipTypeToDb()` - Converts JSON format to database format
- `statusToJson()` - Converts status from database to JSON
- `statusToDb()` - Converts status from JSON to database
- Validation functions for both formats

**Mapping Table:**
```
Database → JSON
'standard' → 'STANDARD'
'immediate_family_member' → 'IMMEDIATE_FAMILY'
'expecting_or_recovering_mother' → 'EXPECTING_RECOVERING'
'entire_family' → 'FULL_FAMILY'

'active' → 'ACTIVE'
'paused' → 'PAUSED'
'inactive' → 'INACTIVE'
'expired' → 'EXPIRED'
```

### 2. ✅ Missing INDEPENDENT Role Definition

**Problem:** Schema includes `INDEPENDENT` role but rules.json didn't define it.

**Solution:** Added `INDEPENDENT` role definition to `membership-rules.json`:
```json
"INDEPENDENT": {
  "canHaveDependents": false,
  "canCancelSelf": true,
  "canPauseSelf": true,
  "paysOwnBilling": true,
  "description": "Independent member who pays their own fees and is not linked to a primary member"
}
```

### 3. ✅ Missing EXPIRED Status

**Problem:** Database has `'expired'` status but schema only listed `ACTIVE | PAUSED | INACTIVE`.

**Solution:** Added `EXPIRED` to schema with note:
```json
"status": "ACTIVE | PAUSED | INACTIVE | EXPIRED",
"note": "EXPIRED status is system-generated when contract ends without renewal"
```

### 4. ✅ Pause Enforcement Clarification

**Problem:** Schema uses boolean `pauseUsed` but rules define `maxPausesPerContract: 1` - unclear how to enforce.

**Solution:** Added note to schema explaining enforcement:
```json
"pauseUsed": false,
"note": "pauseUsed is a boolean that enforces maxPausesPerContract: 1. Once set to true, cannot be reset until contract renewal"
```

### 5. ✅ Missing Rule Values in Schema

**Problem:** Schema had fields but didn't include values from rules (gracePeriodDays, lateFee, discountPercent, etc.).

**Solution:** Added these values to schema with notes referencing rules.json:
- `billingStatus.gracePeriodDays: 10` (from paymentRules)
- `billingStatus.lateFee: 15` (from paymentRules)
- `pause.pauseEffectiveTiming: "NEXT_BILLING_CYCLE"` (from pauseRules)
- `pause.chargeDuringPause: false` (from pauseRules)
- `pause.pausedCountsAsActive: true` (from pauseRules)
- `cancellation.cancellationEffectiveTiming: "NEXT_BILLING_CYCLE"` (from contractRules)
- `cancellation.cancellationFeeChargeTiming: "IMMEDIATE"` (from contractRules)
- `group.discountPercent: 15` (from groupRules)
- `group.minMembersForDiscount: 5` (from groupRules)
- `group.discountEffectiveTiming: "NEXT_BILLING_CYCLE"` (from groupRules)

All include notes referencing `membership-rules.json` as the source of truth.

### 6. ✅ Group Discount Clarification

**Problem:** Schema had `discountActive` but didn't explain it's derived.

**Solution:** Enhanced note to clarify:
```json
"note": "discountActive is derived, not user-controlled. discountPercent, minMembersForDiscount, and discountEffectiveTiming values come from membership-rules.json groupRules"
```

## Files Modified

1. **Created:** `utils/membership-mappings.js` - Mapping utilities
2. **Updated:** `membership-rules.json` - Added INDEPENDENT role
3. **Updated:** `member-creation-schema.json` - Added missing status, values, and notes

## Usage

### In Code:
```javascript
const { membershipTypeToDb, statusToJson } = require('./utils/membership-mappings');

// Convert JSON format to database format
const dbType = membershipTypeToDb('STANDARD'); // Returns 'standard'

// Convert database format to JSON format
const jsonStatus = statusToJson('active'); // Returns 'ACTIVE'
```

### Validation:
```javascript
const { isValidMembershipType, isValidStatus } = require('./utils/membership-mappings');

if (isValidMembershipType(inputType)) {
  // Process membership type
}
```

## Remaining Considerations

1. **Proration Rules:** Not added to schema as they're business logic, not member data
2. **Contract Reset Rules:** Not added to schema as they're system behaviors, not member attributes
3. **Address/Emergency Contact:** These are member profile fields, not membership rules - correctly separate
4. **Acknowledgements:** These are legal/compliance fields, not membership rules - correctly separate

## Result

✅ All critical conflicts resolved
✅ Clear mapping between database and JSON formats
✅ All roles and statuses defined
✅ Schema includes all necessary values with source references
✅ Validation utilities available for type checking











