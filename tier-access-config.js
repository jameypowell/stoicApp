// Tier Access Configuration Helper
// Centralized configuration for tier-based feature access control

const config = require('./tier-access-config.json');

// Normalize tier names: map legacy names (daily/weekly/monthly) to new names
function normalizeTier(tier) {
  if (!tier) return tier;
  return config.legacyTierMapping[tier] || tier;
}

// Get tier configuration
function getTierConfig(tier) {
  const normalizedTier = normalizeTier(tier);
  return config.tiers[normalizedTier] || null;
}

// Get feature configuration
function getFeatureConfig(featureKey) {
  return config.features[featureKey] || null;
}

// Check if user has access to a feature
function hasAccessToFeature(tier, featureKey, subscription = null) {
  const normalizedTier = normalizeTier(tier);
  const feature = getFeatureConfig(featureKey);
  
  if (!feature) {
    console.warn(`Feature ${featureKey} not found in config`);
    return false;
  }

  // Check if subscription is required and active
  if (feature.requiresActiveSubscription) {
    if (
      !subscription ||
      !['active', 'grace_period', 'free_trial'].includes(subscription.status)
    ) {
      return false;
    }
    
    // Check allowed statuses
    const status = subscription.stripe_status || subscription.status;
    if (!config.accessCheckRules.allowedStatuses.includes(status)) {
      return false;
    }
  }

  const tierAccess = feature.tierAccess[normalizedTier];
  if (!tierAccess) {
    return false;
  }

  return tierAccess.access === true;
}

// Get feature limit for a tier
function getFeatureLimit(tier, featureKey) {
  const normalizedTier = normalizeTier(tier);
  const feature = getFeatureConfig(featureKey);
  
  if (!feature) return null;
  
  const tierAccess = feature.tierAccess[normalizedTier];
  if (!tierAccess || !tierAccess.access) return null;
  
  return tierAccess.limit;
}

// Check date-based access for functional fitness workouts
function hasAccessToDate(subscription, workoutDate) {
  if (!subscription) {
    return false;
  }

  // Check effective status
  if (config.accessCheckRules.requiresActiveStatus) {
    if (config.accessCheckRules.stripeStatusTakesPriority && subscription.stripe_status) {
      if (!config.accessCheckRules.allowedStatuses.includes(subscription.stripe_status)) {
        return false;
      }
    }
    
    if (!config.accessCheckRules.allowedStatuses.includes(subscription.status)) {
      return false;
    }
  }

  const workout = parseSubscriptionDate(workoutDate);
  const subscriptionStart = parseSubscriptionDate(subscription.start_date);
  const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date) : null;

  // Check if workout is within subscription period
  if (config.accessCheckRules.checkSubscriptionPeriod) {
    if (workout < subscriptionStart) {
      return false;
    }

    if (subscriptionEnd && workout > subscriptionEnd) {
      return false;
    }
  }

  // Check tier-specific date access from config
  const normalizedTier = normalizeTier(subscription.tier);
  const feature = getFeatureConfig('functional_fitness_workouts');
  const tierAccess = feature?.tierAccess[normalizedTier];
  
  if (!tierAccess || !tierAccess.access) {
    return false;
  }

  const dateRule = tierAccess.dateRule;
  if (!dateRule) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workoutDay = new Date(workout);
  workoutDay.setHours(0, 0, 0, 0);

  switch (dateRule.type) {
    case 'today_only':
      return workoutDay.getTime() === today.getTime();
      
    case 'window':
      const daysDiff = Math.floor((workoutDay - today) / (1000 * 60 * 60 * 24));
      return daysDiff >= -(dateRule.daysBefore || 0) && daysDiff <= (dateRule.daysAfter || 0);
      
    case 'unlimited':
      // Only check that workout is not before subscription start
      if (subscriptionStart && workoutDay < subscriptionStart) {
        return false;
      }
      return true;
      
    default:
      return false;
  }
}

// Parse subscription date (helper function)
function parseSubscriptionDate(dateString) {
  if (!dateString) {
    return new Date();
  }

  // Handle Date objects (from PostgreSQL)
  if (dateString instanceof Date) {
    const date = new Date(dateString);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  // Handle string dates (from SQLite or already formatted)
  if (typeof dateString === 'string') {
    const [datePart] = dateString.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  // Fallback: try to create a Date object
  const date = new Date(dateString);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Check if user has access to a strength phase
function hasAccessToStrengthPhase(tier, phase, subscription = null) {
  const phaseKey = `strength_phase_${phase === 1 ? 'one' : phase === 2 ? 'two' : phase === 3 ? 'three' : null}`;
  if (!phaseKey || !phaseKey.includes('phase')) {
    return false;
  }
  
  return hasAccessToFeature(tier, phaseKey, subscription);
}

// Get strength phase workout limit
function getStrengthPhaseLimit(tier, phase) {
  const normalizedTier = normalizeTier(tier);
  const phaseKey = `strength_phase_${phase === 1 ? 'one' : phase === 2 ? 'two' : phase === 3 ? 'three' : null}`;
  if (!phaseKey || !phaseKey.includes('phase')) {
    return null;
  }
  
  const feature = getFeatureConfig(phaseKey);
  if (!feature) return null;
  
  const tierAccess = feature.tierAccess[normalizedTier];
  if (!tierAccess || !tierAccess.access) return null;
  
  return tierAccess.workoutLimit;
}

module.exports = {
  config,
  normalizeTier,
  getTierConfig,
  getFeatureConfig,
  hasAccessToFeature,
  getFeatureLimit,
  hasAccessToDate,
  hasAccessToStrengthPhase,
  getStrengthPhaseLimit,
  parseSubscriptionDate
};
