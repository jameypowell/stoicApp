// Stripe Webhook Handler
// This handles Stripe webhooks for payment confirmations
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { calculateEndDate, normalizeTier } = require('./payments');
const {
  getContractStartEndYmdFromSucceededPaymentIntent,
  computeGymContractEndYmdFromStartYmd,
  ymdFromUnixSecondsDenver,
  nextGymContractEndYmdDenver,
  gymBillingAnchorYmdFromMembershipRow,
  gymContractStartYmdToPersistOnPayment,
  nextAppSubscriptionEndIsoFromRow
} = require('./lib/gym-contract-dates');
const { tierFromStripeSubscription } = require('./stripe-subscription-resolve');

// Payment rules (grace period, late fee) from membership-rules.json
let GYM_GRACE_PERIOD_DAYS = 7;
let GYM_LATE_FEE_DOLLARS = 15;
try {
  const rules = require('./membership-rules.json');
  if (rules.paymentRules) {
    if (typeof rules.paymentRules.gracePeriodDays === 'number') GYM_GRACE_PERIOD_DAYS = rules.paymentRules.gracePeriodDays;
    if (typeof rules.paymentRules.lateFee === 'number') GYM_LATE_FEE_DOLLARS = rules.paymentRules.lateFee;
  }
} catch (e) {
  // use defaults
}

// Helper function to save payment method to customer and set as default
async function savePaymentMethodToCustomer(customerId, paymentMethodId) {
  try {
    if (!customerId || !paymentMethodId) {
      console.log('Missing customerId or paymentMethodId for saving payment method');
      return false;
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    console.log(`✅ Saved payment method ${paymentMethodId} to customer ${customerId} and set as default`);
    return true;
  } catch (error) {
    // If payment method is already attached, that's okay
    if (error.code === 'resource_already_exists') {
      // Just set as default
      try {
        await stripe.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
        console.log(`✅ Set payment method ${paymentMethodId} as default for customer ${customerId}`);
        return true;
      } catch (updateError) {
        console.error(`Error setting default payment method: ${updateError.message}`);
        return false;
      }
    }
    console.error(`Error saving payment method to customer: ${error.message}`);
    return false;
  }
}

function createWebhookRouter(db) {
  const router = express.Router();

  // Stripe webhook endpoint (must be raw body for signature verification)
  router.post('/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Check idempotency (prevent duplicate processing)
      const isProcessed = await db.isWebhookProcessed(event.id);
      if (isProcessed) {
        console.log(`Webhook event ${event.id} already processed, skipping`);
        return res.json({ received: true, skipped: true });
      }

      // Mark as processed before handling (prevents race conditions)
      await db.markWebhookProcessed(event.id, event.type, event.data);

      // Handle the event
      switch (event.type) {
        // Payment Intent events (for one-time payments and subscription confirmations)
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          // Check if this is for a subscription invoice
          if (paymentIntent.invoice) {
            try {
              const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
              if (invoice.subscription && paymentIntent.payment_method && invoice.customer) {
                // Save payment method for subscription payments
                await savePaymentMethodToCustomer(invoice.customer, paymentIntent.payment_method);
              }
            } catch (error) {
              console.error('Error saving payment method from payment_intent.succeeded:', error.message);
            }
            // Invoice.payment_succeeded will handle the subscription update
          } else {
            // Handle drop-in payments separately (no subscription)
            if (paymentIntent.metadata?.type === 'drop_in') {
              await handleDropInPaymentSuccess(paymentIntent, db);
            } else if (
              paymentIntent.metadata?.type === 'gym_membership' ||
              paymentIntent.metadata?.type === 'gym_membership_renewal' ||
              paymentIntent.metadata?.type === 'gym_membership_resume'
            ) {
              await handleGymMembershipPaymentIntentSuccess(paymentIntent, db);
            } else {
              // Handle other one-time payments (app tiers)
              await handlePaymentSuccess(paymentIntent, db);
            }
          }
          break;

        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object;
          console.log('Payment failed:', failedPayment.id);
          await db.createAppPaymentErrorLog({
            userId: failedPayment.metadata?.userId ? parseInt(failedPayment.metadata.userId, 10) : null,
            userEmail: failedPayment.receipt_email || null,
            stripeCustomerId: failedPayment.customer || null,
            stripePaymentIntentId: failedPayment.id,
            tier: failedPayment.metadata?.tier || null,
            eventType: 'payment_intent_failed',
            severity: 'error',
            message: failedPayment.last_payment_error?.message || 'Payment intent failed.',
            details: {
              status: failedPayment.status,
              code: failedPayment.last_payment_error?.code || null,
              decline_code: failedPayment.last_payment_error?.decline_code || null
            }
          });
          // Update payment status in database
          break;

        // Subscription events (for recurring subscriptions)
        case 'customer.subscription.created':
          const newSubscription = event.data.object;
          await handleSubscriptionCreated(newSubscription, db);
          break;

        case 'customer.subscription.updated':
          const updatedSubscription = event.data.object;
          // Check if it's a gym membership subscription
          if (updatedSubscription.metadata?.type === 'gym_membership') {
            await handleGymMembershipSubscriptionUpdated(updatedSubscription, db);
          } else {
            await handleSubscriptionUpdated(updatedSubscription, db);
          }
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object;
          // Check if it's a gym membership subscription
          if (deletedSubscription.metadata?.type === 'gym_membership') {
            await handleGymMembershipSubscriptionDeleted(deletedSubscription, db);
          } else {
            await handleSubscriptionDeleted(deletedSubscription, db);
          }
          break;

        // Invoice events (for subscription payments)
        case 'invoice.payment_succeeded':
          const succeededInvoice = event.data.object;
          // Check if it's a gym membership subscription invoice
          if (succeededInvoice.subscription) {
            try {
              const invoiceSub = await stripe.subscriptions.retrieve(succeededInvoice.subscription);
              if (invoiceSub.metadata?.type === 'gym_membership') {
                await handleGymMembershipInvoicePaymentSucceeded(succeededInvoice, db);
              } else {
                await handleInvoicePaymentSucceeded(succeededInvoice, db);
              }
            } catch (error) {
              // Fallback to regular handler if we can't retrieve subscription
              await handleInvoicePaymentSucceeded(succeededInvoice, db);
            }
          } else {
            await handleInvoicePaymentSucceeded(succeededInvoice, db);
          }
          break;

        case 'invoice.payment_failed':
          const failedInvoice = event.data.object;
          // Check if it's a gym membership subscription invoice
          if (failedInvoice.subscription) {
            try {
              const invoiceSub = await stripe.subscriptions.retrieve(failedInvoice.subscription);
              if (invoiceSub.metadata?.type === 'gym_membership') {
                await handleGymMembershipInvoicePaymentFailed(failedInvoice, db);
              } else {
                await handleInvoicePaymentFailed(failedInvoice, db);
              }
            } catch (error) {
              // Fallback to regular handler if we can't retrieve subscription
              await handleInvoicePaymentFailed(failedInvoice, db);
            }
          } else {
            await handleInvoicePaymentFailed(failedInvoice, db);
          }
          break;

        // Setup Intent events (for adding payment methods)
        case 'setup_intent.succeeded':
          const setupIntent = event.data.object;
          if (setupIntent.payment_method && setupIntent.customer) {
            try {
              await savePaymentMethodToCustomer(setupIntent.customer, setupIntent.payment_method);
              console.log(`✅ Payment method ${setupIntent.payment_method} saved from setup intent ${setupIntent.id}`);
            } catch (error) {
              console.error('Error saving payment method from setup_intent.succeeded:', error.message);
            }
          }
          break;

        case 'charge.refunded': {
          const refundedCharge = event.data.object;
          const piField = refundedCharge.payment_intent;
          const piId = typeof piField === 'string' ? piField : piField && piField.id;
          if (!piId) {
            console.warn(
              `charge.refunded: no payment_intent on charge ${refundedCharge.id || '(no id)'}; cannot update payments row`
            );
            break;
          }
          const amount = Number(refundedCharge.amount) || 0;
          const refunded = Number(refundedCharge.amount_refunded) || 0;
          const status = amount > 0 && refunded >= amount ? 'refunded' : 'partially_refunded';
          try {
            const updated = await db.updatePayment(piId, status);
            if (updated) {
              console.log(`✅ Payment ${piId} marked ${status} (charge.refunded)`);
            } else {
              console.warn(
                `charge.refunded: no payments row updated for stripe_payment_intent_id=${piId} (charge=${refundedCharge.id}, status=${status}, amount_refunded=${refunded}/${amount}). Row may be missing, use invoice id as key, or PI id mismatch.`
              );
            }
          } catch (e) {
            console.error('charge.refunded: could not update payment row:', e.message);
          }
          break;
        }

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    }
  );

  return router;
}

// Handle drop-in payment success (record payment only, no subscription)
// We do not create a payment row when the intent is created, so we create it here (or update if it exists).
async function handleDropInPaymentSuccess(paymentIntent, db) {
  try {
    const updated = await db.updatePayment(paymentIntent.id, 'succeeded');
    if (updated) {
      console.log(`Drop-in payment updated: ${paymentIntent.id}`);
      return;
    }
    const userId = parseInt(paymentIntent.metadata?.userId, 10);
    const email = paymentIntent.metadata?.email || '';
    if (!userId) {
      console.error('Drop-in payment_intent.succeeded: missing userId in metadata');
      return;
    }
    await db.createPayment(
      userId,
      paymentIntent.id,
      paymentIntent.amount || 0,
      paymentIntent.currency || 'usd',
      'drop_in',
      'succeeded',
      email
    );
    const metaSig = String(paymentIntent.metadata?.waiverSignature || '').trim().slice(0, 200);
    if (metaSig) {
      const u = await db.getUserById(userId);
      if (u && (!u.name || !String(u.name).trim())) {
        await db.updateUserName(userId, metaSig);
      }
    }
    console.log(`Drop-in payment recorded: ${paymentIntent.id}`);
  } catch (error) {
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT' || /unique|duplicate/i.test(error.message || '')) {
      // Row already created by confirm-from-client
      return;
    }
    console.error('Error handling drop-in payment success:', error);
  }
}

// Handle gym membership first payment (payment_intent.succeeded with no invoice)
// Ensures gym_memberships row exists and records payment, so table is populated even if /create or /confirm-payment never ran
async function handleGymMembershipPaymentIntentSuccess(paymentIntent, db) {
  try {
    const metaType = String(paymentIntent.metadata?.type || 'gym_membership');
    const userId = parseInt(
      paymentIntent.metadata?.userId ?? paymentIntent.metadata?.user_id,
      10
    );
    const membershipType =
      paymentIntent.metadata?.membershipType ||
      paymentIntent.metadata?.membership_type ||
      'standard';
    if (!userId || Number.isNaN(userId)) {
      console.error('Gym membership payment_intent.succeeded: missing userId/user_id', paymentIntent.id);
      return;
    }

    // Nightly job (or admin) already advances contract_end_date; only ensure payments row exists.
    if (metaType === 'gym_membership_renewal' || metaType === 'gym_membership_resume') {
      const user = await db.getUserById(userId);
      if (!user) {
        console.error('Gym membership renewal/resume webhook: user not found', userId);
        return;
      }
      try {
        await db.createPayment(
          userId,
          paymentIntent.id,
          paymentIntent.amount || 0,
          paymentIntent.currency || 'usd',
          'gym_membership',
          'succeeded',
          user.email || null
        );
        console.log(`Gym membership ${metaType} payment recorded for user ${userId}, pi=${paymentIntent.id}`);
      } catch (payErr) {
        if (payErr.code !== '23505' && payErr.code !== 'SQLITE_CONSTRAINT' && !/unique|duplicate/i.test(payErr.message || '')) {
          console.error('Error recording gym renewal/resume payment:', payErr.message);
        }
      }
      return;
    }

    const piFull = await stripe.paymentIntents.retrieve(paymentIntent.id, { expand: ['latest_charge'] });
    const { contractStartYmd, contractEndYmd } = await getContractStartEndYmdFromSucceededPaymentIntent(stripe, piFull);
    if (!contractStartYmd || !contractEndYmd) {
      console.error('Gym membership payment_intent.succeeded: could not derive contract dates from charge', paymentIntent.id);
      return;
    }
    const user = await db.getUserById(userId);
    if (!user) {
      console.error('Gym membership payment_intent.succeeded: user not found', userId);
      return;
    }
    let membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1'
        : 'SELECT * FROM gym_memberships WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [userId, 'active']
    );
    if (!membership) {
      let householdId = 'HH-';
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (let i = 0; i < 6; i++) householdId += chars.charAt(Math.floor(Math.random() * chars.length));
      const insertResult = await db.query(
        db.isPostgres
          ? `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, created_at)
             VALUES ($1, $2, $3, true, 'active', $4, $5, 12, CURRENT_TIMESTAMP) RETURNING id`
          : `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, created_at)
             VALUES (?, ?, ?, 1, 'active', ?, ?, 12, datetime('now'))`,
        db.isPostgres
          ? [userId, membershipType, householdId, contractStartYmd, contractEndYmd]
          : [userId, membershipType, householdId, contractStartYmd, contractEndYmd]
      );
      const newId = insertResult.rows?.[0]?.id ?? insertResult.lastID;
      if (newId) {
        membership = await db.queryOne(
          db.isPostgres ? 'SELECT * FROM gym_memberships WHERE id = $1' : 'SELECT * FROM gym_memberships WHERE id = ?',
          [newId]
        );
        console.log(`Gym membership row created from payment_intent.succeeded for user ${userId}, id=${newId}`);
      }
    } else if (!membership.stripe_subscription_id) {
      await db.query(
        db.isPostgres
          ? `UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`
          : `UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime('now') WHERE id = ?`,
        [contractStartYmd, contractEndYmd, membership.id]
      );
    }
    if (membership) {
      try {
        await db.createPayment(userId, paymentIntent.id, paymentIntent.amount || 0, paymentIntent.currency || 'usd', 'gym_membership', 'succeeded', user.email);
        console.log(`Gym membership payment recorded for user ${userId}, amount ${(paymentIntent.amount || 0) / 100}`);
      } catch (payErr) {
        if (payErr.code !== '23505' && payErr.code !== 'SQLITE_CONSTRAINT' && !/unique|duplicate/i.test(payErr.message || '')) {
          console.error('Error recording gym payment in webhook:', payErr.message);
        }
      }
    }
  } catch (error) {
    console.error('Error in handleGymMembershipPaymentIntentSuccess:', error);
  }
}

// Handle app-tier PaymentIntent success (metadata.userId + tier; DB row, no Stripe Subscription)
async function handlePaymentSuccess(paymentIntent, db) {
  try {
    const { metadata } = paymentIntent;
    const userId = parseInt(metadata.userId);
    const tier = metadata.tier;

    if (!userId || !tier) {
      console.error('Missing metadata in payment intent');
      return;
    }

    // Get user
    const user = await db.getUserById(userId);
    if (!user) {
      console.error('User not found:', userId);
      return;
    }

    // Get or create Stripe customer
    let stripeCustomerId = paymentIntent.customer;
    
    // Save payment method if available
    if (paymentIntent.payment_method && stripeCustomerId) {
      try {
        await savePaymentMethodToCustomer(stripeCustomerId, paymentIntent.payment_method);
      } catch (pmError) {
        console.error('Error saving payment method from payment intent:', pmError.message);
      }
    }
    
    // Calculate end date
    const endDate = calculateEndDate(tier);

    // Create subscription (createSubscription will automatically cancel any existing active subscriptions)
    await db.createSubscription(
      userId,
      tier,
      stripeCustomerId,
      null, // One-time payment, not recurring subscription
      endDate
    );

    // Update payment status
    await db.createPayment(
      userId,
      paymentIntent.id,
      paymentIntent.amount,
      paymentIntent.currency,
      tier,
      'succeeded'
    );

    console.log(`Subscription activated for user ${userId}, tier: ${tier}`);
  } catch (error) {
    console.error('Error handling payment success:', error);
  }
}

// Handle subscription created
async function handleSubscriptionCreated(subscription, db) {
  try {
    const { metadata } = subscription;
    const userId = parseInt(metadata.userId);
    
    // Check if this is a gym membership subscription
    if (metadata.type === 'gym_membership') {
      await handleGymMembershipSubscriptionCreated(subscription, db);
      return;
    }
    
    // Otherwise, handle as app subscription. Prefer Stripe price-derived tier over metadata.
    const tier = tierFromStripeSubscription(subscription) || normalizeTier(metadata.tier);

    if (!userId || !tier) {
      console.error('Missing metadata in subscription');
      return;
    }

    // Do not activate/switch app subscription for incomplete attempts.
    const activatesAccess = subscription.status === 'active' || subscription.status === 'trialing';
    if (!activatesAccess) {
      console.log(`Skipping app subscription create for ${subscription.id}; Stripe status=${subscription.status}`);
      return;
    }

    // Check if subscription already exists in database with this Stripe subscription ID
    const existing = await db.getUserActiveSubscription(userId);
    if (existing && existing.stripe_subscription_id === subscription.id) {
      console.log('Subscription already exists in database with this Stripe ID');
      return;
    }

    // Save payment method if subscription is active and has default payment method
    if (subscription.status === 'active' && subscription.default_payment_method) {
      try {
        await savePaymentMethodToCustomer(subscription.customer, subscription.default_payment_method);
      } catch (pmError) {
        console.error('Error saving payment method from subscription created:', pmError.message);
      }
    }

    // Calculate end date from subscription period
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const endDate = currentPeriodEnd.toISOString();

    // Create or update subscription in database
    if (existing && existing.stripe_subscription_id === subscription.id) {
      // Update existing subscription with matching Stripe ID
      await db.updateSubscription(existing.id, {
        tier: tier,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        end_date: endDate,
        status: 'active'
      });
    } else {
      // Create new subscription (createSubscription will automatically cancel any existing active subscriptions)
      await db.createSubscription(
        userId,
        tier,
        subscription.customer,
        subscription.id,
        endDate
      );
    }

    console.log(`Subscription created for user ${userId}, tier: ${tier}, subscription: ${subscription.id}`);
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

// Handle subscription updated (renewals, changes)
async function handleSubscriptionUpdated(subscription, db) {
  try {
    const { metadata } = subscription;
    const userId = parseInt(metadata.userId);
    
    // Check if there's a pending tier change from a downgrade
    const pendingTier = metadata.pendingTier;
    const rawTier = pendingTier || tierFromStripeSubscription(subscription) || metadata.tier || subscription.items.data[0]?.price?.metadata?.tier;
    const tier = normalizeTier(rawTier);

    // Find subscription by Stripe subscription ID
    const sql = db.isPostgres 
      ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
      : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?';
    const existing = await db.queryOne(sql, [subscription.id]);

    if (!existing) {
      if (subscription.status === 'active' || subscription.status === 'trialing') {
        console.log('Subscription not found in database, creating...');
        await handleSubscriptionCreated(subscription, db);
      } else {
        console.log(`Subscription ${subscription.id} not found; skipping create for status ${subscription.status}`);
      }
      return;
    }

    // Save payment method if subscription becomes active and has default payment method
    if (subscription.status === 'active' && subscription.default_payment_method) {
      try {
        await savePaymentMethodToCustomer(subscription.customer, subscription.default_payment_method);
      } catch (pmError) {
        console.error('Error saving payment method from subscription updated:', pmError.message);
      }
    }

    // Calculate end date from subscription period
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const endDate = currentPeriodEnd.toISOString();

    // Map Stripe status to our status - Stripe status takes priority
    let status = existing.status;
    if (subscription.status === 'canceled' || subscription.status === 'unpaid' ||
        subscription.status === 'incomplete_expired') {
      status = 'canceled';
    } else if (subscription.status === 'active' || subscription.status === 'trialing') {
      status = 'active';
    } else if (subscription.status === 'past_due') {
      status = 'grace_period';
    } else if (subscription.status === 'incomplete') {
      // Incomplete should not force a paid-tier switch for existing active members.
      // Keep previous DB status/tier until Stripe confirms active/trialing.
      status = existing.status;
    }

    // Do not extend local access window when payment did not complete.
    // Keep prior end_date for incomplete/incomplete_expired attempts.
    const shouldUpdateEndDate = !(subscription.status === 'incomplete' || subscription.status === 'incomplete_expired');

    // Update subscription
    await db.updateSubscription(existing.id, {
      tier: (subscription.status === 'active' || subscription.status === 'trialing') ? (tier || existing.tier) : existing.tier,
      end_date: shouldUpdateEndDate ? endDate : existing.end_date,
      status: status
    });

    if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired' ||
        subscription.status === 'past_due' || subscription.status === 'unpaid') {
      await db.createAppPaymentErrorLog({
        userId: existing.user_id,
        stripeCustomerId: existing.stripe_customer_id || null,
        stripeSubscriptionId: subscription.id,
        tier: tier || existing.tier || null,
        eventType: 'subscription_problem_status',
        severity: subscription.status === 'past_due' || subscription.status === 'unpaid' ? 'error' : 'warning',
        message: `Stripe subscription status is ${subscription.status}.`,
        details: {
          stripe_status: subscription.status,
          db_status: status
        }
      });
    }

    console.log(`Subscription updated for user ${existing.user_id}, subscription: ${subscription.id}, status: ${status}`);
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

// Handle subscription deleted (cancelled)
async function handleSubscriptionDeleted(subscription, db) {
  try {
    // Find subscription by Stripe subscription ID
    const sql = db.isPostgres 
      ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
      : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?';
    const existing = await db.queryOne(sql, [subscription.id]);

    if (existing) {
      // Mark as canceled
      await db.updateSubscriptionStatus(existing.id, 'canceled');
      console.log(`Subscription canceled for user ${existing.user_id}, subscription: ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

// Handle invoice payment succeeded (subscription renewal)
async function handleInvoicePaymentSucceeded(invoice, db) {
  try {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) {
      // Not a subscription invoice, skip
      return;
    }

    // Retrieve Stripe subscription to check type and get payment method
    let stripeSubscription;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (subError) {
      console.error('Error retrieving subscription from Stripe:', subError.message);
      // Continue with database lookup anyway
    }

    // Find subscription by Stripe subscription ID
    const sql = db.isPostgres 
      ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
      : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?';
    const existing = await db.queryOne(sql, [subscriptionId]);

    if (!existing) {
      console.log('Subscription not found for invoice:', subscriptionId);
      return;
    }

    // Save payment method if available and set as default on subscription (hybrid system)
    let paymentMethodId = null;
    let paymentMethodExpiresAt = null;
    if (invoice.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(invoice.payment_intent);
        if (paymentIntent.payment_method && invoice.customer) {
          paymentMethodId = typeof paymentIntent.payment_method === 'string' 
            ? paymentIntent.payment_method 
            : paymentIntent.payment_method.id;
          
          // Get payment method details to extract expiry date
          try {
            const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
            if (pm.card && pm.card.exp_year && pm.card.exp_month) {
              paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
            }
          } catch (pmError) {
            console.warn('Could not retrieve payment method expiry:', pmError.message);
          }
          
          // Save payment method to customer (sets as default on customer)
          await savePaymentMethodToCustomer(invoice.customer, paymentMethodId);
          
          // Save payment method to database (hybrid system)
          if (paymentMethodId) {
            await db.updateSubscriptionPaymentMethod(existing.id, paymentMethodId, paymentMethodExpiresAt);
          }
          
          // For app subscriptions (not gym memberships), also set as default on subscription
          // Gym memberships already handle this in their creation flow
          if (stripeSubscription && stripeSubscription.metadata?.type !== 'gym_membership') {
            // Check if subscription doesn't already have this payment method set
            if (stripeSubscription.default_payment_method !== paymentMethodId) {
              try {
                await stripe.subscriptions.update(subscriptionId, {
                  default_payment_method: paymentMethodId
                });
                console.log(`✅ Set default_payment_method on subscription ${subscriptionId} for automatic billing`);
              } catch (updateError) {
                console.error('Error setting default_payment_method on subscription:', updateError.message);
                // Don't fail - customer default is set, which should be sufficient
              }
            }
          }
        }
      } catch (pmError) {
        console.error('Error saving payment method from invoice:', pmError.message);
      }
    }

    const endDateISO =
      nextAppSubscriptionEndIsoFromRow(existing) ||
      (() => {
        let paymentDate;
        if (invoice.status_transitions && invoice.status_transitions.paid_at) {
          paymentDate = new Date(invoice.status_transitions.paid_at * 1000);
        } else {
          paymentDate = new Date();
        }
        const endDate = new Date(paymentDate);
        endDate.setDate(endDate.getDate() + 30);
        endDate.setHours(23, 59, 59, 999);
        return endDate.toISOString();
      })();

    const oldStatus = existing.status;
    await db.updateSubscription(existing.id, {
      end_date: endDateISO,
      status: 'active'
    });
    
    // Reset payment failures after successful payment (hybrid system)
    await db.resetPaymentFailures(existing.id);
    
    // Record status change if needed
    if (oldStatus !== 'active') {
      await db.recordSubscriptionStatusChange(existing.id, 'app_subscription', oldStatus, 'active', 'payment_succeeded', invoice.id);
    }

    // Payment History + admin "Last app charge" (invoice renewals did not write rows before)
    const payTier = existing.tier;
    const appTierSet = new Set(['tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly']);
    if (payTier && appTierSet.has(payTier)) {
      const paymentRowId = invoice.payment_intent || `inv_${invoice.id}`;
      const amountCents = invoice.amount_paid || 0;
      const cur = invoice.currency || 'usd';
      try {
        const u = await db.getUserById(existing.user_id);
        await db.createPayment(
          existing.user_id,
          paymentRowId,
          amountCents,
          cur,
          payTier,
          'succeeded',
          u?.email || null
        );
        console.log(`✅ App subscription payment recorded for user ${existing.user_id}, invoice ${invoice.id}`);
      } catch (payErr) {
        const dup = payErr.code === '23505' || payErr.code === 'SQLITE_CONSTRAINT' || /unique|duplicate/i.test(payErr.message || '');
        if (!dup) console.error('Error recording app subscription payment from invoice:', payErr.message);
      }
    }

    console.log(`Subscription renewed for user ${existing.user_id}, new end date: ${endDateISO}`);
  } catch (error) {
    console.error('Error handling invoice payment succeeded:', error);
  }
}

// Handle invoice payment failed (hybrid system: record failure and set grace period)
async function handleInvoicePaymentFailed(invoice, db) {
  try {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) {
      return;
    }

    // Find subscription by Stripe subscription ID
    const sql = db.isPostgres 
      ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
      : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?';
    const existing = await db.queryOne(sql, [subscriptionId]);

    if (!existing) {
      console.log(`Subscription not found for failed invoice: ${subscriptionId}`);
      return;
    }

    console.log(`Payment failed for subscription ${subscriptionId}, user ${existing.user_id}`);
    
    // Record payment failure (hybrid system)
    const currentFailureCount = (existing.payment_failure_count || 0) + 1;
    const lastFailureAt = new Date().toISOString();
    const GRACE_PERIOD_DAYS = 7;
    const MAX_FAILURE_COUNT = 3;
    
    if (currentFailureCount < MAX_FAILURE_COUNT) {
      // Set grace period
      const gracePeriodEndsAt = new Date();
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + GRACE_PERIOD_DAYS);
      
      const oldStatus = existing.status;
      await db.recordPaymentFailure(
        existing.id,
        currentFailureCount,
        lastFailureAt,
        gracePeriodEndsAt.toISOString()
      );
      
      // Record status change if entering grace period
      if (oldStatus !== 'grace_period') {
        await db.recordSubscriptionStatusChange(existing.id, 'app_subscription', oldStatus, 'grace_period', 'payment_failed', invoice.id);
      }
      
      console.log(`  ⚠️  Payment failure ${currentFailureCount}/${MAX_FAILURE_COUNT}. Grace period until ${gracePeriodEndsAt.toISOString().split('T')[0]}`);
    } else {
      // Too many failures - suspend subscription
      const oldStatus = existing.status;
      await db.updateSubscriptionStatus(existing.id, 'paused', oldStatus, 'max_failures_reached', invoice.id);
      
      console.log(`  🛑 Maximum failures reached. Subscription suspended.`);
    }
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
  }
}

// ========== Gym Membership Webhook Handlers ==========

// Handle gym membership subscription created
async function handleGymMembershipSubscriptionCreated(subscription, db) {
  try {
    const { metadata } = subscription;
    const userId = parseInt(metadata.userId);
    const membershipId = parseInt(metadata.membershipId);
    const membershipType = metadata.membershipType;

    if (!userId || !membershipId) {
      console.error('Missing userId or membershipId in gym membership subscription metadata');
      return;
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1 AND user_id = $2'
        : 'SELECT * FROM gym_memberships WHERE id = ? AND user_id = ?',
      [membershipId, userId]
    );

    if (!membership) {
      console.error(`Gym membership ${membershipId} not found for user ${userId}`);
      return;
    }

    // Map Stripe status to database status
    let dbStatus = 'active';
    if (subscription.status === 'canceled' || subscription.status === 'unpaid' || 
        subscription.status === 'incomplete_expired') {
      dbStatus = 'inactive';
    } else if (subscription.status === 'past_due') {
      dbStatus = 'active'; // Keep active, but access will be checked via Stripe status
    } else if (subscription.status === 'active' || subscription.status === 'trialing') {
      dbStatus = 'active';
    }

    // Calculate contract end date from subscription period end
    const contractEndDate = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    // Update membership with Stripe IDs and status
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET stripe_customer_id = $1, stripe_subscription_id = $2, stripe_subscription_item_id = $3, status = $4, contract_end_date = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6'
        : 'UPDATE gym_memberships SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?, status = ?, contract_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        subscription.customer,
        subscription.id,
        subscription.items.data[0]?.id || null,
        dbStatus,
        contractEndDate,
        membershipId
      ]
    );

    console.log(`✅ Gym membership subscription created for membership ${membershipId}, user ${userId}, status: ${dbStatus}`);
  } catch (error) {
    console.error('Error handling gym membership subscription created:', error);
  }
}

// Handle gym membership subscription updated
async function handleGymMembershipSubscriptionUpdated(subscription, db) {
  try {
    const { metadata } = subscription;
    const membershipId = parseInt(metadata.membershipId);

    if (!membershipId) {
      console.error('Missing membershipId in gym membership subscription metadata');
      return;
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membershipId]
    );

    if (!membership) {
      console.error(`Gym membership ${membershipId} not found`);
      return;
    }

    // Map Stripe status to database status
    let dbStatus = 'active';
    if (subscription.status === 'canceled' || subscription.status === 'unpaid' || 
        subscription.status === 'incomplete_expired') {
      dbStatus = 'inactive';
    } else if (subscription.status === 'past_due') {
      dbStatus = 'active'; // Keep active, but access will be checked via Stripe status
    } else if (subscription.status === 'active' || subscription.status === 'trialing') {
      dbStatus = 'active';
    } else if (subscription.status === 'paused') {
      dbStatus = 'paused';
    }

    // Calculate contract end date from subscription period end
    const contractEndDate = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : membership.contract_end_date;

    // Update membership with Stripe IDs and status
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET stripe_customer_id = $1, stripe_subscription_id = $2, stripe_subscription_item_id = $3, status = $4, contract_end_date = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6'
        : 'UPDATE gym_memberships SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?, status = ?, contract_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        subscription.customer,
        subscription.id,
        subscription.items.data[0]?.id || membership.stripe_subscription_item_id,
        dbStatus,
        contractEndDate,
        membershipId
      ]
    );

    console.log(`✅ Gym membership subscription updated for membership ${membershipId}, status: ${dbStatus}`);
  } catch (error) {
    console.error('Error handling gym membership subscription updated:', error);
  }
}

// Handle gym membership subscription deleted
async function handleGymMembershipSubscriptionDeleted(subscription, db) {
  try {
    const { metadata } = subscription;
    const membershipId = parseInt(metadata.membershipId);

    if (!membershipId) {
      console.error('Missing membershipId in gym membership subscription metadata');
      return;
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membershipId]
    );

    if (membership) {
      // Stripe subscription ended: clear Stripe ids so nightly PI billing can run without double-charging.
      // Do not force inactive — member may continue on app-managed billing.
      await db.query(
        db.isPostgres
          ? `UPDATE gym_memberships SET
               stripe_subscription_id = NULL,
               stripe_subscription_item_id = NULL,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`
          : `UPDATE gym_memberships SET
               stripe_subscription_id = NULL,
               stripe_subscription_item_id = NULL,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
        [membershipId]
      );

      console.log(
        `✅ Gym Stripe subscription cleared for membership ${membershipId} (app-managed billing eligible if status remains active).`
      );
    }
  } catch (error) {
    console.error('Error handling gym membership subscription deleted:', error);
  }
}

// Handle gym membership invoice payment succeeded
async function handleGymMembershipInvoicePaymentSucceeded(invoice, db) {
  try {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) {
      return;
    }

    // Retrieve subscription to get metadata
    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    const membershipId = parseInt(stripeSub.metadata?.membershipId);

    if (!membershipId) {
      console.error('Missing membershipId in gym membership subscription metadata');
      return;
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membershipId]
    );

    if (!membership) {
      console.error(`Gym membership ${membershipId} not found`);
      return;
    }

    // Save payment method if available (hybrid system)
    let paymentMethodId = null;
    let paymentMethodExpiresAt = null;
    if (invoice.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(invoice.payment_intent);
        if (paymentIntent.payment_method && invoice.customer) {
          paymentMethodId = typeof paymentIntent.payment_method === 'string' 
            ? paymentIntent.payment_method 
            : paymentIntent.payment_method.id;
          
          // Get payment method details to extract expiry date
          try {
            const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
            if (pm.card && pm.card.exp_year && pm.card.exp_month) {
              paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
            }
          } catch (pmError) {
            console.warn('Could not retrieve payment method expiry:', pmError.message);
          }
          
          await savePaymentMethodToCustomer(invoice.customer, paymentMethodId);
          
          // Set as default on subscription so has_payment_method is true and alert is hidden
          try {
            await stripe.subscriptions.update(subscriptionId, {
              default_payment_method: paymentMethodId
            });
            console.log(`✅ Set default_payment_method on gym subscription ${subscriptionId}`);
          } catch (updateErr) {
            console.warn('Could not set subscription default_payment_method:', updateErr.message);
          }
          
          // Save payment method to database (hybrid system)
          if (paymentMethodId) {
            await db.updateGymMembershipPaymentMethod(membershipId, paymentMethodId, paymentMethodExpiresAt);
          }
        }
      } catch (pmError) {
        console.error('Error saving payment method from gym membership invoice:', pmError.message);
      }
    }

    // Sync contract dates: calendar-month billing in America/Denver (aligned with app-managed gym policy).
    let preferredStartYmd = null;
    let contractEndDate = membership.contract_end_date;
    if (stripeSub.current_period_start) {
      const startYmd = ymdFromUnixSecondsDenver(stripeSub.current_period_start);
      if (startYmd) {
        preferredStartYmd = startYmd;
        contractEndDate = computeGymContractEndYmdFromStartYmd(startYmd);
      }
    } else {
      const endPart =
        membership.contract_end_date &&
        String(membership.contract_end_date).trim().split('T')[0].split(' ')[0];
      const anchor = gymBillingAnchorYmdFromMembershipRow(membership);
      if (endPart && /^\d{4}-\d{2}-\d{2}$/.test(endPart) && anchor) {
        const nextEnd = nextGymContractEndYmdDenver(endPart, anchor);
        if (nextEnd) contractEndDate = nextEnd;
      }
    }

    const contractStartToPersist = gymContractStartYmdToPersistOnPayment(membership, preferredStartYmd);

    const oldStatus = membership.status;
    
    // Update membership contract dates from Stripe
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET contract_start_date = COALESCE($1::date, contract_start_date), contract_end_date = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4'
        : 'UPDATE gym_memberships SET contract_start_date = COALESCE(?, contract_start_date), contract_end_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [contractStartToPersist, contractEndDate, 'active', membershipId]
    );
    
    // Reset payment failures after successful payment (hybrid system)
    await db.resetGymMembershipPaymentFailures(membershipId);
    
    // Record status change if needed
    if (oldStatus !== 'active') {
      await db.recordSubscriptionStatusChange(membershipId, 'gym_membership', oldStatus, 'active', 'payment_succeeded', invoice.id);
    }

    // Record payment in DB so Payment History tab shows it immediately (nightly sync can reconcile with Stripe later)
    const userId = membership.user_id;
    const paymentId = invoice.payment_intent || `inv_${invoice.id}`;
    const amountCents = invoice.amount_paid || 0;
    const currency = invoice.currency || 'usd';
    let userEmail = null;
    try {
      const user = await db.getUserById(userId);
      userEmail = user?.email || null;
    } catch (e) {
      // ignore
    }
    try {
      await db.createPayment(userId, paymentId, amountCents, currency, 'gym_membership', 'succeeded', userEmail);
      console.log(`✅ Gym membership payment recorded for user ${userId}, amount ${amountCents / 100} ${currency}`);
    } catch (payErr) {
      // Duplicate (e.g. webhook retry) - ignore
      const isDuplicate = payErr.code === '23505' || payErr.code === 'SQLITE_CONSTRAINT' || (payErr.message && /unique|duplicate/i.test(payErr.message));
      if (!isDuplicate) {
        console.error('Error recording gym payment in DB:', payErr.message);
      }
    }

    // Late fee: if invoice was due more than grace period ago, charge late fee on the payment method that just paid
    const invoiceDueTimestamp = invoice.due_date || invoice.period_end || invoice.created;
    const dueDate = invoiceDueTimestamp ? new Date(invoiceDueTimestamp * 1000) : null;
    const gracePeriodMs = GYM_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    const paidAt = Date.now();
    if (dueDate && paymentMethodId && invoice.customer && (paidAt - dueDate.getTime()) > gracePeriodMs && GYM_LATE_FEE_DOLLARS > 0) {
      try {
        const lateFeeCents = Math.round(GYM_LATE_FEE_DOLLARS * 100);
        const lateFeePaymentIntent = await stripe.paymentIntents.create({
          amount: lateFeeCents,
          currency: invoice.currency || 'usd',
          customer: invoice.customer,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: 'Late fee - gym membership',
          metadata: { type: 'gym_late_fee', membershipId: membershipId.toString() }
        });
        if (lateFeePaymentIntent.status === 'succeeded') {
          await db.createPayment(userId, lateFeePaymentIntent.id, lateFeeCents, invoice.currency || 'usd', 'gym_membership_late_fee', 'succeeded', userEmail);
          console.log(`✅ Late fee $${GYM_LATE_FEE_DOLLARS} charged for membership ${membershipId} (user ${userId})`);
        }
      } catch (lateErr) {
        console.error('Error charging gym late fee:', lateErr.message);
      }
    }

    console.log(`✅ Gym membership invoice payment succeeded for membership ${membershipId}, contract extended to ${contractEndDate}`);
  } catch (error) {
    console.error('Error handling gym membership invoice payment succeeded:', error);
  }
}

// Handle gym membership invoice payment failed
async function handleGymMembershipInvoicePaymentFailed(invoice, db) {
  try {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) {
      return;
    }

    // Retrieve subscription to get metadata
    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
    const membershipId = parseInt(stripeSub.metadata?.membershipId);

    if (!membershipId) {
      console.error('Missing membershipId in gym membership subscription metadata');
      return;
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membershipId]
    );

    if (!membership) {
      console.log(`Gym membership ${membershipId} not found for failed invoice`);
      return;
    }

    console.log(`⚠️ Gym membership invoice payment failed for membership ${membershipId}, user ${membership.user_id}`);
    
    // Record payment failure (hybrid system)
    const currentFailureCount = (membership.payment_failure_count || 0) + 1;
    const lastFailureAt = new Date().toISOString();
    const GRACE_PERIOD_DAYS = 7;
    const MAX_FAILURE_COUNT = 3;
    
    if (currentFailureCount < MAX_FAILURE_COUNT) {
      // Set grace period
      const gracePeriodEndsAt = new Date();
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + GRACE_PERIOD_DAYS);
      
      const oldStatus = membership.status;
      await db.recordGymMembershipPaymentFailure(
        membershipId,
        currentFailureCount,
        lastFailureAt,
        gracePeriodEndsAt.toISOString()
      );
      
      // Record status change if entering grace period
      if (oldStatus !== 'grace_period') {
        await db.recordSubscriptionStatusChange(membershipId, 'gym_membership', oldStatus, 'grace_period', 'payment_failed', invoice.id);
      }
      
      console.log(`  ⚠️  Payment failure ${currentFailureCount}/${MAX_FAILURE_COUNT}. Grace period until ${gracePeriodEndsAt.toISOString().split('T')[0]}`);
    } else {
      // Too many failures - suspend membership
      const oldStatus = membership.status;
      await db.updateGymMembershipStatus(membershipId, 'paused', oldStatus, 'max_failures_reached', invoice.id);
      
      console.log(`  🛑 Maximum failures reached. Membership suspended.`);
    }
  } catch (error) {
    console.error('Error handling gym membership invoice payment failed:', error);
  }
}

module.exports = createWebhookRouter;

