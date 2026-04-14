# Paid Tier (Tier Two, Three, Four) Payment Workflow

This document outlines the complete workflow when a user selects a paid tier (tier_two, tier_three, or tier_four) and completes the payment process.

## Overview

The payment flow uses **Stripe Subscriptions Mode** by default, which creates recurring subscriptions that automatically charge users every 30 days.

**Note**: The system defaults to `BILLING_MODE=stripe_subscriptions` for automatic recurring billing. Users are charged monthly and subscriptions automatically renew.

---

## Step-by-Step Workflow

### 1. User Clicks "Purchase" Button

**Location**: `public/app.js` - `window.purchaseTier(tier, isUpgrade)`

**User Action**: 
- User clicks "Purchase" button on tier card (tier_two, tier_three, or tier_four)

**What Happens**:
- Function checks if tier is `tier_one` (free) - if so, uses free tier flow
- For paid tiers, ensures Stripe is initialized
- Opens payment modal (`paymentModal`)
- Shows loading state

---

### 2. Create Payment Intent (Backend)

**Endpoint**: `POST /api/payments/create-intent`

**Location**: `routes.js` - Payment Routes section

**Backend Process**:

#### A. Get or Create Stripe Customer
- Checks if user has existing Stripe customer ID
- If not, creates new Stripe customer using `createCustomer(user.email)`
- Stores customer ID for future payments

#### B. Create Stripe Subscription (Default Mode)

**The system uses Stripe Subscriptions mode by default**:
1. Gets price ID for tier:
   - `tier_two` → `STRIPE_PRICE_DAILY` ($7/mo)
   - `tier_three` → `STRIPE_PRICE_WEEKLY` ($12/mo)
   - `tier_four` → `STRIPE_PRICE_MONTHLY` ($18/mo)
2. Cancels old subscription if upgrading
3. Creates Stripe subscription with `default_incomplete` status
4. Gets client secret from `subscription.latest_invoice.payment_intent.client_secret`
5. Stores subscription in database with `incomplete` status
6. Returns:
   ```json
   {
     "subscriptionId": "sub_xxx",
     "clientSecret": "pi_xxx_secret_xxx",
     "status": "incomplete",
     "tier": "tier_two",
     "requiresPayment": true
   }
   ```

**Note**: The system now defaults to Stripe Subscriptions mode. One-time payment mode is only used if `BILLING_MODE=one_time` is explicitly set in environment variables.

---

### 3. Display Payment Form (Frontend)

**Location**: `public/app.js` - `window.purchaseTier()` function

**What User Sees**:
- Payment modal opens
- Stripe Payment Element is mounted in `#paymentElement` div
- User can enter:
  - Card number
  - Expiration date
  - CVC
  - Billing details (if required)

**Code Flow**:
```javascript
// Create Stripe Elements instance
stripeElements = stripe.elements({
    clientSecret: data.clientSecret
});

// Create and mount payment element
const paymentElement = stripeElements.create('payment');
paymentElement.mount('#paymentElement');
```

---

### 4. User Submits Payment

**Location**: `public/app.js` - `handlePayment()` function

**User Action**: 
- Clicks "Pay" button in payment modal
- Stripe validates card details

**What Happens**:
```javascript
const { error, paymentIntent: confirmedIntent } = await stripe.confirmPayment({
    elements: stripeElements,
    confirmParams: {
        return_url: window.location.origin,
    },
    redirect: 'if_required'  // Only redirect if 3D Secure required
});
```

**Possible Outcomes**:
- **Success**: Payment confirmed, `confirmedIntent.status === 'succeeded'`
- **Error**: Card declined, insufficient funds, etc. - Error message shown
- **3D Secure Required**: User redirected to bank authentication, then back

---

### 5. Payment Confirmation (Backend)

**Stripe Subscriptions Mode (Default)**

**Webhook Handler**: `webhooks.js` - `handleInvoicePaymentSucceeded()`

**Initial Payment**:
1. Stripe sends webhook when payment succeeds
2. Backend receives `invoice.payment_succeeded` event
3. Updates subscription status to `active` in database
4. Sets correct end date from subscription period (30 days from now)

**Automatic Renewals**:
1. Every 30 days, Stripe automatically charges the user's payment method
2. Stripe sends `invoice.payment_succeeded` webhook
3. Backend updates subscription `end_date` to new period end (extends by 30 days)
4. Subscription remains active without user intervention

**Frontend Response**:
- Shows: `"Payment successful! Your subscription is being activated..."`
- Waits 2 seconds for webhook to process
- Refreshes subscription status
- Shows dashboard

---

### 6. User Communication After Payment

**Location**: `public/app.js` - `showSuccess()` function

**Success Messages Shown to User**:

**Stripe Subscriptions Mode (Default)**:
```
"Payment successful! Your subscription is being activated..."
```
- Shown via `alert()` popup
- Waits 2 seconds for webhook processing
- Then refreshes data

**Note**: After the initial payment, subscriptions automatically renew every 30 days. Users are charged automatically and their subscription end date is extended. No user action is required for renewals.

**After Success Message**:
1. Payment modal closes
2. Subscription status is reloaded (`loadSubscription()`)
3. Workouts are reloaded (`loadWorkouts()`)
4. Dashboard is shown (`showOnlyDashboard()`)
5. User can now access tier-specific features

---

## Error Handling

### Payment Errors

**Card Declined**:
- Stripe returns error
- Error message displayed in payment modal: `error.message`
- User can retry with different card

**Network Errors**:
- Error message: `"Network error: [error message]. Please check your connection and try again."`
- User can retry

**Payment Succeeds but Activation Fails**:
- Error message: `"Payment succeeded but subscription activation failed. Please contact support."`
- Payment is processed but subscription not activated
- User should contact support

---

## Database Updates

### Payment Record
- Created when payment intent is created
- Updated to `succeeded` when payment confirms
- Stores: `user_id`, `stripe_payment_intent_id`, `amount`, `tier`, `status`

### Subscription Record
- Created/updated when payment confirms
- Stores: `user_id`, `tier`, `stripe_customer_id`, `stripe_subscription_id` (if subscription mode), `status`, `end_date`

---

## Pricing

**Tier Pricing** (from `payments.js`):
- `tier_two`: $7.00/month (700 cents)
- `tier_three`: $12.00/month (1200 cents)
- `tier_four`: $18.00/month (1800 cents)

**Upgrade Pricing**:
- Pro-rated based on remaining days in current subscription
- Calculated via `calculateUpgradePrice()` function

---

## Summary Flow Diagram

```
User clicks "Purchase"
    ↓
Frontend: Open payment modal
    ↓
Backend: Create payment intent/subscription
    ↓
Frontend: Display Stripe Payment Element
    ↓
User enters card details
    ↓
User clicks "Pay"
    ↓
Stripe processes payment
    ↓
Payment succeeds?
    ├─ Yes → Backend confirms payment
    │         ↓
    │      Frontend: Show success message
    │         ↓
    │      Refresh subscription & show dashboard
    │
    └─ No → Show error message
             User can retry
```

---

## Key Files

- **Frontend Payment Logic**: `public/app.js` - `window.purchaseTier()`, `handlePayment()`
- **Backend Payment Routes**: `routes.js` - `/payments/create-intent`, `/payments/confirm`
- **Stripe Integration**: `payments.js` - Payment intent and subscription creation
- **Webhook Handlers**: `webhooks.js` - Handles Stripe webhook events
- **Payment Modal**: `public/index.html` - Payment modal HTML structure

