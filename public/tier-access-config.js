// Tier Access Configuration for Frontend
// This is loaded from tier-access-config.json and embedded here for browser use

const TIER_ACCESS_CONFIG = {
    "version": "1.0.0",
    "lastUpdated": "2026-01-21",
    "legacyTierMapping": {
        "daily": "tier_two",
        "weekly": "tier_three",
        "monthly": "tier_four"
    },
    "features": {
        "core_finishers": {
            "tierAccess": {
                "tier_one": { "access": true, "limit": 1 },
                "tier_two": { "access": true, "limit": 5 },
                "tier_three": { "access": true, "limit": 10 },
                "tier_four": { "access": true, "limit": null }
            }
        },
        "strength_phase_one": {
            "tierAccess": {
                "tier_one": { "access": true, "workoutLimit": 1 },
                "tier_two": { "access": true, "workoutLimit": null },
                "tier_three": { "access": true, "workoutLimit": null },
                "tier_four": { "access": true, "workoutLimit": null },
                "daily": { "access": true, "workoutLimit": null },
                "weekly": { "access": true, "workoutLimit": null },
                "monthly": { "access": true, "workoutLimit": null }
            }
        },
        "strength_phase_two": {
            "tierAccess": {
                "tier_one": { "access": false },
                "tier_two": { "access": false },
                "tier_three": { "access": false },
                "tier_four": { "access": true, "workoutLimit": null },
                "monthly": { "access": true, "workoutLimit": null }
            }
        },
        "strength_phase_three": {
            "tierAccess": {
                "tier_one": { "access": false },
                "tier_two": { "access": false },
                "tier_three": { "access": false },
                "tier_four": { "access": true, "workoutLimit": null },
                "monthly": { "access": true, "workoutLimit": null }
            }
        }
    }
};

// Helper function to normalize tier names
function normalizeTier(tier) {
    if (!tier) return tier;
    return TIER_ACCESS_CONFIG.legacyTierMapping[tier] || tier;
}

// Check if user has access to a feature
function hasAccessToFeature(tier, featureKey, subscription = null) {
    const normalizedTier = normalizeTier(tier);
    const feature = TIER_ACCESS_CONFIG.features[featureKey];
    
    if (!feature) return false;
    
    // Check if subscription is required and active
    if (subscription && subscription.status !== 'active') {
        return false;
    }
    
    const tierAccess = feature.tierAccess[normalizedTier];
    if (!tierAccess) {
        // Also check if normalized tier doesn't match, try original tier
        const originalTierAccess = feature.tierAccess[tier];
        if (!originalTierAccess) return false;
        return originalTierAccess.access === true;
    }
    
    return tierAccess.access === true;
}

// Check if user has access to a strength phase
// NOTE: This function takes (tier, phase, subscription) - different signature than app.js function
function hasAccessToStrengthPhase(tier, phase, subscription = null) {
    const phaseKey = `strength_phase_${phase === 1 ? 'one' : phase === 2 ? 'two' : phase === 3 ? 'three' : null}`;
    if (!phaseKey || !phaseKey.includes('phase')) {
        return false;
    }
    
    // Call hasAccessToFeature directly (not via window to avoid potential recursion)
    return hasAccessToFeature(tier, phaseKey, subscription);
}

// Get strength phase workout limit
function getStrengthPhaseLimit(tier, phase) {
    const normalizedTier = normalizeTier(tier);
    const phaseKey = `strength_phase_${phase === 1 ? 'one' : phase === 2 ? 'two' : phase === 3 ? 'three' : null}`;
    if (!phaseKey || !phaseKey.includes('phase')) {
        return null;
    }
    
    const feature = TIER_ACCESS_CONFIG.features[phaseKey];
    if (!feature) return null;
    
    const tierAccess = feature.tierAccess[normalizedTier] || feature.tierAccess[tier];
    if (!tierAccess || !tierAccess.access) return null;
    
    return tierAccess.workoutLimit;
}

// Make functions globally available
// Use bracket notation when assigning to avoid any potential conflicts
window.TIER_ACCESS_CONFIG = TIER_ACCESS_CONFIG;
window.normalizeTier = normalizeTier;
window.hasAccessToFeature = hasAccessToFeature;
window['hasAccessToStrengthPhaseConfig'] = hasAccessToStrengthPhase; // Use different name to avoid conflicts
window.hasAccessToStrengthPhase = hasAccessToStrengthPhase; // Also keep original name for compatibility
window.getStrengthPhaseLimit = getStrengthPhaseLimit;
