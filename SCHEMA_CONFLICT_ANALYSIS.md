# Schema Conflict Analysis
## Comparing membership-rules.json vs member-creation-schema.json vs database.js

### ✅ ALIGNED (No Conflicts)

1. **Membership Types:**
   - Rules: `STANDARD`, `IMMEDIATE_FAMILY`, `EXPECTING_RECOVERING`, `FULL_FAMILY`
   - Schema: `STANDARD | IMMEDIATE_FAMILY | EXPECTING_RECOVERING | FULL_FAMILY`
   - ✅ Match perfectly

2. **Status Values:**
   - Rules: `ACTIVE`, `PAUSED`, `INACTIVE`
   - Schema: `ACTIVE | PAUSED | INACTIVE`
   - ✅ Match perfectly

3. **Contract Length:**
   - Rules: `defaultContractMonths: 12`
   - Schema: `contractLengthMonths: 12`
   - ✅ Aligned

4. **Cancellation Fee:**
   - Rules: `earlyCancellationFeeMonths: 2`, `earlyCancellationFeeMinimumDollars: 75` (fee = max(minimum, 2× monthly rate))
   - Schema: `earlyCancellationFeeDollars` (computed at signup), `earlyCancellationFeePolicy`
   - ✅ Aligned

5. **Pause Rules:**
   - Rules: `maxPausesPerContract: 1`
   - Schema: `pauseUsed: false` (boolean flag, enforces 1 pause per contract)
   - ✅ Aligned (different representation, same rule)

### ⚠️ NAMING CONVENTIONS (Potential Mapping Issues)

1. **Database vs JSON Files:**
   - **Database** (database.js line 140): Uses **snake_case, lowercase**
     - `'standard'`, `'immediate_family_member'`, `'expecting_or_recovering_mother'`, `'entire_family'`
     - Status: `'active'`, `'paused'`, `'inactive'`, `'expired'`
   
   - **JSON Files**: Use **UPPER_SNAKE_CASE**
     - `STANDARD`, `IMMEDIATE_FAMILY`, `EXPECTING_RECOVERING`, `FULL_FAMILY`
     - Status: `ACTIVE`, `PAUSED`, `INACTIVE`
   
   - ⚠️ **ISSUE**: Need mapping function between database format and JSON format
   - ⚠️ **ISSUE**: Database has `'expired'` status but JSON files don't include it
   - ⚠️ **ISSUE**: Database uses `'immediate_family_member'` but JSON uses `IMMEDIATE_FAMILY`
   - ⚠️ **ISSUE**: Database uses `'expecting_or_recovering_mother'` but JSON uses `EXPECTING_RECOVERING`
   - ⚠️ **ISSUE**: Database uses `'entire_family'` but JSON uses `FULL_FAMILY`

2. **Household Role:**
   - **Schema**: `householdRole: "PRIMARY | DEPENDENT | INDEPENDENT"`
   - **Rules**: Defines `PRIMARY` and `DEPENDENT` roles, but doesn't explicitly define `INDEPENDENT`
   - **Database**: Uses `is_primary_member` boolean (doesn't have explicit role field)
   - ⚠️ **ISSUE**: `INDEPENDENT` role is in schema but not clearly defined in rules

### 📋 MISSING FIELDS

1. **In Schema but not in Rules:**
   - `accountId` - Not defined in rules
   - `address` object - Not in rules
   - `profile.dateOfBirth` - Not in rules
   - `profile.gender` - Not in rules (but needed for EXPECTING_RECOVERING validation)
   - `profile.phone` - Not in rules
   - `emergencyContact` - Not in rules
   - `communicationPreferences` - Not in rules
   - `acknowledgements` - Not in rules
   - `billingStatus` - Not in rules (but paymentRules exist)
   - `pause.pauseRequestedAt`, `pauseStartDate`, `pauseEndDate` - Rules only define max count
   - `cancellation.cancellationRequested`, `cancellationRequestedAt`, `cancellationEffectiveDate` - Rules define fee but not request tracking

2. **In Rules but not in Schema:**
   - `contractRules.resetOnUpgradeToFamily` - Not in schema
   - `contractRules.resetOnDependentToIndependent` - Not in schema
   - `contractRules.resetOnPlanChangeStandardImmediateExpecting` - Not in schema
   - `pauseRules.pauseEffectiveTiming` - Not in schema
   - `pauseRules.chargeDuringPause` - Not in schema
   - `pauseRules.pausedCountsAsActive` - Not in schema
   - `pauseRules.familyPassPauseType` - Not in schema
   - `prorationRules` - Entire section not in schema
   - `groupRules.discountPercent` (15%) - Not in schema
   - `groupRules.minMembersForDiscount` (5) - Not in schema
   - `groupRules.countingRules` - Not in schema
   - `billingOwnerRules` - Entire section not in schema
   - `paymentRules.gracePeriodDays` (10) - Not in schema
   - `paymentRules.lateFee` (15) - Not in schema
   - `statusDefinitions` - Detailed status behaviors not in schema

### 🔴 CRITICAL CONFLICTS

1. **EXPECTING_RECOVERING Gender Restriction:**
   - **Rules**: `genderRestriction: "FEMALE_ONLY"` (line 34)
   - **Schema**: `gender: "MALE | FEMALE | PREFER_NOT_TO_SAY"` (line 20)
   - **Schema Notes**: "expectingRecovering object is only valid when: gender == FEMALE AND membershipType == EXPECTING_RECOVERING"
   - ✅ **RESOLVED**: Schema notes correctly enforce the rule

2. **FULL_FAMILY vs Family Object:**
   - **Rules**: `FULL_FAMILY` has `isFamilyPass: true`, `minMembers: 4`
   - **Schema**: `family` object only populated when `membershipType == FULL_FAMILY`
   - ✅ **ALIGNED**: Schema notes correctly enforce the rule

3. **Pause Enforcement:**
   - **Rules**: `maxPausesPerContract: 1`
   - **Schema**: `pauseUsed: false` (boolean)
   - ⚠️ **POTENTIAL ISSUE**: Schema uses boolean, but rules allow tracking count. If someone pauses twice, how is this prevented? The boolean should be set to `true` after first pause.

4. **Group Discount:**
   - **Rules**: `discountPercent: 15`, `minMembersForDiscount: 5`
   - **Schema**: `group.discountActive: false` (derived, not user-controlled)
   - ✅ **ALIGNED**: Schema correctly notes it's derived

5. **Billing Owner:**
   - **Rules**: `billingOwnerRules.primaryPaysForDependentsWhenDependentIsLinked: true`
   - **Schema**: `billingOwnerMemberId: "UUID"` (single source of truth)
   - ✅ **ALIGNED**: Schema correctly identifies billing owner as source of truth

### 📝 RECOMMENDATIONS

1. **Create Mapping Functions:**
   - Convert between database format (`'standard'`) and JSON format (`STANDARD`)
   - Handle `'expired'` status (add to schema or handle separately)

2. **Add Missing Fields to Schema:**
   - Consider adding `prorationRules` tracking
   - Add `gracePeriodDays` and `lateFee` to billing status
   - Add timing fields for pause/cancellation effectiveness

3. **Clarify INDEPENDENT Role:**
   - Add `INDEPENDENT` role definition to membership-rules.json
   - Or document that INDEPENDENT = canBeIndependent: true in rules

4. **Standardize Naming:**
   - Decide on convention: UPPER_SNAKE_CASE (JSON) vs snake_case (database)
   - Document the mapping clearly

5. **Add Validation:**
   - Enforce `pauseUsed` can only be set to `true` once per contract
   - Validate `expectingRecovering` only when gender == FEMALE
   - Validate `family` object only when membershipType == FULL_FAMILY











