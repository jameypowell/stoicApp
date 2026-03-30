// Database setup and models
// Supports both SQLite (local development) and PostgreSQL (production)
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const crypto = require('crypto');
const { DateTime } = require('luxon');
const { AMERICA_DENVER } = require('./lib/mountain-time');

// Determine database type based on environment variables
const USE_POSTGRES = !!process.env.DB_HOST;
const DB_TYPE = USE_POSTGRES ? 'postgresql' : 'sqlite';

// SQLite setup
const resolveDbPath = () => {
  const envPath = process.env.DB_PATH;

  if (!envPath) {
    return path.join(__dirname, 'data', 'stoic-shop.db');
  }

  return path.isAbsolute(envPath)
    ? envPath
    : path.join(__dirname, envPath);
};

const DB_PATH = resolveDbPath();

// Ensure data directory exists (only when path points to local filesystem)
if (!USE_POSTGRES) {
  try {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (error) {
    console.warn('Unable to ensure database directory exists:', error.message);
  }
}

// PostgreSQL schema
const POSTGRES_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'tester')),
  stripe_customer_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  last_login_ip TEXT,
  last_login_location TEXT
);

-- Customer profiles table (per-user detailed info captured at signup)
CREATE TABLE IF NOT EXISTS customer_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  gender TEXT,
  phone TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Subscriptions table
-- Note: CHECK constraint allows both legacy (daily/weekly/monthly) and new (tier_one/tier_two/tier_three/tier_four) tier names
-- This ensures backward compatibility with existing subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('daily', 'weekly', 'monthly', 'tier_one', 'tier_two', 'tier_three', 'tier_four')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'canceled', 'expired', 'grace_period', 'paused', 'free_trial')) DEFAULT 'active',
  start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Hybrid system payment tracking (all nullable for backward compatibility)
  payment_method_id TEXT,
  payment_method_expires_at TIMESTAMP,
  payment_failure_count INTEGER DEFAULT 0,
  last_payment_failure_at TIMESTAMP,
  grace_period_ends_at TIMESTAMP,
  stripe_status TEXT,
  last_synced_at TIMESTAMP,
  sync_error TEXT,
  canceled_by_user_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
  id SERIAL PRIMARY KEY,
  workout_date DATE UNIQUE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  workout_type TEXT CHECK(workout_type IN ('functional_fitness', 'core_finisher', 'strength')),
  focus_areas TEXT,
  structured_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Free trials table (7-day trial signups from home page; user_id set when they later log in)
CREATE TABLE IF NOT EXISTS free_trials (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  how_heard TEXT,
  question TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  user_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One-time 6-digit login codes for admin-added members
CREATE TABLE IF NOT EXISTS login_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_by_admin_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Strength workouts table (separate from regular workouts)
CREATE TABLE IF NOT EXISTS strength_workouts (
  id SERIAL PRIMARY KEY,
  workout_date DATE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  phase TEXT,
  primary_focus TEXT,
  secondary_focus TEXT,
  slide_number INTEGER,
  workout_index INTEGER,
  workout_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Macro plans table
CREATE TABLE IF NOT EXISTS macro_plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  plan_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Gym memberships table
-- Aligned with membership-rules.json
CREATE TABLE IF NOT EXISTS gym_memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  membership_type TEXT NOT NULL CHECK(membership_type IN ('standard', 'immediate_family_member', 'expecting_or_recovering_mother', 'entire_family')),
  family_group_id INTEGER,
  discount_group_id INTEGER,
  household_id TEXT UNIQUE,
  is_primary_member BOOLEAN DEFAULT FALSE,
  start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'inactive', 'expired')) DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT,
  billing_period TEXT CHECK(billing_period IN ('monthly', 'yearly')),
  paused_at TIMESTAMP,
  paused_until TIMESTAMP,
  pauses_used_this_contract INTEGER DEFAULT 0,
  pause_resume_scheduled BOOLEAN DEFAULT FALSE,
  contract_start_date TIMESTAMP,
  contract_end_date TIMESTAMP,
  contract_months INTEGER DEFAULT 12,
  cancellation_fee_charged BOOLEAN DEFAULT FALSE,
  cancellation_fee_amount INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Member-requested membership-type changes effective on next billing cycle
CREATE TABLE IF NOT EXISTS membership_change_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  requested_membership_type TEXT NOT NULL CHECK(requested_membership_type IN ('standard')),
  effective_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'cancelled')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Family groups table (to link users in the same family)
CREATE TABLE IF NOT EXISTS family_groups (
  id SERIAL PRIMARY KEY,
  primary_user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Discount groups table (for group discounts - 4+ members get 10% off)
CREATE TABLE IF NOT EXISTS discount_groups (
  id SERIAL PRIMARY KEY,
  group_id TEXT UNIQUE NOT NULL,
  group_access_code TEXT UNIQUE NOT NULL,
  group_leader_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_leader_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Buddy passes table (member invites one buddy per week)
CREATE TABLE IF NOT EXISTS buddy_passes (
  id SERIAL PRIMARY KEY,
  member_user_id INTEGER NOT NULL,
  buddy_name TEXT NOT NULL,
  buddy_phone TEXT NOT NULL,
  buddy_email TEXT NOT NULL,
  buddy_user_id INTEGER,
  visit_date DATE NOT NULL,
  class_time TEXT NOT NULL,
  class_name TEXT NOT NULL,
  pin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled')),
  payment_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  FOREIGN KEY (member_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (buddy_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- PR logs table (1RM Log entries)
CREATE TABLE IF NOT EXISTS pr_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  exercise TEXT NOT NULL,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  one_rm REAL NOT NULL,
  confidence TEXT NOT NULL,
  log_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Body composition measurements table (Progressive Overload)
CREATE TABLE IF NOT EXISTS body_composition_measurements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  measurement TEXT NOT NULL,
  value REAL NOT NULL,
  goal_direction TEXT NOT NULL,
  measurement_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Meal plan calculations tracking table
CREATE TABLE IF NOT EXISTS meal_plan_calculations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  calculation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Meal plan inputs table (for Tier Three/Four to save inputs)
CREATE TABLE IF NOT EXISTS meal_plan_inputs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  goals_data JSONB,
  info_data JSONB,
  activity_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Core finishers viewed tracking table
CREATE TABLE IF NOT EXISTS core_finishers_viewed (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  workout_date DATE NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, workout_date)
);

-- Strength workouts viewed tracking table
CREATE TABLE IF NOT EXISTS strength_workouts_viewed (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  workout_id INTEGER NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, workout_id)
);

-- Global banner settings (single logical record, use latest updated_at)
CREATE TABLE IF NOT EXISTS banner_settings (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  bg_key TEXT NOT NULL CHECK(bg_key IN ('yellow', 'red', 'blue', 'white')),
  text_color TEXT NOT NULL CHECK(text_color IN ('black', 'white')),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global banner settings (single logical record, use latest updated_at)
CREATE TABLE IF NOT EXISTS banner_settings (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  bg_key TEXT NOT NULL CHECK(bg_key IN ('yellow', 'red', 'blue', 'white')),
  text_color TEXT NOT NULL CHECK(text_color IN ('black', 'white')),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Webhook events table (for idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data JSONB,
  FOREIGN KEY (stripe_event_id) REFERENCES webhook_events(stripe_event_id)
);

-- Subscription status history table (audit trail)
CREATE TABLE IF NOT EXISTS subscription_status_history (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER,
  subscription_type TEXT NOT NULL CHECK(subscription_type IN ('app_subscription', 'gym_membership')),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  stripe_event_id TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- App payment error logs (admin visibility for incomplete/failed payment attempts)
CREATE TABLE IF NOT EXISTS app_payment_error_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_email TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_payment_intent_id TEXT,
  tier TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Note: Foreign key constraint for family_group_id will be handled by application logic
-- as ALTER TABLE ADD CONSTRAINT may fail if constraint already exists

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);
CREATE INDEX IF NOT EXISTS idx_strength_workouts_date ON strength_workouts(workout_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_login_codes_user_id ON login_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_login_codes_expires_at ON login_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_macro_plans_user_id ON macro_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_user_id ON gym_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_family_group_id ON gym_memberships(family_group_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id ON gym_memberships(household_id);
CREATE INDEX IF NOT EXISTS idx_family_groups_primary_user_id ON family_groups(primary_user_id);
CREATE INDEX IF NOT EXISTS idx_pr_logs_user_id ON pr_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_pr_logs_date ON pr_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_body_comp_user_id ON body_composition_measurements(user_id);
CREATE INDEX IF NOT EXISTS idx_body_comp_date ON body_composition_measurements(measurement_date);
CREATE INDEX IF NOT EXISTS idx_meal_plan_calc_user_id ON meal_plan_calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_inputs_user_id ON meal_plan_inputs(user_id);
CREATE INDEX IF NOT EXISTS idx_core_finishers_viewed_user_id ON core_finishers_viewed(user_id);
CREATE INDEX IF NOT EXISTS idx_strength_workouts_viewed_user_id ON strength_workouts_viewed(user_id);
`;

// SQLite schema
const SQLITE_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'tester')),
  stripe_customer_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  last_login_ip TEXT,
  last_login_location TEXT
);

-- Customer profiles table (per-user detailed info captured at signup)
CREATE TABLE IF NOT EXISTS customer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  date_of_birth TEXT,
  gender TEXT,
  phone TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Subscriptions table
-- Note: CHECK constraint allows both legacy (daily/weekly/monthly) and new (tier_one/tier_two/tier_three/tier_four) tier names
-- This ensures backward compatibility with existing subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('daily', 'weekly', 'monthly', 'tier_one', 'tier_two', 'tier_three', 'tier_four')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'canceled', 'expired', 'grace_period', 'paused', 'free_trial')) DEFAULT 'active',
  start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_date DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Hybrid system payment tracking (all nullable for backward compatibility)
  payment_method_id TEXT,
  payment_method_expires_at DATETIME,
  payment_failure_count INTEGER DEFAULT 0,
  last_payment_failure_at DATETIME,
  grace_period_ends_at DATETIME,
  stripe_status TEXT,
  last_synced_at DATETIME,
  sync_error TEXT,
  canceled_by_user_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_date DATE UNIQUE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  workout_type TEXT CHECK(workout_type IN ('functional_fitness', 'core_finisher', 'strength')),
  focus_areas TEXT,
  structured_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Payment history table
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Free trials table (7-day trial signups from home page; user_id set when they later log in)
CREATE TABLE IF NOT EXISTS free_trials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  how_heard TEXT,
  question TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One-time 6-digit login codes for admin-added members
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT 0,
  created_by_admin_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_admin_id) REFERENCES users(id)
);

-- Strength workouts table (separate from regular workouts)
CREATE TABLE IF NOT EXISTS strength_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_date DATE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  phase TEXT,
  primary_focus TEXT,
  secondary_focus TEXT,
  slide_number INTEGER,
  workout_index INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strength workouts table (separate from regular workouts)
CREATE TABLE IF NOT EXISTS strength_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_date DATE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  phase TEXT,
  primary_focus TEXT,
  secondary_focus TEXT,
  slide_number INTEGER,
  workout_index INTEGER,
  workout_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Macro plans table
CREATE TABLE IF NOT EXISTS macro_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  plan_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Gym memberships table
-- Aligned with membership-rules.json
CREATE TABLE IF NOT EXISTS gym_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  membership_type TEXT NOT NULL CHECK(membership_type IN ('standard', 'immediate_family_member', 'expecting_or_recovering_mother', 'entire_family')),
  family_group_id INTEGER,
  discount_group_id INTEGER,
  household_id TEXT UNIQUE,
  is_primary_member INTEGER DEFAULT 0,
  start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_date DATETIME,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'inactive', 'expired', 'grace_period')) DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT,
  billing_period TEXT CHECK(billing_period IN ('monthly', 'yearly')),
  paused_at DATETIME,
  paused_until DATETIME,
  pauses_used_this_contract INTEGER DEFAULT 0,
  pause_resume_scheduled INTEGER DEFAULT 0,
  contract_start_date DATETIME,
  contract_end_date DATETIME,
  contract_months INTEGER DEFAULT 12,
  cancellation_fee_charged INTEGER DEFAULT 0,
  cancellation_fee_amount INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Hybrid system payment tracking (all nullable for backward compatibility)
  payment_method_id TEXT,
  payment_method_expires_at DATETIME,
  payment_failure_count INTEGER DEFAULT 0,
  last_payment_failure_at DATETIME,
  grace_period_ends_at DATETIME,
  stripe_status TEXT,
  last_synced_at DATETIME,
  sync_error TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Member-requested membership-type changes effective on next billing cycle
CREATE TABLE IF NOT EXISTS membership_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  requested_membership_type TEXT NOT NULL CHECK(requested_membership_type IN ('standard')),
  effective_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Family groups table (to link users in the same family)
CREATE TABLE IF NOT EXISTS family_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_user_id) REFERENCES users(id)
);

-- Discount groups table (for group discounts - 4+ members get 10% off)
CREATE TABLE IF NOT EXISTS discount_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT UNIQUE NOT NULL,
  group_access_code TEXT UNIQUE NOT NULL,
  group_leader_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_leader_id) REFERENCES users(id)
);

-- Buddy passes table (member invites one buddy per week)
CREATE TABLE IF NOT EXISTS buddy_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_user_id INTEGER NOT NULL,
  buddy_name TEXT NOT NULL,
  buddy_phone TEXT NOT NULL,
  buddy_email TEXT NOT NULL,
  buddy_user_id INTEGER,
  visit_date DATE NOT NULL,
  class_time TEXT NOT NULL,
  class_name TEXT NOT NULL,
  pin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled')),
  payment_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME,
  cancelled_at DATETIME,
  FOREIGN KEY (member_user_id) REFERENCES users(id)
);

-- PR logs table (1RM Log entries)
CREATE TABLE IF NOT EXISTS pr_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  exercise TEXT NOT NULL,
  weight REAL NOT NULL,
  reps INTEGER NOT NULL,
  one_rm REAL NOT NULL,
  confidence TEXT NOT NULL,
  log_date DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Body composition measurements table (Progressive Overload)
CREATE TABLE IF NOT EXISTS body_composition_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  measurement TEXT NOT NULL,
  value REAL NOT NULL,
  goal_direction TEXT NOT NULL,
  measurement_date DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Meal plan calculations tracking table
CREATE TABLE IF NOT EXISTS meal_plan_calculations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  calculation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Meal plan inputs table (for Tier Three/Four to save inputs)
CREATE TABLE IF NOT EXISTS meal_plan_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  goals_data TEXT,
  info_data TEXT,
  activity_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Core finishers viewed tracking table
CREATE TABLE IF NOT EXISTS core_finishers_viewed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  workout_date DATE NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, workout_date)
);

-- Strength workouts viewed tracking table
CREATE TABLE IF NOT EXISTS strength_workouts_viewed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  workout_id INTEGER NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, workout_id)
);

-- Global banner settings (single logical record, use latest updated_at)
CREATE TABLE IF NOT EXISTS banner_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  bg_key TEXT NOT NULL CHECK(bg_key IN ('yellow', 'red', 'blue', 'white')),
  text_color TEXT NOT NULL CHECK(text_color IN ('black', 'white')),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Webhook events table (for idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  data TEXT
);

-- Subscription status history table (audit trail)
CREATE TABLE IF NOT EXISTS subscription_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER,
  subscription_type TEXT NOT NULL CHECK(subscription_type IN ('app_subscription', 'gym_membership')),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  stripe_event_id TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- App payment error logs (admin visibility for incomplete/failed payment attempts)
CREATE TABLE IF NOT EXISTS app_payment_error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_payment_intent_id TEXT,
  tier TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);
CREATE INDEX IF NOT EXISTS idx_strength_workouts_date ON strength_workouts(workout_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_login_codes_user_id ON login_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_login_codes_expires_at ON login_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_macro_plans_user_id ON macro_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_user_id ON gym_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_family_group_id ON gym_memberships(family_group_id);
CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id ON gym_memberships(household_id);
CREATE INDEX IF NOT EXISTS idx_family_groups_primary_user_id ON family_groups(primary_user_id);
CREATE INDEX IF NOT EXISTS idx_pr_logs_user_id ON pr_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_pr_logs_date ON pr_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_body_comp_user_id ON body_composition_measurements(user_id);
CREATE INDEX IF NOT EXISTS idx_body_comp_date ON body_composition_measurements(measurement_date);
CREATE INDEX IF NOT EXISTS idx_meal_plan_calc_user_id ON meal_plan_calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_inputs_user_id ON meal_plan_inputs(user_id);
CREATE INDEX IF NOT EXISTS idx_core_finishers_viewed_user_id ON core_finishers_viewed(user_id);
CREATE INDEX IF NOT EXISTS idx_strength_workouts_viewed_user_id ON strength_workouts_viewed(user_id);
`;

/** One-time / idempotent: fix gym rows where end is exactly 29 calendar days after start (policy: 30-day period). */
function sqliteFixGymContractEnd29DayBug(db, callback) {
  db.run(
    `UPDATE gym_memberships
     SET contract_end_date = date(contract_start_date, '+30 days'), updated_at = datetime('now')
     WHERE contract_start_date IS NOT NULL
       AND contract_end_date IS NOT NULL
       AND COALESCE(membership_type, '') != 'free_trial'
       AND CAST((julianday(date(contract_end_date)) - julianday(date(contract_start_date))) AS INTEGER) = 29`,
    function onSqliteGymFix(err) {
      if (err) {
        console.warn('SQLite gym contract 29→30-day period fix skipped:', err.message);
      } else if (this.changes > 0) {
        console.log(`SQLite: gym contract periods corrected (29-day span → 30 calendar days): ${this.changes} row(s).`);
      }
      callback();
    }
  );
}

// Helper function to add hybrid system columns to SQLite tables
function addHybridSystemColumns(db, callback) {
  const columns = [
    { name: 'payment_method_id', type: 'TEXT' },
    { name: 'payment_method_expires_at', type: 'DATETIME' },
    { name: 'payment_failure_count', type: 'INTEGER DEFAULT 0' },
    { name: 'last_payment_failure_at', type: 'DATETIME' },
    { name: 'grace_period_ends_at', type: 'DATETIME' },
    { name: 'stripe_status', type: 'TEXT' },
    { name: 'last_synced_at', type: 'DATETIME' },
    { name: 'sync_error', type: 'TEXT' },
    { name: 'canceled_by_user_at', type: 'DATETIME' }
  ];
  
  const tables = ['subscriptions', 'gym_memberships'];
  let tablesProcessed = 0;
  let paymentsMigrationDone = false;

  const maybeCallback = () => {
    if (tablesProcessed === tables.length && paymentsMigrationDone) callback();
  };
  
  tables.forEach(tableName => {
    db.all(`PRAGMA table_info(${tableName})`, (err, tableColumns) => {
      if (err) {
        console.warn(`Could not check ${tableName} columns:`, err.message);
        tablesProcessed++;
        maybeCallback();
        return;
      }
      
      let colsAdded = 0;
      columns.forEach(col => {
        const hasCol = tableColumns && tableColumns.some(tc => tc.name === col.name);
        if (!hasCol) {
          db.run(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`, (err) => {
            if (err) {
              console.warn(`Could not add ${col.name} to ${tableName}:`, err.message);
            } else {
              console.log(`Added ${col.name} column to existing ${tableName} table`);
            }
            colsAdded++;
            if (colsAdded === columns.length) {
              if (tableName === 'gym_memberships') {
                const hasMonthly = tableColumns && tableColumns.some(tc => tc.name === 'monthly_amount_cents');
                const hasDiscountName = tableColumns && tableColumns.some(tc => tc.name === 'discount_name');
                const addDiscountName = (done) => {
                  if (!hasDiscountName) {
                    db.run('ALTER TABLE gym_memberships ADD COLUMN discount_name TEXT', (e2) => {
                      if (!e2) console.log('Added discount_name column to gym_memberships table');
                      done();
                    });
                  } else done();
                };
                if (!hasMonthly) {
                  db.run('ALTER TABLE gym_memberships ADD COLUMN monthly_amount_cents INTEGER', (e) => {
                    if (!e) console.log('Added monthly_amount_cents column to gym_memberships table');
                    addDiscountName(() => { tablesProcessed++; maybeCallback(); });
                  });
                } else {
                  addDiscountName(() => { tablesProcessed++; maybeCallback(); });
                }
              } else {
                tablesProcessed++;
                maybeCallback();
              }
            }
          });
        } else {
          colsAdded++;
          if (colsAdded === columns.length) {
            if (tableName === 'gym_memberships') {
              const hasMonthly = tableColumns && tableColumns.some(tc => tc.name === 'monthly_amount_cents');
              const hasDiscountName = tableColumns && tableColumns.some(tc => tc.name === 'discount_name');
              const addDiscountName = (done) => {
                if (!hasDiscountName) {
                  db.run('ALTER TABLE gym_memberships ADD COLUMN discount_name TEXT', (e2) => {
                    if (!e2) console.log('Added discount_name column to gym_memberships table');
                    done();
                  });
                } else done();
              };
              if (!hasMonthly) {
                db.run('ALTER TABLE gym_memberships ADD COLUMN monthly_amount_cents INTEGER', (e) => {
                  if (!e) console.log('Added monthly_amount_cents column to gym_memberships table');
                  addDiscountName(() => { tablesProcessed++; maybeCallback(); });
                });
              } else {
                addDiscountName(() => { tablesProcessed++; maybeCallback(); });
              }
            } else {
              tablesProcessed++;
              maybeCallback();
            }
          }
        }
      });
    });
  });
  
  // Add email column to payments table for drop-in tracking
  db.all('PRAGMA table_info(payments)', (err, paymentsColumns) => {
    if (err || !paymentsColumns) {
      paymentsMigrationDone = true;
      maybeCallback();
      return;
    }
    if (paymentsColumns.some(c => c.name === 'email')) {
      paymentsMigrationDone = true;
      maybeCallback();
      return;
    }
    db.run('ALTER TABLE payments ADD COLUMN email TEXT', (alterErr) => {
      if (alterErr) console.warn('Could not add email to payments:', alterErr.message);
      else console.log('Added email column to existing payments table');
      paymentsMigrationDone = true;
      maybeCallback();
    });
  });

  // Create new tables
  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      data TEXT
    )
  `, () => {});
  
  db.run(`
    CREATE TABLE IF NOT EXISTS subscription_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER,
      subscription_type TEXT NOT NULL CHECK(subscription_type IN ('app_subscription', 'gym_membership')),
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      stripe_event_id TEXT,
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    )
  `, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS app_payment_error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_payment_intent_id TEXT,
      tier TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `, () => {});
}

// Generate a unique household ID
// Format: HH-XXXXXX where XXXXXX is a 6-character alphanumeric string
function generateHouseholdId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters (0, O, I, 1)
  const randomBytes = crypto.randomBytes(6); // Generate 6 bytes for 6 characters
  const code = Array.from(randomBytes)
    .map(byte => chars[byte % chars.length])
    .join('');
  const householdId = `HH-${code}`; // HH-XXXXXX = 9 characters total
  
  return householdId;
}

// Initialize database
async function initDatabase() {
  if (USE_POSTGRES) {
    // PostgreSQL initialization
    const client = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL !== 'false' ? {
        rejectUnauthorized: false
      } : false
    });

    try {
      await client.connect();
      console.log('Connected to PostgreSQL database');

      // Check and add household_id column if it doesn't exist BEFORE running schema
      // This prevents index creation errors if the column doesn't exist
      const columnCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'gym_memberships' 
        AND column_name = 'household_id'
      `);
      
      if (columnCheck.rows.length === 0) {
        await client.query('ALTER TABLE gym_memberships ADD COLUMN household_id TEXT UNIQUE');
        console.log('Added household_id column to existing gym_memberships table');
      }
      
      // Check and add last_login column to users table if it doesn't exist
      const lastLoginCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'last_login'
      `);
      
      if (lastLoginCheck.rows.length === 0) {
        await client.query('ALTER TABLE users ADD COLUMN last_login TIMESTAMP');
        console.log('Added last_login column to existing users table');
      }
      
      // Check and add IP and location columns if they don't exist
      const ipCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'last_login_ip'
      `);
      
      if (ipCheck.rows.length === 0) {
        await client.query('ALTER TABLE users ADD COLUMN last_login_ip TEXT');
        console.log('Added last_login_ip column to existing users table');
      }
      
      const locationCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'last_login_location'
      `);
      
      if (locationCheck.rows.length === 0) {
        await client.query('ALTER TABLE users ADD COLUMN last_login_location TEXT');
        console.log('Added last_login_location column to existing users table');
      }
      
      const stripeCustomerCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'stripe_customer_id'
      `);
      
      if (stripeCustomerCheck.rows.length === 0) {
        await client.query('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT');
        console.log('Added stripe_customer_id column to existing users table');
      }

      // Add email column to payments table for drop-in tracking
      const paymentsEmailCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'payments'
        AND column_name = 'email'
      `);
      if (paymentsEmailCheck.rows.length === 0) {
        await client.query('ALTER TABLE payments ADD COLUMN email TEXT');
        console.log('Added email column to existing payments table');
      }
      
      // Add hybrid system columns to subscriptions table if they don't exist
      const subscriptionColumns = [
        'payment_method_id', 'payment_method_expires_at', 'payment_failure_count',
        'last_payment_failure_at', 'grace_period_ends_at', 'stripe_status',
        'last_synced_at', 'sync_error', 'canceled_by_user_at'
      ];
      
      for (const col of subscriptionColumns) {
        const colCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'subscriptions' 
          AND column_name = $1
        `, [col]);
        
        if (colCheck.rows.length === 0) {
          const colType = col === 'payment_failure_count' ? 'INTEGER DEFAULT 0' :
                         col.includes('_at') ? 'TIMESTAMP' : 'TEXT';
          await client.query(`ALTER TABLE subscriptions ADD COLUMN ${col} ${colType}`);
          console.log(`Added ${col} column to existing subscriptions table`);
        }
      }
      
      // Update subscriptions status constraint to include new statuses
      try {
        await client.query(`
          ALTER TABLE subscriptions 
          DROP CONSTRAINT IF EXISTS subscriptions_status_check
        `);
        await client.query(`
          ALTER TABLE subscriptions 
          ADD CONSTRAINT subscriptions_status_check 
          CHECK(status IN ('active', 'canceled', 'expired', 'grace_period', 'paused', 'free_trial'))
        `);
      } catch (e) {
        // Constraint might not exist or already updated, that's okay
        console.log('Status constraint update skipped (may already be correct)');
      }

      // Gym free trial → app Tier One rows should use subscriptions.status = free_trial (reconcile + UX).
      // Do not relabel tier_one if the user already has an active paid or Stripe-backed subscription row.
      try {
        const bf = await client.query(`
          UPDATE subscriptions s
          SET status = 'free_trial'
          FROM gym_memberships gm
          WHERE s.user_id = gm.user_id
            AND gm.membership_type = 'free_trial'
            AND gm.status = 'active'
            AND s.tier = 'tier_one'
            AND (s.stripe_subscription_id IS NULL OR TRIM(s.stripe_subscription_id::text) = '')
            AND s.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM subscriptions s2
              WHERE s2.user_id = s.user_id
                AND s2.id <> s.id
                AND s2.status IN ('active', 'grace_period', 'free_trial')
                AND (s2.end_date IS NULL OR s2.end_date > CURRENT_TIMESTAMP)
                AND (
                  s2.status <> 'grace_period'
                  OR s2.grace_period_ends_at IS NULL
                  OR s2.grace_period_ends_at > CURRENT_TIMESTAMP
                )
                AND (
                  s2.tier IN ('tier_two', 'tier_three', 'tier_four')
                  OR (s2.stripe_subscription_id IS NOT NULL AND TRIM(s2.stripe_subscription_id::text) <> '')
                )
            )
        `);
        if (bf.rowCount > 0) {
          console.log(`Backfilled subscriptions.status = free_trial for ${bf.rowCount} gym free trial tier_one row(s).`);
        }
      } catch (e) {
        console.warn('Backfill free_trial subscription status:', e.message);
      }
      
      // Add hybrid system columns to gym_memberships table if they don't exist
      for (const col of subscriptionColumns) {
        const colCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'gym_memberships' 
          AND column_name = $1
        `, [col]);
        
        if (colCheck.rows.length === 0) {
          const colType = col === 'payment_failure_count' ? 'INTEGER DEFAULT 0' :
                         col.includes('_at') ? 'TIMESTAMP' : 'TEXT';
          await client.query(`ALTER TABLE gym_memberships ADD COLUMN ${col} ${colType}`);
          console.log(`Added ${col} column to existing gym_memberships table`);
        }
      }
      const monthlyAmountCheck = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gym_memberships' AND column_name = 'monthly_amount_cents'`);
      if (!monthlyAmountCheck.rows || monthlyAmountCheck.rows.length === 0) {
        await client.query('ALTER TABLE gym_memberships ADD COLUMN monthly_amount_cents INTEGER');
        console.log('Added monthly_amount_cents column to gym_memberships table');
      }
      const discountNameCheck = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gym_memberships' AND column_name = 'discount_name'`);
      if (!discountNameCheck.rows || discountNameCheck.rows.length === 0) {
        await client.query('ALTER TABLE gym_memberships ADD COLUMN discount_name TEXT');
        console.log('Added discount_name column to gym_memberships table');
      }
      
      // Update gym_memberships status constraint to include grace_period
      try {
        await client.query(`
          ALTER TABLE gym_memberships 
          DROP CONSTRAINT IF EXISTS gym_memberships_status_check
        `);
        await client.query(`
          ALTER TABLE gym_memberships 
          ADD CONSTRAINT gym_memberships_status_check 
          CHECK(status IN ('active', 'paused', 'inactive', 'expired', 'grace_period'))
        `);
      } catch (e) {
        // Constraint might not exist or already updated, that's okay
        console.log('Gym membership status constraint update skipped (may already be correct)');
      }

      // Bulk fix: rows where contract_end is exactly 29 calendar days after contract_start (off-by-one vs 30-day policy).
      // Safe for app-managed billing; Stripe subscription rows with a true 29-day span are extremely rare — re-sync on next invoice if needed.
      try {
        const offByOne = await client.query(`
          UPDATE gym_memberships
          SET
            contract_end_date = (contract_start_date::date + INTERVAL '30 days')::date,
            updated_at = CURRENT_TIMESTAMP
          WHERE contract_start_date IS NOT NULL
            AND contract_end_date IS NOT NULL
            AND COALESCE(membership_type::text, '') <> 'free_trial'
            AND (contract_end_date::date - contract_start_date::date) = 29
        `);
        if (offByOne.rowCount > 0) {
          console.log(`Gym contract periods corrected (29-day span → 30 calendar days): ${offByOne.rowCount} row(s).`);
        }
      } catch (e) {
        console.warn('Gym contract 29→30-day period bulk fix skipped:', e.message);
      }

      // One-time data fix (idempotent): Sharla — contract anchor = first successful payment (Mar 9, 2026), not signup attempt day.
      // Aligns DB with business truth; safe to re-run (only updates when dates still wrong or null).
      try {
        const sharlaFix = await client.query(`
          UPDATE gym_memberships gm
          SET
            contract_start_date = DATE '2026-03-09',
            contract_end_date = (DATE '2026-03-09' + INTERVAL '30 days')::date,
            updated_at = CURRENT_TIMESTAMP
          FROM users u
          WHERE gm.user_id = u.id
            AND LOWER(TRIM(u.email)) = 'sharla.barber@nebo.edu'
            AND (
              gm.contract_start_date IS NULL
              OR (gm.contract_start_date::date) IS DISTINCT FROM DATE '2026-03-09'
              OR (gm.contract_end_date::date) IS DISTINCT FROM (DATE '2026-03-09' + INTERVAL '30 days')::date
            )
        `);
        if (sharlaFix.rowCount > 0) {
          console.log(`Gym contract dates corrected for sharla.barber@nebo.edu (${sharlaFix.rowCount} row(s)).`);
        }
      } catch (e) {
        console.warn('Sharla gym contract date patch skipped:', e.message);
      }
      
      // Create new tables (webhook_events, subscription_status_history, app_payment_error_logs)
      await client.query(`
        CREATE TABLE IF NOT EXISTS webhook_events (
          id SERIAL PRIMARY KEY,
          stripe_event_id TEXT UNIQUE NOT NULL,
          event_type TEXT NOT NULL,
          processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          data JSONB
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS subscription_status_history (
          id SERIAL PRIMARY KEY,
          subscription_id INTEGER,
          subscription_type TEXT NOT NULL CHECK(subscription_type IN ('app_subscription', 'gym_membership')),
          old_status TEXT,
          new_status TEXT NOT NULL,
          changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reason TEXT,
          stripe_event_id TEXT,
          FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_payment_error_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          user_email TEXT,
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          stripe_payment_intent_id TEXT,
          tier TEXT,
          event_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'warning',
          message TEXT NOT NULL,
          details JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_added_members (
          id SERIAL PRIMARY KEY,
          primary_email TEXT NOT NULL,
          primary_first_name TEXT,
          primary_last_name TEXT,
          primary_phone TEXT,
          address_street TEXT,
          address_city TEXT,
          address_state TEXT,
          address_zip TEXT,
          membership_type TEXT NOT NULL,
          membership_start_date DATE NOT NULL,
          discount_1_cents INTEGER,
          discount_2_cents INTEGER,
          discount_3_cents INTEGER,
          discount_1_name TEXT,
          discount_2_name TEXT,
          discount_3_name TEXT,
          monthly_amount_cents INTEGER NOT NULL,
          group_id TEXT,
          group_name TEXT,
          discount_group_id INTEGER,
          household_members JSONB DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK(status IN ('pending_confirmation', 'confirmed')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          confirmed_at TIMESTAMP,
          created_by_admin_id INTEGER,
          FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_added_members_pending ON admin_added_members(primary_email) WHERE status = \'pending_confirmation\'');
      
      // Add discount name columns to admin_added_members if missing (existing production DBs)
      const aamColCheck = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_added_members' AND column_name IN ('discount_1_name', 'discount_2_name', 'discount_3_name')`);
      const existingAamCols = (aamColCheck.rows || []).map(r => r.column_name);
      for (const col of ['discount_1_name', 'discount_2_name', 'discount_3_name']) {
        if (!existingAamCols.includes(col)) {
          await client.query(`ALTER TABLE admin_added_members ADD COLUMN ${col} TEXT`);
          console.log('Added ' + col + ' column to admin_added_members table');
        }
      }
      
      const dgNameCheck = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'discount_groups' AND column_name = 'group_name'`);
      if (!dgNameCheck.rows || dgNameCheck.rows.length === 0) {
        await client.query('ALTER TABLE discount_groups ADD COLUMN group_name TEXT');
        console.log('Added group_name column to discount_groups table');
      }
      
      // Create schema (indexes will be created safely since column now exists)
      await client.query(POSTGRES_SCHEMA);

      // Ensure free_trials.question column exists for older databases
      try {
        const freeTrialColCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'free_trials' 
          AND column_name = 'question'
        `);
        if (!freeTrialColCheck.rows || freeTrialColCheck.rows.length === 0) {
          await client.query('ALTER TABLE free_trials ADD COLUMN question TEXT');
          console.log('Added question column to existing free_trials table');
        }
      } catch (e) {
        console.warn('Could not ensure free_trials.question column:', e.message);
      }

      console.log('PostgreSQL schema initialized');

      return client;
    } catch (error) {
      console.error('Error connecting to PostgreSQL:', error);
      throw error;
    }
  } else {
    // SQLite: ensure admin_added_members table and discount_groups.group_name exist
    function ensureAdminAddedMembersAndGroupName(db, done) {
      db.run(`
        CREATE TABLE IF NOT EXISTS admin_added_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          primary_email TEXT NOT NULL,
          primary_first_name TEXT,
          primary_last_name TEXT,
          primary_phone TEXT,
          address_street TEXT,
          address_city TEXT,
          address_state TEXT,
          address_zip TEXT,
          membership_type TEXT NOT NULL,
          membership_start_date DATE NOT NULL,
          discount_1_cents INTEGER,
          discount_2_cents INTEGER,
          discount_3_cents INTEGER,
          discount_1_name TEXT,
          discount_2_name TEXT,
          discount_3_name TEXT,
          monthly_amount_cents INTEGER NOT NULL,
          group_id TEXT,
          group_name TEXT,
          discount_group_id INTEGER,
          household_members TEXT DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK(status IN ('pending_confirmation', 'confirmed')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          confirmed_at DATETIME,
          created_by_admin_id INTEGER
        )
      `, (err) => {
        if (err) console.warn('admin_added_members table:', err.message);
        db.all("PRAGMA table_info(admin_added_members)", (err, cols) => {
          const colNames = (cols || []).map(c => c.name);
          const toAdd = ['discount_1_name', 'discount_2_name', 'discount_3_name'].filter(name => !colNames.includes(name));
          if (toAdd.length === 0) {
            ensureGroupName();
            return;
          }
          let i = 0;
          const addNext = () => {
            if (i >= toAdd.length) {
              ensureGroupName();
              return;
            }
            db.run(`ALTER TABLE admin_added_members ADD COLUMN ${toAdd[i]} TEXT`, (alterErr) => {
              if (!alterErr) console.log('Added ' + toAdd[i] + ' column to admin_added_members table');
              i++;
              addNext();
            });
          };
          addNext();
        });
        function ensureGroupName() {
          db.all("PRAGMA table_info(discount_groups)", (err, cols) => {
          const hasGroupName = cols && cols.some(c => c.name === 'group_name');
          if (!hasGroupName) {
            db.run("ALTER TABLE discount_groups ADD COLUMN group_name TEXT", (alterErr) => {
              if (!alterErr) console.log('Added group_name column to discount_groups table');
              done();
            });
          } else done();
        });
        }
      });
    }

    // SQLite initialization
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }
        console.log('Connected to SQLite database');
      });

      // Create tables
      db.serialize(() => {
        const statements = SQLITE_SCHEMA.split(';').filter(s => s.trim());
        
        // Process statements, but skip index creation for household_id if column doesn't exist
        let statementIndex = 0;
        const processNextStatement = () => {
          if (statementIndex >= statements.length) {
            // After all statements, check if household_id column exists and add it if needed
            db.get("PRAGMA table_info(gym_memberships)", (err, result) => {
              if (err) {
                resolve(db);
                return;
              }
              
              db.all("PRAGMA table_info(gym_memberships)", (err, columns) => {
                if (err) {
        resolve(db);
                  return;
                }
                
                const hasHouseholdId = columns && columns.some(col => col.name === 'household_id');
                
                if (!hasHouseholdId) {
                  // Add the column
                  db.run("ALTER TABLE gym_memberships ADD COLUMN household_id TEXT", (err) => {
                    if (err) {
                      console.warn('Could not add household_id column:', err.message);
                    } else {
                      // Create unique index
                      db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_memberships_household_id_unique ON gym_memberships(household_id) WHERE household_id IS NOT NULL", () => {});
                      // Create regular index
                      db.run("CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id ON gym_memberships(household_id)", () => {
                        console.log('Added household_id column to existing gym_memberships table');
                      });
                    }
                    // Check and add last_login, IP, and location columns to users table
                    db.all("PRAGMA table_info(users)", (err, userColumns) => {
                      if (err) {
                        resolve(db);
                        return;
                      }
                      const hasLastLogin = userColumns && userColumns.some(col => col.name === 'last_login');
                      const hasIP = userColumns && userColumns.some(col => col.name === 'last_login_ip');
                      const hasLocation = userColumns && userColumns.some(col => col.name === 'last_login_location');
                      const hasStripeCustomerId = userColumns && userColumns.some(col => col.name === 'stripe_customer_id');
                      
                      const addColumns = () => {
                        if (!hasLastLogin) {
                          db.run("ALTER TABLE users ADD COLUMN last_login DATETIME", (err) => {
                            if (err) console.warn('Could not add last_login column:', err.message);
                            else console.log('Added last_login column to existing users table');
                          });
                        }
                        if (!hasIP) {
                          db.run("ALTER TABLE users ADD COLUMN last_login_ip TEXT", (err) => {
                            if (err) console.warn('Could not add last_login_ip column:', err.message);
                            else console.log('Added last_login_ip column to existing users table');
                          });
                        }
                        if (!hasLocation) {
                          db.run("ALTER TABLE users ADD COLUMN last_login_location TEXT", (err) => {
                            if (err) console.warn('Could not add last_login_location column:', err.message);
                            else console.log('Added last_login_location column to existing users table');
                          });
                        }
                        if (!hasStripeCustomerId) {
                          db.run("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT", (err) => {
                            if (err) console.warn('Could not add stripe_customer_id column:', err.message);
                            else console.log('Added stripe_customer_id column to existing users table');
                          });
                        }
                        
                        // Add hybrid system columns to subscriptions and gym_memberships
                        addHybridSystemColumns(db, () => sqliteFixGymContractEnd29DayBug(db, () => resolve(db)));
                      };
                      
                      addColumns();
                    });
                  });
                } else {
                  // Column exists, just ensure indexes exist
                  db.run("CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id ON gym_memberships(household_id)", () => {
                    // Check and add last_login, IP, and location columns to users table
                    db.all("PRAGMA table_info(users)", (err, userColumns) => {
                      if (err) {
                        resolve(db);
                        return;
                      }
                      const hasLastLogin = userColumns && userColumns.some(col => col.name === 'last_login');
                      const hasIP = userColumns && userColumns.some(col => col.name === 'last_login_ip');
                      const hasLocation = userColumns && userColumns.some(col => col.name === 'last_login_location');
                      const hasStripeCustomerId = userColumns && userColumns.some(col => col.name === 'stripe_customer_id');
                      
                      const addColumns = () => {
                        if (!hasLastLogin) {
                          db.run("ALTER TABLE users ADD COLUMN last_login DATETIME", (err) => {
                            if (err) console.warn('Could not add last_login column:', err.message);
                            else console.log('Added last_login column to existing users table');
                          });
                        }
                        if (!hasIP) {
                          db.run("ALTER TABLE users ADD COLUMN last_login_ip TEXT", (err) => {
                            if (err) console.warn('Could not add last_login_ip column:', err.message);
                            else console.log('Added last_login_ip column to existing users table');
                          });
                        }
                        if (!hasLocation) {
                          db.run("ALTER TABLE users ADD COLUMN last_login_location TEXT", (err) => {
                            if (err) console.warn('Could not add last_login_location column:', err.message);
                            else console.log('Added last_login_location column to existing users table');
                          });
                        }
                        if (!hasStripeCustomerId) {
                          db.run("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT", (err) => {
                            if (err) console.warn('Could not add stripe_customer_id column:', err.message);
                            else console.log('Added stripe_customer_id column to existing users table');
                          });
                        }

                        // Ensure free_trials.question column exists for older databases
                        db.all("PRAGMA table_info(free_trials)", (err, freeTrialColumns) => {
                          if (err) {
                            // If we can't introspect, just move on
                            ensureAdminAddedMembersAndGroupName(db, () => addHybridSystemColumns(db, () => sqliteFixGymContractEnd29DayBug(db, () => resolve(db))));
                            return;
                          }
                          const hasQuestion = freeTrialColumns && freeTrialColumns.some(col => col.name === 'question');
                          if (!hasQuestion) {
                            db.run("ALTER TABLE free_trials ADD COLUMN question TEXT", (err) => {
                              if (err) {
                                console.warn('Could not add question column to free_trials:', err.message);
                              } else {
                                console.log('Added question column to existing free_trials table');
                              }
                              ensureAdminAddedMembersAndGroupName(db, () => addHybridSystemColumns(db, () => sqliteFixGymContractEnd29DayBug(db, () => resolve(db))));
                            });
                          } else {
                            ensureAdminAddedMembersAndGroupName(db, () => addHybridSystemColumns(db, () => sqliteFixGymContractEnd29DayBug(db, () => resolve(db))));
                          }
                        });
                      };
                      
                      addColumns();
                    });
                  });
                }
              });
            });
            return;
          }
          
          const statement = statements[statementIndex].trim();
          if (statement) {
            // Skip index creation for household_id during initial schema run (we'll add it after)
            if (statement.includes('idx_gym_memberships_household_id') && !statement.includes('CREATE TABLE')) {
              statementIndex++;
              processNextStatement();
              return;
            }
            
            db.run(statement, (err) => {
              if (err && !err.message.includes('already exists')) {
                console.warn('Schema statement warning:', err.message);
              }
              statementIndex++;
              processNextStatement();
            });
          } else {
            statementIndex++;
            processNextStatement();
          }
        };
        
        processNextStatement();
      });
    });
  }
}

// Database adapter to abstract differences between SQLite and PostgreSQL
class Database {
  constructor(db) {
    this.db = db;
    this.isPostgres = USE_POSTGRES;
  }

  // Normalize date fields to YYYY-MM-DD string format (date-only) or full ISO string (timestamps)
  // PostgreSQL returns Date objects, SQLite returns strings
  // created_at/updated_at preserve full timestamp for accurate timezone display
  normalizeDateFields(row) {
    if (!row) return row;
    
    // Create a copy to avoid mutating the original
    const normalized = { ...row };
    
    const dateOnlyFields = ['workout_date', 'start_date', 'end_date', 'membership_start_date'];
    const timestampFields = ['created_at', 'updated_at', 'last_login'];
    
    dateOnlyFields.forEach(field => {
      if (normalized[field] !== undefined && normalized[field] !== null) {
        if (typeof normalized[field] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(normalized[field])) {
          normalized[field] = normalized[field].split('T')[0].split(' ')[0];
        } else if (normalized[field] instanceof Date) {
          normalized[field] = normalized[field].toISOString().split('T')[0];
        } else if (typeof normalized[field] === 'string') {
          try {
            const date = new Date(normalized[field]);
            if (!isNaN(date.getTime())) {
              normalized[field] = date.toISOString().split('T')[0];
            }
          } catch (e) {}
        }
      }
    });
    
    timestampFields.forEach(field => {
      if (normalized[field] !== undefined && normalized[field] !== null) {
        if (normalized[field] instanceof Date) {
          normalized[field] = normalized[field].toISOString();
        } else if (typeof normalized[field] === 'string' && !normalized[field].endsWith('Z') && !/^\d{4}-\d{2}-\d{2}T/.test(normalized[field])) {
          try {
            const date = new Date(normalized[field]);
            if (!isNaN(date.getTime())) {
              normalized[field] = date.toISOString();
            }
          } catch (e) {}
        }
      }
    });
    
    // Ensure all original fields are preserved (including name, email, etc.)
    // The spread operator should handle this, but let's be explicit
    return normalized;
  }

  // Helper method to execute queries
  async query(sql, params = []) {
    if (this.isPostgres) {
      // PostgreSQL - sql should already use $1, $2, etc.
      const result = await this.db.query(sql, params);
      // Normalize date fields in all rows
      const normalizedRows = (result.rows || []).map(row => this.normalizeDateFields(row));
      return {
        rows: normalizedRows,
        lastID: result.rows[0]?.id || null,
        changes: result.rowCount || 0
      };
    } else {
      // SQLite - uses ? placeholders
      return new Promise((resolve, reject) => {
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
          this.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else {
              // Normalize date fields in all rows (SQLite may return strings, but normalize for consistency)
              const normalizedRows = (rows || []).map(row => this.normalizeDateFields(row));
              resolve({ rows: normalizedRows, lastID: null, changes: normalizedRows?.length || 0 });
            }
          });
        } else {
          this.db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ rows: [], lastID: this.lastID, changes: this.changes });
          });
        }
      });
    }
  }

  // Helper method for single row queries
  async queryOne(sql, params = []) {
    if (this.isPostgres) {
      // PostgreSQL - sql should already use $1, $2, etc.
      const result = await this.db.query(sql, params);
      const row = result.rows[0] || null;
      if (row) {
        const normalized = this.normalizeDateFields(row);
        console.log('queryOne (PostgreSQL) - row:', JSON.stringify(normalized, null, 2));
        return normalized;
      }
      console.log('queryOne (PostgreSQL) - no row found for query:', sql, 'params:', params);
      return null;
    } else {
      // SQLite - uses ? placeholders
      return new Promise((resolve, reject) => {
        this.db.get(sql, params, (err, row) => {
          if (err) {
            console.error('queryOne (SQLite) - error:', err);
            reject(err);
          } else {
            if (row) {
              const normalized = this.normalizeDateFields(row);
              console.log('queryOne (SQLite) - row:', JSON.stringify(normalized, null, 2));
              resolve(normalized);
            } else {
              console.log('queryOne (SQLite) - no row found for query:', sql, 'params:', params);
              resolve(null);
            }
          }
        });
      });
    }
  }


  // User operations
  async createUser(email, password, name = null) {
    const passwordHash = await bcrypt.hash(password, 10);
    // Try to insert with name if provided, but handle gracefully if column doesn't exist
    try {
      if (this.isPostgres) {
        const result = await this.query(
          'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
          [email, passwordHash, name]
        );
        return { id: result.rows[0]?.id, email, name };
      } else {
        const result = await this.query(
          'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
          [email, passwordHash, name]
        );
        return { id: result.lastID, email, name };
      }
    } catch (error) {
      // If name column doesn't exist, try without it
      if (error.message && error.message.includes('name')) {
        if (this.isPostgres) {
          const result = await this.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
            [email, passwordHash]
          );
          return { id: result.rows[0]?.id, email };
        } else {
          const result = await this.query(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            [email, passwordHash]
          );
          return { id: result.lastID, email };
        }
      }
      throw error;
    }
  }

  async updateUserName(userId, name) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE users SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [name, userId]
      );
      return result.changes > 0;
    } else {
      const result = await this.query(
        `UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?`,
        [name, userId]
      );
      return result.changes > 0;
    }
  }

  async getUserByEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const normalized = email.trim().toLowerCase();
    if (this.isPostgres) {
      return await this.queryOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = $1', [normalized]);
    } else {
      return await this.queryOne('SELECT * FROM users WHERE LOWER(TRIM(email)) = ?', [normalized]);
    }
  }

  async getUserById(id) {
    if (this.isPostgres) {
      return await this.queryOne('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [id]);
    } else {
      return await this.queryOne('SELECT id, email, name, role, created_at FROM users WHERE id = ?', [id]);
    }
  }

  // Subscription operations
  async createSubscription(userId, tier, stripeCustomerId, stripeSubscriptionId, endDate, status = 'active') {
    // Only cancel existing active rows when creating an active/grace period row.
    // For pending/incomplete attempts we must NOT replace the current paid tier.
    if (status === 'active' || status === 'grace_period' || status === 'free_trial') {
      const existingSubs = await this.getUserActiveSubscriptions(userId);
      if (existingSubs && existingSubs.length > 0) {
        console.log(`Canceling ${existingSubs.length} existing active subscription(s) for user ${userId} before creating new one`);
        for (const sub of existingSubs) {
          await this.updateSubscriptionStatus(sub.id, 'canceled');
        }
      }
    }

    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, end_date, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, tier, stripeCustomerId, stripeSubscriptionId, endDate, status]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, end_date, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, tier, stripeCustomerId, stripeSubscriptionId, endDate, status]
      );
      return { id: result.lastID };
    }
  }

  async updateSubscriptionStatus(subscriptionId, status, oldStatus = null, reason = null, stripeEventId = null) {
    // Record status change in history
    if (oldStatus !== status) {
      await this.recordSubscriptionStatusChange(subscriptionId, 'app_subscription', oldStatus, status, reason, stripeEventId);
    }
    
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions SET status = $1 WHERE id = $2`,
        [status, subscriptionId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE subscriptions SET status = ? WHERE id = ?`,
        [status, subscriptionId]
      );
      return { changes: result.changes || 0 };
    }
  }

  /** Set canceled_by_user_at so we can show "Canceled" (user canceled) vs "Expired" (lapsed). */
  async setSubscriptionCanceledByUser(subscriptionId) {
    if (this.isPostgres) {
      await this.query(
        `UPDATE subscriptions SET canceled_by_user_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [subscriptionId]
      );
    } else {
      await this.query(
        `UPDATE subscriptions SET canceled_by_user_at = datetime('now') WHERE id = ?`,
        [subscriptionId]
      );
    }
  }
  
  // Record subscription status change in history
  async recordSubscriptionStatusChange(subscriptionId, subscriptionType, oldStatus, newStatus, reason = null, stripeEventId = null) {
    if (this.isPostgres) {
      await this.query(
        `INSERT INTO subscription_status_history (subscription_id, subscription_type, old_status, new_status, reason, stripe_event_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subscriptionId, subscriptionType, oldStatus, newStatus, reason, stripeEventId]
      );
    } else {
      await this.query(
        `INSERT INTO subscription_status_history (subscription_id, subscription_type, old_status, new_status, reason, stripe_event_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [subscriptionId, subscriptionType, oldStatus, newStatus, reason, stripeEventId]
      );
    }
  }
  
  // Update subscription payment method
  async updateSubscriptionPaymentMethod(subscriptionId, paymentMethodId, expiresAt = null) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_method_id = $1, payment_method_expires_at = $2 
         WHERE id = $3`,
        [paymentMethodId, expiresAt, subscriptionId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_method_id = ?, payment_method_expires_at = ? 
         WHERE id = ?`,
        [paymentMethodId, expiresAt, subscriptionId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Update subscription payment failure tracking
  async recordPaymentFailure(subscriptionId, failureCount, lastFailureAt, gracePeriodEndsAt) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_failure_count = $1, last_payment_failure_at = $2, grace_period_ends_at = $3,
             status = CASE WHEN $3 IS NOT NULL AND $3 > CURRENT_TIMESTAMP THEN 'grace_period' ELSE status END
         WHERE id = $4`,
        [failureCount, lastFailureAt, gracePeriodEndsAt, subscriptionId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_failure_count = ?, last_payment_failure_at = ?, grace_period_ends_at = ?,
             status = CASE WHEN ? IS NOT NULL AND datetime(?) > datetime('now') THEN 'grace_period' ELSE status END
         WHERE id = ?`,
        [failureCount, lastFailureAt, gracePeriodEndsAt, gracePeriodEndsAt, gracePeriodEndsAt, subscriptionId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Reset payment failure tracking after successful payment
  async resetPaymentFailures(subscriptionId) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL,
             status = CASE WHEN status = 'grace_period' THEN 'active' ELSE status END
         WHERE id = $1`,
        [subscriptionId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE subscriptions 
         SET payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL,
             status = CASE WHEN status = 'grace_period' THEN 'active' ELSE status END
         WHERE id = ?`,
        [subscriptionId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Get subscriptions expiring soon (for renewal job)
  async getSubscriptionsExpiringSoon(daysAhead = 2) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM subscriptions 
         WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date <= CURRENT_TIMESTAMP + INTERVAL '${daysAhead} days'
         AND end_date > CURRENT_TIMESTAMP
         ORDER BY end_date ASC`,
        []
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT * FROM subscriptions 
         WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND datetime(end_date) <= datetime('now', '+${daysAhead} days')
         AND datetime(end_date) > datetime('now')
         ORDER BY end_date ASC`,
        []
      );
      return result.rows || [];
    }
  }
  
  // Check if webhook event has been processed (idempotency)
  async isWebhookProcessed(stripeEventId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT id FROM webhook_events WHERE stripe_event_id = $1`,
        [stripeEventId]
      );
      return result.rows.length > 0;
    } else {
      const result = await this.query(
        `SELECT id FROM webhook_events WHERE stripe_event_id = ?`,
        [stripeEventId]
      );
      return result.rows.length > 0;
    }
  }
  
  // Mark webhook event as processed
  async markWebhookProcessed(stripeEventId, eventType, data = null) {
    if (this.isPostgres) {
      await this.query(
        `INSERT INTO webhook_events (stripe_event_id, event_type, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (stripe_event_id) DO NOTHING`,
        [stripeEventId, eventType, data ? JSON.stringify(data) : null]
      );
    } else {
      await this.query(
        `INSERT OR IGNORE INTO webhook_events (stripe_event_id, event_type, data)
         VALUES (?, ?, ?)`,
        [stripeEventId, eventType, data ? JSON.stringify(data) : null]
      );
    }
  }

  // Record app payment/subscription errors for admin visibility
  async createAppPaymentErrorLog({
    userId = null,
    userEmail = null,
    stripeCustomerId = null,
    stripeSubscriptionId = null,
    stripePaymentIntentId = null,
    tier = null,
    eventType,
    severity = 'warning',
    message,
    details = null
  }) {
    if (!eventType || !message) return;
    if (this.isPostgres) {
      await this.query(
        `INSERT INTO app_payment_error_logs
         (user_id, user_email, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, tier, event_type, severity, message, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          userId,
          userEmail,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePaymentIntentId,
          tier,
          eventType,
          severity,
          message,
          details ? JSON.stringify(details) : null
        ]
      );
    } else {
      await this.query(
        `INSERT INTO app_payment_error_logs
         (user_id, user_email, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, tier, event_type, severity, message, details)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          userId,
          userEmail,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePaymentIntentId,
          tier,
          eventType,
          severity,
          message,
          details ? JSON.stringify(details) : null
        ]
      );
    }
  }

  async getAppPaymentErrorLogs(limit = 200) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM app_payment_error_logs ORDER BY created_at DESC LIMIT $1`,
        [safeLimit]
      );
      return result.rows || [];
    }
    const result = await this.query(
      `SELECT * FROM app_payment_error_logs ORDER BY created_at DESC LIMIT ?`,
      [safeLimit]
    );
    return result.rows || [];
  }
  
  // ========== Gym Membership Payment Tracking Methods ==========
  
  // Update gym membership payment method
  async updateGymMembershipPaymentMethod(membershipId, paymentMethodId, expiresAt = null) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_method_id = $1, payment_method_expires_at = $2 
         WHERE id = $3`,
        [paymentMethodId, expiresAt, membershipId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_method_id = ?, payment_method_expires_at = ? 
         WHERE id = ?`,
        [paymentMethodId, expiresAt, membershipId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Update gym membership payment failure tracking
  async recordGymMembershipPaymentFailure(membershipId, failureCount, lastFailureAt, gracePeriodEndsAt) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_failure_count = $1, last_payment_failure_at = $2, grace_period_ends_at = $3,
             status = CASE WHEN $3 IS NOT NULL AND $3 > CURRENT_TIMESTAMP THEN 'grace_period' ELSE status END
         WHERE id = $4`,
        [failureCount, lastFailureAt, gracePeriodEndsAt, membershipId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_failure_count = ?, last_payment_failure_at = ?, grace_period_ends_at = ?,
             status = CASE WHEN ? IS NOT NULL AND datetime(?) > datetime('now') THEN 'grace_period' ELSE status END
         WHERE id = ?`,
        [failureCount, lastFailureAt, gracePeriodEndsAt, gracePeriodEndsAt, gracePeriodEndsAt, membershipId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Reset gym membership payment failure tracking after successful payment
  async resetGymMembershipPaymentFailures(membershipId) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL,
             status = CASE WHEN status = 'grace_period' THEN 'active' ELSE status END
         WHERE id = $1`,
        [membershipId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE gym_memberships 
         SET payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL,
             status = CASE WHEN status = 'grace_period' THEN 'active' ELSE status END
         WHERE id = ?`,
        [membershipId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Update gym membership status with history tracking
  async updateGymMembershipStatus(membershipId, status, oldStatus = null, reason = null, stripeEventId = null) {
    // Record status change in history (using membershipId as subscription_id for history table)
    if (oldStatus !== status) {
      await this.recordSubscriptionStatusChange(membershipId, 'gym_membership', oldStatus, status, reason, stripeEventId);
    }
    
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE gym_memberships SET status = $1 WHERE id = $2`,
        [status, membershipId]
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE gym_memberships SET status = ? WHERE id = ?`,
        [status, membershipId]
      );
      return { changes: result.changes || 0 };
    }
  }
  
  // Get gym memberships expiring soon (for renewal job) — due in the next N days only
  async getGymMembershipsExpiringSoon(daysAhead = 2) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM gym_memberships 
         WHERE status = 'active' 
         AND contract_end_date IS NOT NULL 
         AND contract_end_date <= CURRENT_TIMESTAMP + INTERVAL '${daysAhead} days'
         AND contract_end_date > CURRENT_TIMESTAMP
         ORDER BY contract_end_date ASC`,
        []
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT * FROM gym_memberships 
         WHERE status = 'active' 
         AND contract_end_date IS NOT NULL 
         AND datetime(contract_end_date) <= datetime('now', '+${daysAhead} days')
         AND datetime(contract_end_date) > datetime('now')
         ORDER BY contract_end_date ASC`,
        []
      );
      return result.rows || [];
    }
  }

  // Get gym memberships due or already overdue (contract_end_date on or before today + daysAhead).
  // Used by nightly job so we charge both "due soon" and "overdue" (e.g. missed charge).
  async getGymMembershipsDueOrOverdue(daysAhead = 2) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT gm.* FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status IN ('active', 'grace_period')
         AND gm.contract_end_date IS NOT NULL
         AND gm.contract_end_date::date <= (CURRENT_DATE + INTERVAL '${daysAhead} days')
         AND u.role <> 'tester'
         ORDER BY gm.contract_end_date ASC`,
        []
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT gm.* FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status IN ('active', 'grace_period')
         AND gm.contract_end_date IS NOT NULL
         AND date(gm.contract_end_date) <= date('now', '+${daysAhead} days')
         AND u.role <> 'tester'
         ORDER BY gm.contract_end_date ASC`,
        []
      );
      return result.rows || [];
    }
  }

  /**
   * Admin "Upcoming Transactions" list for gym memberships (due/overdue by contract_end_date).
   * Excludes known testing accounts.
   */
  async getUpcomingGymTransactionsAdmin(daysAhead = 14) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT gm.id, gm.user_id, gm.membership_type, gm.status, gm.contract_end_date,
                COALESCE(gm.contract_end_date, gm.end_date) AS due_date_source,
                gm.monthly_amount_cents,
                COALESCE(NULLIF(gm.monthly_amount_cents, 0),
                  CASE gm.membership_type
                    WHEN 'standard' THEN 6500
                    WHEN 'immediate_family_member' THEN 5000
                    WHEN 'expecting_or_recovering_mother' THEN 3000
                    WHEN 'entire_family' THEN 18500
                    ELSE NULL
                  END
                ) AS amount_due_cents,
                gm.payment_method_id, gm.stripe_customer_id,
                (SELECT MAX(p.created_at)
                 FROM payments p
                 WHERE p.user_id = gm.user_id
                   AND p.tier IN ('gym_membership', 'gym_membership_late_fee')
                   AND p.status = 'succeeded') AS last_success_gym_payment_at,
                u.name, u.email
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status IN ('active', 'grace_period', 'inactive')
           AND COALESCE(gm.membership_type, '') <> 'free_trial'
           AND gm.status <> 'free_trial'
           AND COALESCE(gm.contract_end_date, gm.end_date) IS NOT NULL
           AND COALESCE(gm.contract_end_date, gm.end_date)::date <= (CURRENT_DATE + INTERVAL '${daysAhead} days')
           AND (gm.family_group_id IS NULL OR gm.is_primary_member IS TRUE)
           AND u.role <> 'tester'
           AND u.email NOT ILIKE 'prod-test%@example.com'
           AND u.email NOT ILIKE 'qa.%@example.com'
           AND COALESCE(u.name, '') NOT ILIKE 'test %'
         ORDER BY COALESCE(gm.contract_end_date, gm.end_date) ASC, COALESCE(u.name, u.email) ASC`,
        []
      );
      return result.rows || [];
    }
    const result = await this.query(
      `SELECT gm.id, gm.user_id, gm.membership_type, gm.status, gm.contract_end_date,
              COALESCE(gm.contract_end_date, gm.end_date) AS due_date_source,
              gm.monthly_amount_cents,
              COALESCE(NULLIF(gm.monthly_amount_cents, 0),
                CASE gm.membership_type
                  WHEN 'standard' THEN 6500
                  WHEN 'immediate_family_member' THEN 5000
                  WHEN 'expecting_or_recovering_mother' THEN 3000
                  WHEN 'entire_family' THEN 18500
                  ELSE NULL
                END
              ) AS amount_due_cents,
              gm.payment_method_id, gm.stripe_customer_id,
              (SELECT MAX(p.created_at)
               FROM payments p
               WHERE p.user_id = gm.user_id
                 AND p.tier IN ('gym_membership', 'gym_membership_late_fee')
                 AND p.status = 'succeeded') AS last_success_gym_payment_at,
              u.name, u.email
       FROM gym_memberships gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.status IN ('active', 'grace_period', 'inactive')
         AND COALESCE(gm.membership_type, '') <> 'free_trial'
         AND gm.status <> 'free_trial'
         AND COALESCE(gm.contract_end_date, gm.end_date) IS NOT NULL
         AND date(COALESCE(gm.contract_end_date, gm.end_date)) <= date('now', '+${daysAhead} days')
         AND (gm.family_group_id IS NULL OR COALESCE(gm.is_primary_member, 0) = 1)
         AND u.role <> 'tester'
         AND u.email NOT LIKE 'prod-test%@example.com'
         AND LOWER(u.email) NOT LIKE 'qa.%@example.com'
         AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
       ORDER BY COALESCE(gm.contract_end_date, gm.end_date) ASC, COALESCE(u.name, u.email) ASC`,
      []
    );
    return result.rows || [];
  }

  /**
   * Admin upcoming: paid app subscriptions (tier_two+ / legacy paid tiers), primary sub per user,
   * renewal/end_date within window or overdue. Excludes free_trial and tier_one.
   */
  async getUpcomingAppSubscriptionTransactionsAdmin(daysAhead = 60) {
    const paidTiers = "('tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')";
    const subOrderPg = `
      ORDER BY
        CASE s2.status WHEN 'active' THEN 0 WHEN 'grace_period' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        s2.end_date DESC NULLS LAST,
        s2.id DESC
      LIMIT 1`;
    const subOrderSqlite = `
      ORDER BY
        CASE s2.status WHEN 'active' THEN 0 WHEN 'grace_period' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        s2.end_date DESC,
        s2.id DESC
      LIMIT 1`;
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT s.id, s.user_id, s.tier, s.status, s.end_date,
                s.payment_method_id, s.stripe_customer_id,
                u.name, u.email,
                CASE COALESCE(s.tier, '')
                  WHEN 'tier_two' THEN 700 WHEN 'daily' THEN 700
                  WHEN 'tier_three' THEN 1200 WHEN 'weekly' THEN 1200
                  WHEN 'tier_four' THEN 1800 WHEN 'monthly' THEN 1800
                  ELSE 0
                END AS amount_due_cents
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         WHERE s.tier IN ${paidTiers}
           AND s.status IN ('active', 'grace_period')
           AND s.end_date IS NOT NULL
           AND s.end_date::date <= CURRENT_DATE + ${Math.min(120, Math.max(0, parseInt(daysAhead, 10) || 60))}
           AND s.id = (
             SELECT s2.id FROM subscriptions s2
             WHERE s2.user_id = s.user_id AND s2.tier IN ${paidTiers}
             ${subOrderPg}
           )
           AND u.role <> 'tester'
           AND u.email NOT ILIKE 'prod-test%@example.com'
           AND u.email NOT ILIKE 'qa.%@example.com'
           AND COALESCE(u.name, '') NOT ILIKE 'test %'
         ORDER BY s.end_date ASC, COALESCE(u.name, u.email) ASC`,
        []
      );
      return result.rows || [];
    }
    const d = Math.min(120, Math.max(0, parseInt(daysAhead, 10) || 60));
    const result = await this.query(
      `SELECT s.id, s.user_id, s.tier, s.status, s.end_date,
              s.payment_method_id, s.stripe_customer_id,
              u.name, u.email,
              CASE COALESCE(s.tier, '')
                WHEN 'tier_two' THEN 700 WHEN 'daily' THEN 700
                WHEN 'tier_three' THEN 1200 WHEN 'weekly' THEN 1200
                WHEN 'tier_four' THEN 1800 WHEN 'monthly' THEN 1800
                ELSE 0
              END AS amount_due_cents
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.tier IN ${paidTiers}
         AND s.status IN ('active', 'grace_period')
         AND s.end_date IS NOT NULL
         AND date(s.end_date) <= date('now', '+${d} days')
         AND s.id = (
           SELECT s2.id FROM subscriptions s2
           WHERE s2.user_id = s.user_id AND s2.tier IN ${paidTiers}
           ${subOrderSqlite}
         )
         AND u.role <> 'tester'
         AND u.email NOT LIKE 'prod-test%@example.com'
         AND LOWER(u.email) NOT LIKE 'qa.%@example.com'
         AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
       ORDER BY s.end_date ASC, COALESCE(u.name, u.email) ASC`,
      []
    );
    return result.rows || [];
  }

  /** Admin: all payment rows with user info, newest first (processed history). */
  async getPastTransactionsAdmin(limit = 2000) {
    const lim = Math.min(5000, Math.max(1, parseInt(limit, 10) || 2000));
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT p.id, p.user_id, p.stripe_payment_intent_id, p.amount, p.currency, p.tier, p.status, p.email AS payment_email, p.created_at,
                u.name, u.email AS user_email
         FROM payments p
         JOIN users u ON u.id = p.user_id
         WHERE u.role <> 'tester'
           AND u.email NOT ILIKE 'prod-test%@example.com'
           AND u.email NOT ILIKE 'qa.%@example.com'
           AND COALESCE(u.name, '') NOT ILIKE 'test %'
         ORDER BY p.created_at DESC
         LIMIT $1`,
        [lim]
      );
      return result.rows || [];
    }
    const result = await this.query(
      `SELECT p.id, p.user_id, p.stripe_payment_intent_id, p.amount, p.currency, p.tier, p.status, p.email AS payment_email, p.created_at,
              u.name, u.email AS user_email
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE u.role <> 'tester'
         AND u.email NOT LIKE 'prod-test%@example.com'
         AND LOWER(u.email) NOT LIKE 'qa.%@example.com'
         AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [lim]
    );
    return result.rows || [];
  }

  // Get paused gym memberships ready to resume (paused_until has passed).
  async getPausedGymMembershipsReadyToResume() {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT gm.* FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status = 'paused'
         AND gm.paused_until IS NOT NULL
         AND gm.paused_until::date <= CURRENT_DATE
         AND u.role <> 'tester'
         ORDER BY gm.paused_until ASC`,
        []
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT gm.* FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status = 'paused'
         AND gm.paused_until IS NOT NULL
         AND date(gm.paused_until) <= date('now')
         AND u.role <> 'tester'
         ORDER BY gm.paused_until ASC`,
        []
      );
      return result.rows || [];
    }
  }

  // Admin-added members (migration from old system)
  async insertAdminAddedMember(row) {
    const {
      primary_email, primary_first_name, primary_last_name, primary_phone,
      address_street, address_city, address_state, address_zip,
      membership_type, membership_start_date,
      discount_1_cents, discount_2_cents, discount_3_cents,
      discount_1_name, discount_2_name, discount_3_name,
      monthly_amount_cents,
      group_id, group_name, discount_group_id, household_members, created_by_admin_id
    } = row;
    const householdJson = typeof household_members === 'string' ? household_members : JSON.stringify(household_members || []);
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO admin_added_members (
          primary_email, primary_first_name, primary_last_name, primary_phone,
          address_street, address_city, address_state, address_zip,
          membership_type, membership_start_date,
          discount_1_cents, discount_2_cents, discount_3_cents,
          discount_1_name, discount_2_name, discount_3_name,
          monthly_amount_cents,
          group_id, group_name, discount_group_id, household_members, created_by_admin_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING id`,
        [primary_email, primary_first_name || null, primary_last_name || null, primary_phone || null,
          address_street || null, address_city || null, address_state || null, address_zip || null,
          membership_type, membership_start_date,
          discount_1_cents ?? null, discount_2_cents ?? null, discount_3_cents ?? null,
          discount_1_name || null, discount_2_name || null, discount_3_name || null,
          monthly_amount_cents,
          group_id || null, group_name || null, discount_group_id ?? null, householdJson, created_by_admin_id ?? null]
      );
      return result.rows?.[0]?.id;
    } else {
      const result = await this.query(
        `INSERT INTO admin_added_members (
          primary_email, primary_first_name, primary_last_name, primary_phone,
          address_street, address_city, address_state, address_zip,
          membership_type, membership_start_date,
          discount_1_cents, discount_2_cents, discount_3_cents,
          discount_1_name, discount_2_name, discount_3_name,
          monthly_amount_cents,
          group_id, group_name, discount_group_id, household_members, created_by_admin_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [primary_email, primary_first_name || null, primary_last_name || null, primary_phone || null,
          address_street || null, address_city || null, address_state || null, address_zip || null,
          membership_type, membership_start_date,
          discount_1_cents ?? null, discount_2_cents ?? null, discount_3_cents ?? null,
          discount_1_name || null, discount_2_name || null, discount_3_name || null,
          monthly_amount_cents,
          group_id || null, group_name || null, discount_group_id ?? null, householdJson, created_by_admin_id ?? null]
      );
      return result.lastID;
    }
  }

  async getPendingMigrationByEmail(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    const row = this.isPostgres
      ? await this.queryOne(
          'SELECT * FROM admin_added_members WHERE LOWER(primary_email) = $1 AND status = $2 LIMIT 1',
          [normalized, 'pending_confirmation']
        )
      : await this.queryOne(
          'SELECT * FROM admin_added_members WHERE LOWER(primary_email) = ? AND status = ? LIMIT 1',
          [normalized, 'pending_confirmation']
        );
    if (row && row.household_members) {
      if (typeof row.household_members === 'string') row.household_members = JSON.parse(row.household_members || '[]');
    }
    return row;
  }

  /** Get the most recent admin_added_members row for an email (any status). Used to recover discount names for confirmed members. */
  async getAdminAddedMemberByEmailAnyStatus(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    const row = this.isPostgres
      ? await this.queryOne(
          'SELECT id, primary_email, discount_1_name, discount_2_name, discount_3_name FROM admin_added_members WHERE LOWER(primary_email) = $1 ORDER BY id DESC LIMIT 1',
          [normalized]
        )
      : await this.queryOne(
          'SELECT id, primary_email, discount_1_name, discount_2_name, discount_3_name FROM admin_added_members WHERE LOWER(primary_email) = ? ORDER BY id DESC LIMIT 1',
          [normalized]
        );
    return row;
  }

  async setAdminAddedMemberConfirmed(id) {
    if (this.isPostgres) {
      await this.query(
        'UPDATE admin_added_members SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['confirmed', id]
      );
    } else {
      await this.query(
        "UPDATE admin_added_members SET status = ?, confirmed_at = datetime('now') WHERE id = ?",
        ['confirmed', id]
      );
    }
  }

  async setAdminAddedMemberPending(id) {
    if (this.isPostgres) {
      await this.query(
        "UPDATE admin_added_members SET status = 'pending_confirmation', confirmed_at = NULL WHERE id = $1",
        [id]
      );
    } else {
      await this.query(
        "UPDATE admin_added_members SET status = 'pending_confirmation', confirmed_at = NULL WHERE id = ?",
        [id]
      );
    }
  }

  /** Delete an admin_added_members row only if it is still pending_confirmation. Returns number of rows deleted. */
  async deleteAdminAddedMemberIfPending(id) {
    if (this.isPostgres) {
      const result = await this.query(
        'DELETE FROM admin_added_members WHERE id = $1 AND status = $2',
        [id, 'pending_confirmation']
      );
      // In PostgreSQL, DELETE doesn't return rowCount via rows; use result.rowCount
      return result.rowCount || 0;
    } else {
      const result = await this.query(
        'DELETE FROM admin_added_members WHERE id = ? AND status = ?',
        [id, 'pending_confirmation']
      );
      // For sqlite3 wrapper, changes count is in result.changes when available
      return result.changes != null ? result.changes : 0;
    }
  }

  /** List admin-added members for admin members table: includes membership_type, membership_start_date. Returns pending_confirmation by default to avoid duplicating confirmed (they appear in gym list). */
  async getAdminAddedMembersForAdminList(opts = {}) {
    const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 500, 1), 1000);
    const pendingOnly = opts.pending_only !== false;
    if (this.isPostgres) {
      let sql = `SELECT id, primary_email, primary_first_name, primary_last_name, primary_phone, status, created_at, membership_type, membership_start_date,
                 address_street, address_city, address_state, address_zip
                 FROM admin_added_members WHERE 1=1`;
      const params = [];
      if (pendingOnly) {
        params.push('pending_confirmation');
        sql += ` AND status = $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const result = await this.query(sql, params);
      return result.rows || [];
    } else {
      let sql = `SELECT id, primary_email, primary_first_name, primary_last_name, primary_phone, status, created_at, membership_type, membership_start_date,
                 address_street, address_city, address_state, address_zip
                 FROM admin_added_members WHERE 1=1`;
      const params = [];
      if (pendingOnly) {
        params.push('pending_confirmation');
        sql += ' AND status = ?';
      }
      params.push(limit);
      sql += ' ORDER BY created_at DESC LIMIT ?';
      const result = await this.query(sql, params);
      return result.rows || [];
    }
  }

  // Reset latest app subscription for a user to active starting today (used for first-login corrections).
  async resetLatestSubscriptionToActiveForUser(userId, daysAhead = 30) {
    if (!userId) return 0;
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + daysAhead);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const newEnd = fmt(future);
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions
         SET status = 'active', end_date = $1
         WHERE id = (
           SELECT id FROM subscriptions
           WHERE user_id = $2
           ORDER BY end_date DESC NULLS LAST, created_at DESC
           LIMIT 1
         )`,
        [newEnd, userId]
      );
      return result.changes || 0;
    } else {
      const result = await this.query(
        `UPDATE subscriptions
         SET status = 'active', end_date = ?
         WHERE id = (
           SELECT id FROM subscriptions
           WHERE user_id = ?
           ORDER BY end_date DESC, created_at DESC
           LIMIT 1
         )`,
        [newEnd, userId]
      );
      return result.changes || 0;
    }
  }

  /** List admin-added members, optionally filtered by first/last name. Returns id, primary_email, primary_first_name, primary_last_name, status, created_at. */
  async listAdminAddedMembers(opts = {}) {
    const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 200);
    const first = (opts.first_name || opts.first || '').trim();
    const last = (opts.last_name || opts.last || '').trim();
    if (this.isPostgres) {
      let sql = 'SELECT id, primary_email, primary_first_name, primary_last_name, status, created_at FROM admin_added_members WHERE 1=1';
      const params = [];
      if (first) {
        params.push('%' + first + '%');
        sql += ` AND primary_first_name ILIKE $${params.length}`;
      }
      if (last) {
        params.push('%' + last + '%');
        sql += ` AND primary_last_name ILIKE $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const result = await this.query(sql, params);
      return result.rows || [];
    } else {
      let sql = 'SELECT id, primary_email, primary_first_name, primary_last_name, status, created_at FROM admin_added_members WHERE 1=1';
      const params = [];
      if (first) {
        params.push('%' + first + '%');
        sql += ' AND primary_first_name LIKE ?';
      }
      if (last) {
        params.push('%' + last + '%');
        sql += ' AND primary_last_name LIKE ?';
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const result = await this.query(sql, params);
      return result.rows || [];
    }
  }

  async createDiscountGroup(leaderUserId, groupName = null) {
    const groupId = `GRP-${Date.now().toString().slice(-6)}`;
    const groupAccessCode = `CODE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    if (this.isPostgres) {
      const hasGroupName = await this.queryOne(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'discount_groups' AND column_name = 'group_name'"
      );
      if (hasGroupName) {
        const result = await this.query(
          `INSERT INTO discount_groups (group_id, group_access_code, group_leader_id, group_name) VALUES ($1, $2, $3, $4) RETURNING id, group_id, group_access_code, group_name`,
          [groupId, groupAccessCode, leaderUserId, groupName || null]
        );
        return result.rows[0];
      }
      const result = await this.query(
        `INSERT INTO discount_groups (group_id, group_access_code, group_leader_id) VALUES ($1, $2, $3) RETURNING id, group_id, group_access_code`,
        [groupId, groupAccessCode, leaderUserId]
      );
      return { ...result.rows[0], group_name: groupName || null };
    } else {
      const result = await this.query(
        'INSERT INTO discount_groups (group_id, group_access_code, group_leader_id, group_name) VALUES (?, ?, ?, ?)',
        [groupId, groupAccessCode, leaderUserId, groupName || null]
      );
      const id = result.lastID;
      const row = await this.queryOne('SELECT * FROM discount_groups WHERE id = ?', [id]);
      return row || { id, group_id: groupId, group_access_code: groupAccessCode, group_name: groupName };
    }
  }

  async getDiscountGroupByGroupId(groupId) {
    return this.isPostgres
      ? this.queryOne('SELECT * FROM discount_groups WHERE group_id = $1', [groupId])
      : this.queryOne('SELECT * FROM discount_groups WHERE group_id = ?', [groupId]);
  }

  // Update subscription fields (tier, status, etc.)
  async updateSubscription(subscriptionId, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (updates.tier !== undefined) {
      fields.push(this.isPostgres ? `tier = $${paramIndex++}` : `tier = ?`);
      values.push(updates.tier);
    }
    if (updates.status !== undefined) {
      fields.push(this.isPostgres ? `status = $${paramIndex++}` : `status = ?`);
      values.push(updates.status);
    }
    if (updates.end_date !== undefined) {
      fields.push(this.isPostgres ? `end_date = $${paramIndex++}` : `end_date = ?`);
      values.push(updates.end_date);
    }
    if (updates.stripe_customer_id !== undefined) {
      fields.push(this.isPostgres ? `stripe_customer_id = $${paramIndex++}` : `stripe_customer_id = ?`);
      values.push(updates.stripe_customer_id);
    }
    if (updates.stripe_subscription_id !== undefined) {
      fields.push(this.isPostgres ? `stripe_subscription_id = $${paramIndex++}` : `stripe_subscription_id = ?`);
      values.push(updates.stripe_subscription_id);
    }

    if (fields.length === 0) {
      return { changes: 0 };
    }

    values.push(subscriptionId);

    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE subscriptions SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
      return { changes: result.rowCount || 0 };
    } else {
      const result = await this.query(
        `UPDATE subscriptions SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      return { changes: result.changes || 0 };
    }
  }

  async getUserActiveSubscription(userId) {
    // Hybrid system: Include subscriptions in grace_period as active (they still have access).
    // Prefer Stripe-backed rows, then newest row. Do NOT bias by tier rank.
    // Tier rank ordering can surface the wrong subscription when users change plans.
    const orderBy = `
         ORDER BY
           (CASE WHEN stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id::text) != '' THEN 1 ELSE 0 END) DESC,
           created_at DESC
         LIMIT 1`;
    const orderBySqlite = `
         ORDER BY
           (CASE WHEN stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) != '' THEN 1 ELSE 0 END) DESC,
           created_at DESC
         LIMIT 1`;
    if (this.isPostgres) {
      return await this.queryOne(
        `SELECT * FROM subscriptions 
         WHERE user_id = $1 
         AND (status = 'active' OR status = 'grace_period' OR status = 'free_trial')
         AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
         AND (status != 'grace_period' OR grace_period_ends_at IS NULL OR grace_period_ends_at > CURRENT_TIMESTAMP)
         ${orderBy}`,
        [userId]
      );
    } else {
      return await this.queryOne(
        `SELECT * FROM subscriptions 
         WHERE user_id = ? 
         AND (status = 'active' OR status = 'grace_period' OR status = 'free_trial')
         AND (end_date IS NULL OR datetime(end_date) > datetime('now'))
         AND (status != 'grace_period' OR grace_period_ends_at IS NULL OR datetime(grace_period_ends_at) > datetime('now'))
         ${orderBySqlite}`,
        [userId]
      );
    }
  }

  // Get all active subscriptions for a user (used to prevent duplicates)
  // Hybrid system: Include subscriptions in grace_period as active
  async getUserActiveSubscriptions(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM subscriptions 
         WHERE user_id = $1 
         AND (status = 'active' OR status = 'grace_period' OR status = 'free_trial')
         AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
         AND (status != 'grace_period' OR grace_period_ends_at IS NULL OR grace_period_ends_at > CURRENT_TIMESTAMP)
         ORDER BY created_at DESC`,
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT * FROM subscriptions 
         WHERE user_id = ? 
         AND (status = 'active' OR status = 'grace_period' OR status = 'free_trial')
         AND (end_date IS NULL OR datetime(end_date) > datetime('now'))
         AND (status != 'grace_period' OR grace_period_ends_at IS NULL OR datetime(grace_period_ends_at) > datetime('now'))
         ORDER BY created_at DESC`,
        [userId]
      );
      // SQLite query returns { rows: [...] } from the query method
      return result.rows || [];
    }
  }

  // Get the most recent subscription (active or expired) for a user
  async getUserLatestSubscription(userId) {
    if (this.isPostgres) {
      return await this.queryOne(
        `SELECT * FROM subscriptions 
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
    } else {
      return await this.queryOne(
        `SELECT * FROM subscriptions 
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
    }
  }

  /**
   * For staff (admin/tester): get subscription with an expiration date, and auto-renew (extend by 30 days)
   * when that date has passed so access is never interrupted.
   * Returns subscription with end_date set (or extended), or null if user is not staff.
   */
  async getOrExtendStaffSubscription(userId, user) {
    if (!user || (user.role !== 'admin' && user.role !== 'tester')) {
      return null;
    }
    const { normalizeTier } = require('./payments');
    const { endOfDayDenverPlusDaysFromStartOfToday } = require('./lib/mountain-time');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDateISO = endOfDayDenverPlusDaysFromStartOfToday(30);

    let latest = await this.getUserLatestSubscription(userId);
    // Staff must always have Tier Four-equivalent access in the app (avoid stale tier_one/tier_two rows).
    if (latest) {
      try {
        const nt = normalizeTier(latest.tier);
        if (nt !== 'tier_four') {
          await this.updateSubscription(latest.id, { tier: 'tier_four', status: 'active' });
          latest = await this.getUserLatestSubscription(userId);
        }
      } catch (e) {
        console.warn('[getOrExtendStaffSubscription] tier normalize/upgrade skipped:', e.message);
      }
    }
    const isEndDatePast = (endVal) => {
      if (endVal == null) return true;
      const d = typeof endVal === 'string' ? new Date(endVal.split('T')[0].split(' ')[0]) : new Date(endVal);
      d.setHours(0, 0, 0, 0);
      return d < today;
    };

    if (latest) {
      const currentEnd = latest.end_date;
      if (currentEnd == null || isEndDatePast(currentEnd)) {
        await this.updateSubscription(latest.id, { end_date: endDateISO, status: 'active' });
        return await this.getUserLatestSubscription(userId);
      }
      return latest;
    }

    await this.createSubscription(userId, 'tier_four', null, null, endDateISO);
    return await this.getUserLatestSubscription(userId);
  }

  /**
   * Active gym member (role user) with no valid app subscription: create Tier One (Mountain end-of-day).
   * Matches admin "Check & fix app access" so expired-only rows still get a new trial on next API load.
   * Postgres only (prod); no-op on SQLite.
   */
  async ensureGymMemberTierOneIfNoValidAppSubscription(userId) {
    if (!this.isPostgres) return;
    const user = await this.getUserById(userId);
    if (!user || user.role !== 'user') return;
    const active = await this.getUserActiveSubscription(userId);
    if (active) return;
    const gm = await this.queryOne(
      `SELECT contract_start_date, start_date, created_at, membership_type FROM gym_memberships WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    if (!gm) return;
    const tierConfig = require('./tier-access-config.json');
    const { tierOneEndIsoFromGymContractAnchor } = require('./lib/mountain-time');
    const subscriptionDays = tierConfig.tiers?.tier_one?.subscriptionDays ?? 10;
    const anchor = gm.contract_start_date || gm.start_date || gm.created_at;
    const endIso = tierOneEndIsoFromGymContractAnchor(anchor, subscriptionDays);
    const subStatus = gm.membership_type === 'free_trial' ? 'free_trial' : 'active';
    await this.createSubscription(userId, 'tier_one', null, null, endIso, subStatus);
  }

  async cancelSubscription(subscriptionId) {
    if (this.isPostgres) {
      const result = await this.query(
        'UPDATE subscriptions SET status = $1 WHERE id = $2',
        ['canceled', subscriptionId]
      );
      return { changes: result.changes };
    } else {
      const result = await this.query(
        'UPDATE subscriptions SET status = ? WHERE id = ?',
        ['canceled', subscriptionId]
      );
      return { changes: result.changes };
    }
  }

  // Workout operations
  async createWorkout(workoutDate, googleDriveFileId, title, content, workoutType = 'regular') {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(workout_date) DO UPDATE SET
         google_drive_file_id = EXCLUDED.google_drive_file_id,
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         workout_type = EXCLUDED.workout_type,
         updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [workoutDate, googleDriveFileId, title, content, workoutType]
      );
      return { id: result.rows[0]?.id || result.lastID };
    } else {
      const result = await this.query(
        `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workout_date) DO UPDATE SET
         google_drive_file_id = excluded.google_drive_file_id,
         title = excluded.title,
         content = excluded.content,
         workout_type = excluded.workout_type,
         updated_at = CURRENT_TIMESTAMP`,
        [workoutDate, googleDriveFileId, title, content, workoutType]
      );
      return { id: result.lastID };
    }
  }

  async getWorkoutByDate(date) {
    if (this.isPostgres) {
      return await this.queryOne('SELECT * FROM workouts WHERE workout_date = $1', [date]);
    } else {
      return await this.queryOne('SELECT * FROM workouts WHERE workout_date = ?', [date]);
    }
  }

  /** Set focus_areas (carousel subheader) for a workout by date. No-op if column does not exist. */
  async setWorkoutFocusAreas(workoutDate, focusAreas) {
    try {
      if (this.isPostgres) {
        await this.query(
          'UPDATE workouts SET focus_areas = $1, updated_at = CURRENT_TIMESTAMP WHERE workout_date = $2',
          [focusAreas || null, workoutDate]
        );
      } else {
        await this.query(
          'UPDATE workouts SET focus_areas = ?, updated_at = CURRENT_TIMESTAMP WHERE workout_date = ?',
          [focusAreas || null, workoutDate]
        );
      }
    } catch (e) {
      if (e.message && e.message.includes('focus_areas')) return;
      throw e;
    }
  }

  async getWorkoutsByDateRange(startDate, endDate) {
    if (this.isPostgres) {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date >= $1 AND workout_date <= $2 ORDER BY workout_date DESC',
        [startDate, endDate]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date >= ? AND workout_date <= ? ORDER BY workout_date DESC',
        [startDate, endDate]
      );
      return result.rows || [];
    }
  }

  async getLatestWorkoutBeforeOrOn(date) {
    if (this.isPostgres) {
      return await this.queryOne(
        'SELECT * FROM workouts WHERE workout_date <= $1 ORDER BY workout_date DESC LIMIT 1',
        [date]
      );
    } else {
      return await this.queryOne(
        'SELECT * FROM workouts WHERE workout_date <= ? ORDER BY workout_date DESC LIMIT 1',
        [date]
      );
    }
  }

  async getWorkoutsBefore(date, limit = 5) {
    if (this.isPostgres) {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date < $1 ORDER BY workout_date DESC LIMIT $2',
        [date, limit]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date < ? ORDER BY workout_date DESC LIMIT ?',
        [date, limit]
      );
      return result.rows || [];
    }
  }

  async getWorkoutsAfter(date, limit = 5) {
    if (this.isPostgres) {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date > $1 ORDER BY workout_date ASC LIMIT $2',
        [date, limit]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        'SELECT * FROM workouts WHERE workout_date > ? ORDER BY workout_date ASC LIMIT ?',
        [date, limit]
      );
      return result.rows || [];
    }
  }

  // Bulk create workouts
  async createWorkouts(workouts) {
    if (workouts.length === 0) {
      return { total: 0, successful: 0, failed: 0, errors: [] };
    }

    if (this.isPostgres) {
      // PostgreSQL bulk insert
      const errors = [];
      let successful = 0;

      for (const workout of workouts) {
        try {
          const workoutType = workout.workoutType || workout.workout_type || 'regular';
          await this.createWorkout(workout.date, workout.fileId, workout.title, workout.content, workoutType);
          successful++;
        } catch (error) {
          errors.push({ index: workouts.indexOf(workout), error: error.message });
        }
      }

      return {
        total: workouts.length,
        successful,
        failed: errors.length,
        errors
      };
    } else {
      // SQLite bulk insert
      return new Promise((resolve, reject) => {
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO workouts (workout_date, google_drive_file_id, title, content, workout_type)
           VALUES (?, ?, ?, ?, ?)`
        );

        let completed = 0;
        let errors = [];

        workouts.forEach((workout, index) => {
          const workoutType = workout.workoutType || workout.workout_type || 'regular';
          stmt.run(
            [workout.date, workout.fileId, workout.title, workout.content, workoutType],
            function(err) {
              if (err) {
                errors.push({ index, error: err.message });
              }
              completed++;
              
              if (completed === workouts.length) {
                stmt.finalize((finalizeErr) => {
                  if (finalizeErr) {
                    reject(finalizeErr);
                  } else {
                    resolve({
                      total: workouts.length,
                      successful: workouts.length - errors.length,
                      failed: errors.length,
                      errors: errors
                    });
                  }
                });
              }
            }
          );
        });
      });
    }
  }

  // Get all workouts
  async getAllWorkouts() {
    const result = await this.query('SELECT * FROM workouts ORDER BY workout_date DESC', []);
    return result.rows || [];
  }

  // Strength workout operations (new workout table-based system)
  async getAllStrengthWorkouts() {
    const result = await this.query('SELECT * FROM strength_workouts ORDER BY workout_date DESC', []);
    return result.rows || [];
  }

  async getStrengthWorkoutByDate(date) {
    if (this.isPostgres) {
      return await this.queryOne('SELECT * FROM strength_workouts WHERE workout_date = $1', [date]);
    } else {
      return await this.queryOne('SELECT * FROM strength_workouts WHERE workout_date = ?', [date]);
    }
  }


  /**
   * Get all strength workouts from the normalized workout tables.
   * This powers the /api/strength-workouts list endpoint and works for both
   * PostgreSQL (production) and SQLite (dev).
   *
   * @param {string|null} phase Optional phase filter ('Phase One', 'Phase Two', 'Phase Three')
   * @returns {Promise<Array>} Array of workout rows with format info
   */
  async getAllStrengthWorkoutsFromWorkoutTable(phase = null) {
    let sql;
    const params = [];

    if (this.isPostgres) {
      // PostgreSQL uses boolean for is_active
      sql = `
        SELECT 
          w.id,
          w.name,
          w.phase,
          w.difficulty_level,
          w.primary_focus,
          w.secondary_focus,
          w.fmp,
          w.notes,
          wf.name AS workout_format_name,
          wf.format_json AS workout_format_json,
          w.created_at
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        LEFT JOIN workout_formats wf ON w.workout_format_id = wf.id
        WHERE wt.code = 'STRENGTH'
          AND w.is_active = true
      `;

      if (phase) {
        sql += ' AND w.phase = $1';
        params.push(phase);
      }

      sql += ' ORDER BY w.id ASC';
    } else {
      // SQLite uses INTEGER 0/1 for is_active
      sql = `
        SELECT 
          w.id,
          w.name,
          w.phase,
          w.difficulty_level,
          w.primary_focus,
          w.secondary_focus,
          w.fmp,
          w.notes,
          wf.name AS workout_format_name,
          wf.format_json AS workout_format_json,
          w.created_at
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        LEFT JOIN workout_formats wf ON w.workout_format_id = wf.id
        WHERE wt.code = 'STRENGTH'
          AND w.is_active = 1
      `;

      if (phase) {
        sql += ' AND w.phase = ?';
        params.push(phase);
      }

      sql += ' ORDER BY w.id ASC';
    }

    const result = await this.query(sql, params);
    return result.rows || [];
  }

  /**
   * Get a single strength workout (and its blocks/exercises) from the normalized tables.
   * This powers the /api/strength-workouts/:id endpoint.
   *
   * @param {number} workoutId
   * @returns {Promise<Object|null>}
   */
  async getStrengthWorkoutById(workoutId) {
    // 1. Fetch base workout info
    let workoutSql;
    let params = [workoutId];

    if (this.isPostgres) {
      workoutSql = `
        SELECT 
          w.id,
          w.name,
          w.phase,
          w.difficulty_level,
          w.primary_focus,
          w.secondary_focus,
          w.fmp,
          w.notes,
          wf.name AS workout_format_name,
          wf.format_json AS workout_format_json,
          w.created_at
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        LEFT JOIN workout_formats wf ON w.workout_format_id = wf.id
        WHERE wt.code = 'STRENGTH'
          AND w.is_active = true
          AND w.id = $1
      `;
    } else {
      workoutSql = `
        SELECT 
          w.id,
          w.name,
          w.phase,
          w.difficulty_level,
          w.primary_focus,
          w.secondary_focus,
          w.fmp,
          w.notes,
          wf.name AS workout_format_name,
          wf.format_json AS workout_format_json,
          w.created_at
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        LEFT JOIN workout_formats wf ON w.workout_format_id = wf.id
        WHERE wt.code = 'STRENGTH'
          AND w.is_active = 1
          AND w.id = ?
      `;
    }

    const workout = await this.queryOne(workoutSql, params);
    if (!workout) {
      return null;
    }

    // 2. Fetch blocks for this workout
    let blocksSql;
    params = [workoutId];

    if (this.isPostgres) {
      blocksSql = `
        SELECT 
          id,
          workout_id,
          block_type,
          title,
          order_index,
          config_json,
          created_at,
          updated_at
        FROM workout_blocks
        WHERE workout_id = $1
        ORDER BY order_index ASC
      `;
    } else {
      blocksSql = `
        SELECT 
          id,
          workout_id,
          block_type,
          title,
          order_index,
          config_json,
          created_at,
          updated_at
        FROM workout_blocks
        WHERE workout_id = ?
        ORDER BY order_index ASC
      `;
    }

    const blocksResult = await this.query(blocksSql, params);
    const blocks = blocksResult.rows || [];

    // 3. For each block, fetch exercises (joined to exercises / exercise / equipment)
    const enrichedBlocks = [];

    for (const block of blocks) {
      let exSql;
      let exParams = [block.id];

      if (this.isPostgres) {
        exSql = `
          SELECT
            be.id,
            be.block_id,
            be.exercise_id,
            be.order_index,
            be.sets,
            be.reps,
            be.duration_sec,
            be.intensity_type,
            be.load_percent_1rm,
            be.tempo,
            be.focus_role,
            be.config_json,
            COALESCE(ex.name, e.exercise) AS exercise,
            COALESCE(eq.name, e.equipment, ex.description) AS equipment
          FROM block_exercises be
          LEFT JOIN exercises ex ON be.exercise_id = ex.id
          LEFT JOIN exercise e ON be.exercise_id = e.id
          LEFT JOIN exercise_equipment ee ON be.exercise_id = ee.exercise_id
          LEFT JOIN equipment eq ON ee.equipment_id = eq.id
          WHERE be.block_id = $1
          ORDER BY be.order_index ASC
        `;
      } else {
        exSql = `
          SELECT
            be.id,
            be.block_id,
            be.exercise_id,
            be.order_index,
            be.sets,
            be.reps,
            be.duration_sec,
            be.intensity_type,
            be.load_percent_1rm,
            be.tempo,
            be.focus_role,
            be.config_json,
            COALESCE(ex.name, e.exercise) AS exercise,
            COALESCE(eq.name, e.equipment, ex.description) AS equipment
          FROM block_exercises be
          LEFT JOIN exercises ex ON be.exercise_id = ex.id
          LEFT JOIN exercise e ON be.exercise_id = e.id
          LEFT JOIN exercise_equipment ee ON be.exercise_id = ee.exercise_id
          LEFT JOIN equipment eq ON ee.equipment_id = eq.id
          WHERE be.block_id = ?
          ORDER BY be.order_index ASC
        `;
      }

      const exResult = await this.query(exSql, exParams);
      const exercises = exResult.rows || [];

      enrichedBlocks.push({
        ...block,
        exercises
      });
    }

    return {
      ...workout,
      blocks: enrichedBlocks
    };
  }

  // Payment operations
  /**
   * @param {string|null} [createdAtIso] - optional UTC ISO timestamp for backfills (else DB default now)
   */
  async createPayment(userId, stripePaymentIntentId, amount, currency, tier, status, email = null, createdAtIso = null) {
    if (this.isPostgres) {
      if (createdAtIso) {
        const result = await this.query(
          `INSERT INTO payments (user_id, stripe_payment_intent_id, amount, currency, tier, status, email, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz) RETURNING id`,
          [userId, stripePaymentIntentId, amount, currency, tier, status, email, createdAtIso]
        );
        return { id: result.rows[0]?.id };
      }
      const result = await this.query(
        `INSERT INTO payments (user_id, stripe_payment_intent_id, amount, currency, tier, status, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, stripePaymentIntentId, amount, currency, tier, status, email]
      );
      return { id: result.rows[0]?.id };
    }
    if (createdAtIso) {
      const result = await this.query(
        `INSERT INTO payments (user_id, stripe_payment_intent_id, amount, currency, tier, status, email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, stripePaymentIntentId, amount, currency, tier, status, email, createdAtIso]
      );
      return { id: result.lastID };
    }
    const result = await this.query(
      `INSERT INTO payments (user_id, stripe_payment_intent_id, amount, currency, tier, status, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, stripePaymentIntentId, amount, currency, tier, status, email]
    );
    return { id: result.lastID };
  }

  async getDropInPayments(filterTier = null) {
    // filterTier: null = both, 'drop_in' = paid only, 'buddy_pass' = buddy pass only
    let sql;
    const params = [];
    if (filterTier === 'drop_in' || filterTier === 'buddy_pass') {
      sql = this.isPostgres
        ? `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at, p.tier,
                   COALESCE(p.email, u.email) as display_email
            FROM payments p
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'succeeded' AND p.tier = $1
            ORDER BY p.created_at DESC`
        : `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at, p.tier,
                   COALESCE(p.email, u.email) as display_email
            FROM payments p
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'succeeded' AND p.tier = ?
            ORDER BY p.created_at DESC`;
      params.push(filterTier);
    } else {
      sql = this.isPostgres
        ? `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at, p.tier,
                   COALESCE(p.email, u.email) as display_email
            FROM payments p
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'succeeded' AND p.tier IN ('drop_in', 'buddy_pass')
            ORDER BY p.created_at DESC`
        : `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at, p.tier,
                   COALESCE(p.email, u.email) as display_email
            FROM payments p
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'succeeded' AND p.tier IN ('drop_in', 'buddy_pass')
            ORDER BY p.created_at DESC`;
    }
    const result = await this.query(sql, params);
    return result.rows || [];
  }

  // Buddy pass operations
  async createBuddyPass(memberUserId, buddyName, buddyPhone, buddyEmail, visitDate, classTime, className, pin) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO buddy_passes (member_user_id, buddy_name, buddy_phone, buddy_email, visit_date, class_time, class_name, pin, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
        [memberUserId, buddyName, buddyPhone, buddyEmail, visitDate, classTime, className, pin]
      );
      return result.rows[0];
    } else {
      const result = await this.query(
        `INSERT INTO buddy_passes (member_user_id, buddy_name, buddy_phone, buddy_email, visit_date, class_time, class_name, pin, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [memberUserId, buddyName, buddyPhone, buddyEmail, visitDate, classTime, className, pin]
      );
      return { id: result.lastID, member_user_id: memberUserId, buddy_name: buddyName, buddy_phone: buddyPhone, buddy_email: buddyEmail, visit_date: visitDate, class_time: classTime, class_name: className, pin, status: 'pending' };
    }
  }

  async getBuddyPassById(id) {
    return this.isPostgres
      ? this.queryOne('SELECT * FROM buddy_passes WHERE id = $1', [id])
      : this.queryOne('SELECT * FROM buddy_passes WHERE id = ?', [id]);
  }

  async getBuddyPassByEmailAndPin(email, pin) {
    const normalizedEmail = String(email).trim().toLowerCase();
    return this.isPostgres
      ? this.queryOne('SELECT * FROM buddy_passes WHERE LOWER(buddy_email) = $1 AND pin = $2 AND status = $3', [normalizedEmail, pin, 'pending'])
      : this.queryOne('SELECT * FROM buddy_passes WHERE LOWER(buddy_email) = ? AND pin = ? AND status = ?', [normalizedEmail, pin, 'pending']);
  }

  async getBuddyPassesByMember(memberUserId) {
    const result = this.isPostgres
      ? await this.query('SELECT * FROM buddy_passes WHERE member_user_id = $1 ORDER BY visit_date DESC, created_at DESC', [memberUserId])
      : await this.query('SELECT * FROM buddy_passes WHERE member_user_id = ? ORDER BY visit_date DESC, created_at DESC', [memberUserId]);
    return result.rows || [];
  }

  async getBuddyPassForWeek(memberUserId, weekStart) {
    // weekStart is YYYY-MM-DD of Monday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    return this.isPostgres
      ? this.queryOne(
          `SELECT * FROM buddy_passes WHERE member_user_id = $1 AND visit_date >= $2 AND visit_date <= $3 AND status != 'cancelled' LIMIT 1`,
          [memberUserId, weekStart, weekEndStr]
        )
      : this.queryOne(
          'SELECT * FROM buddy_passes WHERE member_user_id = ? AND visit_date >= ? AND visit_date <= ? AND status != ? LIMIT 1',
          [memberUserId, weekStart, weekEndStr, 'cancelled']
        );
  }

  async updateBuddyPass(id, updates) {
    const { buddy_name, buddy_phone, buddy_email, visit_date, class_time, class_name, status, buddy_user_id, payment_id, confirmed_at, cancelled_at } = updates;
    if (this.isPostgres) {
      const sets = [];
      const vals = [];
      let i = 1;
      if (buddy_name !== undefined) { sets.push(`buddy_name = $${i++}`); vals.push(buddy_name); }
      if (buddy_phone !== undefined) { sets.push(`buddy_phone = $${i++}`); vals.push(buddy_phone); }
      if (buddy_email !== undefined) { sets.push(`buddy_email = $${i++}`); vals.push(buddy_email); }
      if (visit_date !== undefined) { sets.push(`visit_date = $${i++}`); vals.push(visit_date); }
      if (class_time !== undefined) { sets.push(`class_time = $${i++}`); vals.push(class_time); }
      if (class_name !== undefined) { sets.push(`class_name = $${i++}`); vals.push(class_name); }
      if (status !== undefined) { sets.push(`status = $${i++}`); vals.push(status); }
      if (buddy_user_id !== undefined) { sets.push(`buddy_user_id = $${i++}`); vals.push(buddy_user_id); }
      if (payment_id !== undefined) { sets.push(`payment_id = $${i++}`); vals.push(payment_id); }
      if (confirmed_at !== undefined) { sets.push(`confirmed_at = $${i++}`); vals.push(confirmed_at); }
      if (cancelled_at !== undefined) { sets.push(`cancelled_at = $${i++}`); vals.push(cancelled_at); }
      if (sets.length === 0) return null;
      vals.push(id);
      await this.query(`UPDATE buddy_passes SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    } else {
      const sets = [];
      const vals = [];
      if (buddy_name !== undefined) { sets.push('buddy_name = ?'); vals.push(buddy_name); }
      if (buddy_phone !== undefined) { sets.push('buddy_phone = ?'); vals.push(buddy_phone); }
      if (buddy_email !== undefined) { sets.push('buddy_email = ?'); vals.push(buddy_email); }
      if (visit_date !== undefined) { sets.push('visit_date = ?'); vals.push(visit_date); }
      if (class_time !== undefined) { sets.push('class_time = ?'); vals.push(class_time); }
      if (class_name !== undefined) { sets.push('class_name = ?'); vals.push(class_name); }
      if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
      if (buddy_user_id !== undefined) { sets.push('buddy_user_id = ?'); vals.push(buddy_user_id); }
      if (payment_id !== undefined) { sets.push('payment_id = ?'); vals.push(payment_id); }
      if (confirmed_at !== undefined) { sets.push('confirmed_at = ?'); vals.push(confirmed_at); }
      if (cancelled_at !== undefined) { sets.push('cancelled_at = ?'); vals.push(cancelled_at); }
      if (sets.length === 0) return null;
      vals.push(id);
      await this.query(`UPDATE buddy_passes SET ${sets.join(', ')} WHERE id = ?`, vals);
    }
    return this.getBuddyPassById(id);
  }

  async getGymMembershipPaymentsAdmin() {
    const result = this.isPostgres
      ? await this.query(
          `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at,
                  COALESCE(p.email, u.email) as display_email,
                  p.tier
           FROM payments p
           JOIN users u ON p.user_id = u.id
           WHERE p.tier IN ('gym_membership', 'gym_membership_late_fee') AND p.status = 'succeeded'
           ORDER BY p.created_at DESC`,
          []
        )
      : await this.query(
          `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at,
                  COALESCE(p.email, u.email) as display_email,
                  p.tier
           FROM payments p
           JOIN users u ON p.user_id = u.id
           WHERE p.tier IN ('gym_membership', 'gym_membership_late_fee') AND p.status = 'succeeded'
           ORDER BY p.created_at DESC`,
          []
        );
    return result.rows || [];
  }

  async upsertCustomerProfile(userId, profile = {}, address = {}, emergencyContact = {}) {
    const firstName = profile.firstName || null;
    const lastName = profile.lastName || null;
    const dateOfBirth = profile.dateOfBirth || null;
    const gender = profile.gender || null;
    const phone = profile.phone || null;
    const street = address.street || null;
    const city = address.city || null;
    const state = address.state || null;
    const zip = address.zip || null;
    const emergencyName = emergencyContact.name || emergencyContact.fullName || null;
    const emergencyPhone = emergencyContact.phone || null;

    const existing = await this.queryOne(
      this.isPostgres
        ? 'SELECT id FROM customer_profiles WHERE user_id = $1'
        : 'SELECT id FROM customer_profiles WHERE user_id = ?',
      [userId]
    );

    if (existing && existing.id) {
      // Update existing profile
      await this.query(
        this.isPostgres
          ? `UPDATE customer_profiles
             SET first_name = $1,
                 last_name = $2,
                 date_of_birth = $3,
                 gender = $4,
                 phone = $5,
                 street = $6,
                 city = $7,
                 state = $8,
                 zip = $9,
                 emergency_contact_name = $10,
                 emergency_contact_phone = $11,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $12`
          : `UPDATE customer_profiles
             SET first_name = ?,
                 last_name = ?,
                 date_of_birth = ?,
                 gender = ?,
                 phone = ?,
                 street = ?,
                 city = ?,
                 state = ?,
                 zip = ?,
                 emergency_contact_name = ?,
                 emergency_contact_phone = ?,
                 updated_at = datetime('now')
             WHERE user_id = ?`,
        [
          firstName,
          lastName,
          dateOfBirth,
          gender,
          phone,
          street,
          city,
          state,
          zip,
          emergencyName,
          emergencyPhone,
          userId
        ]
      );
      return { id: existing.id, user_id: userId };
    }

    // Insert new profile
    const result = await this.query(
      this.isPostgres
        ? `INSERT INTO customer_profiles
           (user_id, first_name, last_name, date_of_birth, gender, phone, street, city, state, zip,
            emergency_contact_name, emergency_contact_phone, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`
        : `INSERT INTO customer_profiles
           (user_id, first_name, last_name, date_of_birth, gender, phone, street, city, state, zip,
            emergency_contact_name, emergency_contact_phone, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        userId,
        firstName,
        lastName,
        dateOfBirth,
        gender,
        phone,
        street,
        city,
        state,
        zip,
        emergencyName,
        emergencyPhone
      ]
    );

    const newId = result.rows?.[0]?.id ?? result.lastID ?? null;
    return { id: newId, user_id: userId };
  }

  /** Admin "Gym Members" list: last charge = succeeded payments with gym tiers only (never app tier_*). */
  async getGymMembershipsAdmin() {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT gm.id, gm.user_id, gm.membership_type, gm.contract_end_date, gm.status, gm.stripe_subscription_id, gm.household_id,
                u.name, u.email,
                cp.phone, cp.first_name, cp.last_name, cp.date_of_birth, cp.gender,
                cp.street, cp.city, cp.state, cp.zip,
                cp.emergency_contact_name, cp.emergency_contact_phone,
                (SELECT MAX(p.created_at) FROM payments p WHERE p.user_id = gm.user_id AND p.tier IN ('gym_membership', 'gym_membership_late_fee') AND p.status = 'succeeded') AS last_charge_at
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN customer_profiles cp ON cp.user_id = gm.user_id
         WHERE u.role <> 'tester' AND u.email NOT ILIKE 'prod-test%@example.com'
         ORDER BY COALESCE(u.name, u.email), gm.created_at DESC`,
        []
      );
      return (result.rows || []).map(r => ({
        ...r,
        next_charge_date: r.contract_end_date,
        membership_type_label: (r.membership_type || '').replace(/_/g, ' ')
      }));
    }
    const result = await this.query(
      `SELECT gm.id, gm.user_id, gm.membership_type, gm.contract_end_date, gm.status, gm.stripe_subscription_id, gm.household_id,
              u.name, u.email,
              cp.phone, cp.first_name, cp.last_name, cp.date_of_birth, cp.gender,
              cp.street, cp.city, cp.state, cp.zip,
              cp.emergency_contact_name, cp.emergency_contact_phone,
              (SELECT MAX(p.created_at) FROM payments p WHERE p.user_id = gm.user_id AND p.tier IN ('gym_membership', 'gym_membership_late_fee') AND p.status = 'succeeded') AS last_charge_at
       FROM gym_memberships gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN customer_profiles cp ON cp.user_id = gm.user_id
       WHERE u.role <> 'tester' AND u.email NOT LIKE 'prod-test%@example.com'
       ORDER BY COALESCE(u.name, u.email), gm.created_at DESC`,
      []
    );
    return (result.rows || []).map(r => ({
      ...r,
      next_charge_date: r.contract_end_date,
      membership_type_label: (r.membership_type || '').replace(/_/g, ' ')
    }));
  }

  async getMembersAdmin() {
    return this.getGymMembershipsAdmin();
  }

  /**
   * Admin "App Subs" list: one row per user — primary app subscription (tier_one–four),
   * with last succeeded app-tier payment timestamp (same idea as gym members list).
   */
  async getAppSubscriptionsAdmin() {
    const tierList = "('tier_one', 'tier_two', 'tier_three', 'tier_four')";
    const payTierList = "('tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')";
    const subqueryOrderPg = `
      ORDER BY
        CASE s2.status WHEN 'active' THEN 0 WHEN 'free_trial' THEN 1 WHEN 'grace_period' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END,
        s2.end_date DESC NULLS LAST,
        s2.id DESC
      LIMIT 1`;
    const subqueryOrderSqlite = `
      ORDER BY
        CASE s2.status WHEN 'active' THEN 0 WHEN 'free_trial' THEN 1 WHEN 'grace_period' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END,
        s2.end_date DESC,
        s2.id DESC
      LIMIT 1`;
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT s.id, s.user_id, s.tier, s.status, s.end_date, s.start_date, s.stripe_subscription_id,
                u.name, u.email,
                (SELECT MAX(p.created_at) FROM payments p
                 WHERE p.user_id = s.user_id AND p.tier IN ${payTierList} AND p.status = 'succeeded') AS last_charge_at
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         WHERE s.tier IN ${tierList}
           AND u.role <> 'tester' AND u.email NOT ILIKE 'prod-test%@example.com'
           AND u.email NOT ILIKE 'qa.%@example.com'
           AND s.id = (
             SELECT s2.id FROM subscriptions s2
             WHERE s2.user_id = s.user_id AND s2.tier IN ${tierList}
             ${subqueryOrderPg}
           )
         ORDER BY COALESCE(u.name, u.email), s.id DESC`,
        []
      );
      return (result.rows || []).map((r) => ({
        ...r,
        tier_label: (r.tier || '')
          .replace(/^tier_/, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      }));
    }
    const result = await this.query(
      `SELECT s.id, s.user_id, s.tier, s.status, s.end_date, s.start_date, s.stripe_subscription_id,
              u.name, u.email,
              (SELECT MAX(p.created_at) FROM payments p
               WHERE p.user_id = s.user_id AND p.tier IN ${payTierList} AND p.status = 'succeeded') AS last_charge_at
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.tier IN ${tierList}
         AND u.role <> 'tester' AND u.email NOT LIKE 'prod-test%@example.com'
         AND LOWER(u.email) NOT LIKE 'qa.%@example.com'
         AND s.id = (
           SELECT s2.id FROM subscriptions s2
           WHERE s2.user_id = s.user_id AND s2.tier IN ${tierList}
           ${subqueryOrderSqlite}
         )
       ORDER BY COALESCE(u.name, u.email), s.id DESC`,
      []
    );
    return (result.rows || []).map((r) => ({
      ...r,
      tier_label: (r.tier || '')
        .replace(/^tier_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    }));
  }

  async getAppSubscriptionPaymentsAdmin() {
    const result = this.isPostgres
      ? await this.query(
          `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at,
                  COALESCE(p.email, u.email) as display_email,
                  p.tier
           FROM payments p
           JOIN users u ON p.user_id = u.id
           WHERE p.tier IN ('tier_one', 'tier_two', 'tier_three', 'tier_four') AND p.status = 'succeeded'
           ORDER BY p.created_at DESC`,
          []
        )
      : await this.query(
          `SELECT p.id, p.user_id, p.amount, p.currency, p.email, p.status, p.created_at,
                  COALESCE(p.email, u.email) as display_email,
                  p.tier
           FROM payments p
           JOIN users u ON p.user_id = u.id
           WHERE p.tier IN ('tier_one', 'tier_two', 'tier_three', 'tier_four') AND p.status = 'succeeded'
           ORDER BY p.created_at DESC`,
          []
        );
    return result.rows || [];
  }

  // Update payment status (used when confirming payment)
  async updatePayment(stripePaymentIntentId, status) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE payments SET status = $1 WHERE stripe_payment_intent_id = $2 RETURNING id`,
        [status, stripePaymentIntentId]
      );
      return result.rows[0] ? { id: result.rows[0].id } : null;
    } else {
      const result = await this.query(
        `UPDATE payments SET status = ? WHERE stripe_payment_intent_id = ?`,
        [status, stripePaymentIntentId]
      );
      return result.changes > 0 ? { id: stripePaymentIntentId } : null;
    }
  }

  async getPaymentsByUserId(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );
      return result.rows || [];
    }
  }

  async getGymPaymentsByUserId(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM payments WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee') ORDER BY created_at DESC`,
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        "SELECT * FROM payments WHERE user_id = ? AND tier IN ('gym_membership', 'gym_membership_late_fee') ORDER BY created_at DESC",
        [userId]
      );
      return result.rows || [];
    }
  }

  /** Gym membership Payment History tab: gym + drop-in with displayable statuses. */
  async getGymAndDropInPaymentsSucceededByUserId(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM payments
         WHERE user_id = $1
           AND tier IN ('gym_membership', 'gym_membership_late_fee', 'drop_in')
           AND status IN ('succeeded', 'refunded', 'partially_refunded')
         ORDER BY created_at DESC`,
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        "SELECT * FROM payments WHERE user_id = ? AND tier IN ('gym_membership', 'gym_membership_late_fee', 'drop_in') AND status IN ('succeeded', 'refunded', 'partially_refunded') ORDER BY created_at DESC",
        [userId]
      );
      return result.rows || [];
    }
  }

  // Password reset operations
  async createPasswordResetToken(userId, token, expiresAt) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING id`,
        [userId, token, expiresAt]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`,
        [userId, token, expiresAt]
      );
      return { id: result.lastID };
    }
  }

  async getPasswordResetToken(token) {
    if (this.isPostgres) {
      return await this.queryOne(
        `SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
        [token]
      );
    } else {
      return await this.queryOne(
        `SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
        [token]
      );
    }
  }

  async markPasswordResetTokenUsed(token) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE password_reset_tokens SET used = TRUE WHERE token = $1`,
        [token]
      );
      return result.changes > 0;
    } else {
      const result = await this.query(
        `UPDATE password_reset_tokens SET used = 1 WHERE token = ?`,
        [token]
      );
      return result.changes > 0;
    }
  }

  async createLoginCode(userId, plainCode, expiresAt, createdByAdminId = null) {
    const codeHash = await bcrypt.hash(String(plainCode), 10);
    if (this.isPostgres) {
      await this.query(
        `UPDATE login_codes
         SET used = TRUE, used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used = FALSE`,
        [userId]
      );
      const result = await this.query(
        `INSERT INTO login_codes (user_id, code_hash, expires_at, created_by_admin_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, codeHash, expiresAt, createdByAdminId]
      );
      return { id: result.rows[0]?.id };
    } else {
      await this.query(
        `UPDATE login_codes
         SET used = 1, used_at = datetime('now')
         WHERE user_id = ? AND used = 0`,
        [userId]
      );
      const result = await this.query(
        `INSERT INTO login_codes (user_id, code_hash, expires_at, created_by_admin_id)
         VALUES (?, ?, ?, ?)`,
        [userId, codeHash, expiresAt, createdByAdminId]
      );
      return { id: result.lastID };
    }
  }

  async verifyLoginCode(userId, plainCode) {
    const code = String(plainCode || '').trim();
    if (!/^\d{6}$/.test(code)) return false;
    const rows = this.isPostgres
      ? await this.query(
          `SELECT id, code_hash
           FROM login_codes
           WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId]
        )
      : await this.query(
          `SELECT id, code_hash
           FROM login_codes
           WHERE user_id = ? AND used = 0 AND expires_at > datetime('now')
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId]
        );
    const candidates = rows.rows || [];
    for (const row of candidates) {
      try {
        const matches = await bcrypt.compare(code, row.code_hash);
        if (matches) return true;
      } catch (e) {
        // Continue checking next candidate.
      }
    }
    return false;
  }

  async consumeLoginCode(userId, plainCode) {
    const code = String(plainCode || '').trim();
    if (!/^\d{6}$/.test(code)) return false;
    const rows = this.isPostgres
      ? await this.query(
          `SELECT id, code_hash
           FROM login_codes
           WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId]
        )
      : await this.query(
          `SELECT id, code_hash
           FROM login_codes
           WHERE user_id = ? AND used = 0 AND expires_at > datetime('now')
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId]
        );
    const candidates = rows.rows || [];
    for (const row of candidates) {
      try {
        const matches = await bcrypt.compare(code, row.code_hash);
        if (!matches) continue;
        if (this.isPostgres) {
          await this.query(
            `UPDATE login_codes
             SET used = TRUE, used_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [row.id]
          );
        } else {
          await this.query(
            `UPDATE login_codes
             SET used = 1, used_at = datetime('now')
             WHERE id = ?`,
            [row.id]
          );
        }
        return true;
      } catch (e) {
        // Continue checking next candidate.
      }
    }
    return false;
  }

  // Banner settings (global)
  async getBannerSettings() {
    const sql = this.isPostgres
      ? `SELECT message, bg_key, text_color FROM banner_settings ORDER BY updated_at DESC LIMIT 1`
      : `SELECT message, bg_key, text_color FROM banner_settings ORDER BY updated_at DESC LIMIT 1`;
    const result = await this.query(sql, []);
    const row = (result.rows && result.rows[0]) || null;
    return row || null;
  }

  async setBannerSettings(message, bgKey, textColor) {
    if (this.isPostgres) {
      await this.query(
        `INSERT INTO banner_settings (message, bg_key, text_color) VALUES ($1, $2, $3)`,
        [message, bgKey, textColor]
      );
    } else {
      await this.query(
        `INSERT INTO banner_settings (message, bg_key, text_color) VALUES (?, ?, ?)`,
        [message, bgKey, textColor]
      );
    }
  }

  async updateUserPassword(userId, newPasswordHash) {
    if (this.isPostgres) {
      const result = await this.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newPasswordHash, userId]
      );
      return result.changes > 0;
    } else {
      const result = await this.query(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
        [newPasswordHash, userId]
      );
      return result.changes > 0;
    }
  }

  // Macro plan methods
  async saveMacroPlan(userId, planData) {
    const planJson = JSON.stringify(planData);
    if (this.isPostgres) {
      // Use INSERT ... ON CONFLICT to update if exists
      await this.query(
        `INSERT INTO macro_plans (user_id, plan_data, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) 
         DO UPDATE SET plan_data = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
        [userId, planJson]
      );
    } else {
      // SQLite doesn't support ON CONFLICT UPDATE directly, so check first
      const existing = await this.queryOne(
        `SELECT id FROM macro_plans WHERE user_id = ?`,
        [userId]
      );
      if (existing) {
        await this.query(
          `UPDATE macro_plans SET plan_data = ?, updated_at = datetime('now') WHERE user_id = ?`,
          [planJson, userId]
        );
      } else {
        await this.query(
          `INSERT INTO macro_plans (user_id, plan_data, updated_at)
           VALUES (?, ?, datetime('now'))`,
          [userId, planJson]
        );
      }
    }
  }

  async getMacroPlan(userId) {
    const plan = await this.queryOne(
      this.isPostgres
        ? `SELECT plan_data FROM macro_plans WHERE user_id = $1`
        : `SELECT plan_data FROM macro_plans WHERE user_id = ?`,
      [userId]
    );
    if (!plan) return null;
    
    // Parse JSON data
    if (this.isPostgres) {
      return plan.plan_data; // PostgreSQL returns JSONB as object
    } else {
      return JSON.parse(plan.plan_data); // SQLite stores as TEXT
    }
  }

  // PR Log operations
  async createPRLog(userId, exercise, weight, reps, oneRM, confidence, logDate) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO pr_logs (user_id, exercise, weight, reps, one_rm, confidence, log_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, exercise, weight, reps, oneRM, confidence, logDate]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT INTO pr_logs (user_id, exercise, weight, reps, one_rm, confidence, log_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, exercise, weight, reps, oneRM, confidence, logDate]
      );
      return { id: result.lastID };
    }
  }

  async getPRLogs(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT id, exercise, weight, reps, one_rm as "oneRM", confidence, log_date as date, created_at
         FROM pr_logs WHERE user_id = $1 ORDER BY log_date DESC`,
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT id, exercise, weight, reps, one_rm as oneRM, confidence, log_date as date, created_at
         FROM pr_logs WHERE user_id = ? ORDER BY log_date DESC`,
        [userId]
      );
      return result.rows || [];
    }
  }

  async deletePRLog(userId, logId) {
    if (this.isPostgres) {
      const result = await this.query(
        `DELETE FROM pr_logs WHERE id = $1 AND user_id = $2`,
        [logId, userId]
      );
      return result.changes > 0;
    } else {
      const result = await this.query(
        `DELETE FROM pr_logs WHERE id = ? AND user_id = ?`,
        [logId, userId]
      );
      return result.changes > 0;
    }
  }

  async bulkCreatePRLogs(userId, logs) {
    if (logs.length === 0) return [];
    
    if (this.isPostgres) {
      const values = logs.map((log, idx) => {
        const base = idx * 7;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      }).join(', ');
      
      const params = logs.flatMap(log => [
        userId,
        log.exercise,
        log.weight,
        log.reps,
        log.oneRM,
        log.confidence,
        log.date
      ]);
      
      const result = await this.query(
        `INSERT INTO pr_logs (user_id, exercise, weight, reps, one_rm, confidence, log_date)
         VALUES ${values} RETURNING id`,
        params
      );
      return result.rows.map(row => ({ id: row.id }));
    } else {
      const insertedIds = [];
      for (const log of logs) {
        const result = await this.query(
          `INSERT INTO pr_logs (user_id, exercise, weight, reps, one_rm, confidence, log_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, log.exercise, log.weight, log.reps, log.oneRM, log.confidence, log.date]
        );
        insertedIds.push({ id: result.lastID });
      }
      return insertedIds;
    }
  }

  // Body Composition Measurement operations
  async createBodyCompositionMeasurement(userId, measurement, value, goalDirection, measurementDate) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO body_composition_measurements (user_id, measurement, value, goal_direction, measurement_date)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, measurement, value, goalDirection, measurementDate]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT INTO body_composition_measurements (user_id, measurement, value, goal_direction, measurement_date)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, measurement, value, goalDirection, measurementDate]
      );
      return { id: result.lastID };
    }
  }

  async getBodyCompositionMeasurements(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT id, measurement, value, goal_direction as "goalDirection", measurement_date as date, created_at
         FROM body_composition_measurements WHERE user_id = $1 ORDER BY measurement_date DESC`,
        [userId]
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT id, measurement, value, goal_direction as goalDirection, measurement_date as date, created_at
         FROM body_composition_measurements WHERE user_id = ? ORDER BY measurement_date DESC`,
        [userId]
      );
      return result.rows || [];
    }
  }

  async deleteBodyCompositionMeasurement(userId, measurementId) {
    if (this.isPostgres) {
      const result = await this.query(
        `DELETE FROM body_composition_measurements WHERE id = $1 AND user_id = $2`,
        [measurementId, userId]
      );
      return result.changes > 0;
    } else {
      const result = await this.query(
        `DELETE FROM body_composition_measurements WHERE id = ? AND user_id = ?`,
        [measurementId, userId]
      );
      return result.changes > 0;
    }
  }

  async bulkCreateBodyCompositionMeasurements(userId, measurements) {
    if (measurements.length === 0) return [];
    
    if (this.isPostgres) {
      const values = measurements.map((measurement, idx) => {
        const base = idx * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      }).join(', ');
      
      const params = measurements.flatMap(m => [
        userId,
        m.measurement,
        m.value,
        m.goalDirection,
        m.date
      ]);
      
      const result = await this.query(
        `INSERT INTO body_composition_measurements (user_id, measurement, value, goal_direction, measurement_date)
         VALUES ${values} RETURNING id`,
        params
      );
      return result.rows.map(row => ({ id: row.id }));
    } else {
      const insertedIds = [];
      for (const measurement of measurements) {
        const result = await this.query(
          `INSERT INTO body_composition_measurements (user_id, measurement, value, goal_direction, measurement_date)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, measurement.measurement, measurement.value, measurement.goalDirection, measurement.date]
        );
        insertedIds.push({ id: result.lastID });
      }
      return insertedIds;
    }
  }

  // ========== Meal Plan Calculations Tracking ==========

  async createMealPlanCalculation(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO meal_plan_calculations (user_id) VALUES ($1) RETURNING id`,
        [userId]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT INTO meal_plan_calculations (user_id) VALUES (?)`,
        [userId]
      );
      return { id: result.lastID };
    }
  }

  async getMealPlanCalculationCount(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM meal_plan_calculations WHERE user_id = $1`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    } else {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM meal_plan_calculations WHERE user_id = ?`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    }
  }

  // ========== Meal Plan Inputs (for Tier Three/Four) ==========

  async saveMealPlanInputs(userId, goalsData, infoData, activityData) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO meal_plan_inputs (user_id, goals_data, info_data, activity_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) 
         DO UPDATE SET goals_data = $2, info_data = $3, activity_data = $4, updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [userId, JSON.stringify(goalsData), JSON.stringify(infoData), JSON.stringify(activityData)]
      );
      return { id: result.rows[0]?.id };
    } else {
      const result = await this.query(
        `INSERT OR REPLACE INTO meal_plan_inputs (user_id, goals_data, info_data, activity_data, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [userId, JSON.stringify(goalsData), JSON.stringify(infoData), JSON.stringify(activityData)]
      );
      return { id: result.lastID || (result.changes > 0 ? 1 : null) };
    }
  }

  async getMealPlanInputs(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT goals_data, info_data, activity_data FROM meal_plan_inputs WHERE user_id = $1`,
        [userId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        goals: row.goals_data ? JSON.parse(row.goals_data) : null,
        info: row.info_data ? JSON.parse(row.info_data) : null,
        activity: row.activity_data ? JSON.parse(row.activity_data) : null
      };
    } else {
      const result = await this.query(
        `SELECT goals_data, info_data, activity_data FROM meal_plan_inputs WHERE user_id = ?`,
        [userId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        goals: row.goals_data ? JSON.parse(row.goals_data) : null,
        info: row.info_data ? JSON.parse(row.info_data) : null,
        activity: row.activity_data ? JSON.parse(row.activity_data) : null
      };
    }
  }

  // ========== Core Finishers Viewed Tracking ==========

  async markCoreFinisherAsViewed(userId, workoutDate) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO core_finishers_viewed (user_id, workout_date)
         VALUES ($1, $2)
         ON CONFLICT (user_id, workout_date) DO NOTHING
         RETURNING id`,
        [userId, workoutDate]
      );
      return result.rows.length > 0;
    } else {
      try {
        const result = await this.query(
          `INSERT INTO core_finishers_viewed (user_id, workout_date)
           VALUES (?, ?)`,
          [userId, workoutDate]
        );
        return true;
      } catch (error) {
        // Ignore unique constraint violations
        return false;
      }
    }
  }

  async getCoreFinishersViewedCount(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM core_finishers_viewed WHERE user_id = $1`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    } else {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM core_finishers_viewed WHERE user_id = ?`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    }
  }

  async getCoreFinishersViewed(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT workout_date FROM core_finishers_viewed WHERE user_id = $1 ORDER BY viewed_at DESC`,
        [userId]
      );
      return result.rows.map(row => row.workout_date);
    } else {
      const result = await this.query(
        `SELECT workout_date FROM core_finishers_viewed WHERE user_id = ? ORDER BY viewed_at DESC`,
        [userId]
      );
      return result.rows.map(row => row.workout_date);
    }
  }

  // ========== Strength Workouts Viewed Tracking ==========

  async markStrengthWorkoutAsViewed(userId, workoutId) {
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO strength_workouts_viewed (user_id, workout_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, workout_id) DO NOTHING
         RETURNING id`,
        [userId, workoutId]
      );
      return result.rows.length > 0;
    } else {
      try {
        const result = await this.query(
          `INSERT INTO strength_workouts_viewed (user_id, workout_id)
           VALUES (?, ?)`,
          [userId, workoutId]
        );
        return true;
      } catch (error) {
        // Ignore unique constraint violations
        return false;
      }
    }
  }

  async getStrengthWorkoutsViewedCount(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM strength_workouts_viewed WHERE user_id = $1`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    } else {
      const result = await this.query(
        `SELECT COUNT(*) as count FROM strength_workouts_viewed WHERE user_id = ?`,
        [userId]
      );
      return parseInt(result.rows[0]?.count || 0);
    }
  }

  async getStrengthWorkoutsViewed(userId) {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT workout_id FROM strength_workouts_viewed WHERE user_id = $1 ORDER BY viewed_at DESC`,
        [userId]
      );
      return result.rows.map(row => row.workout_id);
    } else {
      const result = await this.query(
        `SELECT workout_id FROM strength_workouts_viewed WHERE user_id = ? ORDER BY viewed_at DESC`,
        [userId]
      );
      return result.rows.map(row => row.workout_id);
    }
  }

  // ========== Free Trials ==========

  /** Check if email or phone already has a free trial; returns { id, start_date, end_date } or null. */
  async getFreeTrialByEmailOrPhone(email, phone) {
    const norm = (s) => (s && String(s).trim()) || null;
    const e = norm(email);
    const p = norm(phone);
    if (!e && !p) return null;
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT id, start_date, end_date FROM free_trials WHERE email = $1 OR (phone IS NOT NULL AND phone = $2) LIMIT 1`,
        [e || '', p || '']
      );
      return result.rows[0] || null;
    }
    const result = await this.query(
      `SELECT id, start_date, end_date FROM free_trials WHERE email = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1`,
      [e || '', p || '']
    );
    return result.rows[0] || null;
  }

  /** Create a free trial; start/end = calendar dates in America/Denver (7-day window). */
  async createFreeTrial(firstName, lastName, email, phone, howHeard, question) {
    const todayMt = DateTime.now().setZone(AMERICA_DENVER).startOf('day');
    const startDate = todayMt.toFormat('yyyy-MM-dd');
    const endDate = todayMt.plus({ days: 7 }).toFormat('yyyy-MM-dd');
    if (this.isPostgres) {
      const result = await this.query(
        `INSERT INTO free_trials (first_name, last_name, email, phone, how_heard, question, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, start_date, end_date`,
        [firstName, lastName, email, phone || null, howHeard || null, question || null, startDate, endDate]
      );
      return result.rows[0] ? { id: result.rows[0].id, start_date: result.rows[0].start_date, end_date: result.rows[0].end_date } : null;
    } else {
      const result = await this.query(
        `INSERT INTO free_trials (first_name, last_name, email, phone, how_heard, question, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [firstName, lastName, email, phone || null, howHeard || null, question || null, startDate, endDate]
      );
      return { id: result.lastID, start_date: startDate, end_date: endDate };
    }
  }

  /** Get active free trial for a user: by user_id or by user email; end_date >= today (Mountain calendar). */
  async getActiveFreeTrialByUserOrEmail(userId, userEmail) {
    const today = DateTime.now().setZone(AMERICA_DENVER).toFormat('yyyy-MM-dd');
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT * FROM free_trials WHERE (user_id = $1 OR email = $2) AND end_date >= $3 ORDER BY created_at DESC LIMIT 1`,
        [userId, userEmail || '', today]
      );
      return result.rows[0] || null;
    } else {
      const result = await this.query(
        `SELECT * FROM free_trials WHERE (user_id = ? OR email = ?) AND end_date >= ? ORDER BY created_at DESC LIMIT 1`,
        [userId, userEmail || '', today]
      );
      return result.rows[0] || null;
    }
  }

  /** Link free trial to user when they log in (by email). */
  async linkFreeTrialToUserByEmail(email, userId) {
    if (!email || !userId) return;
    if (this.isPostgres) {
      await this.query(
        `UPDATE free_trials SET user_id = $1 WHERE email = $2 AND user_id IS NULL`,
        [userId, email]
      );
    } else {
      await this.query(
        `UPDATE free_trials SET user_id = ? WHERE email = ? AND user_id IS NULL`,
        [userId, email]
      );
    }
  }

  /** List all free trials for admin (first_name, last_name, email, phone, how_heard, start_date, end_date). */
  async listFreeTrialsForAdmin() {
    if (this.isPostgres) {
      const result = await this.query(
        `SELECT id, first_name, last_name, email, phone, how_heard, question, start_date, end_date, created_at FROM free_trials ORDER BY created_at DESC`,
        []
      );
      return result.rows || [];
    } else {
      const result = await this.query(
        `SELECT id, first_name, last_name, email, phone, how_heard, question, start_date, end_date, created_at FROM free_trials ORDER BY created_at DESC`,
        []
      );
      return result.rows || [];
    }
  }
}

module.exports = {
  initDatabase,
  Database,
  generateHouseholdId
};
