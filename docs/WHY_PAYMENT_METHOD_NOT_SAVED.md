# Why a gym member can have "no payment method" in Stripe after paying

## How we’re supposed to save the payment method

For **gym members with a Stripe subscription**, the card is saved only when our **webhooks** run after a successful charge:

1. **`invoice.payment_succeeded`**  
   We call `handleGymMembershipInvoicePaymentSucceeded`, which:
   - Reads `invoice.payment_intent` and gets the PaymentIntent
   - Gets `payment_method` from that PaymentIntent
   - Calls `savePaymentMethodToCustomer(customerId, paymentMethodId)` (attach + set default)
   - Calls `db.updateGymMembershipPaymentMethod` so our DB has it too

2. **`payment_intent.succeeded`** (when the PaymentIntent is for an invoice)  
   We also call `savePaymentMethodToCustomer` there for subscription invoice payments.

So the payment method is **only** persisted to the customer (and DB) when at least one of these webhooks is received and runs successfully.

## Why it didn’t work for fotujacob@gmail.com (Jake)

The most likely reason is that **when his last payment succeeded, our webhooks never ran or failed**:

- **Stripe API / delivery issues**  
  If Stripe or our server had problems at the time (e.g. the “Stripe API issue” you mentioned), the webhook request can:
  - Time out
  - Get a 5xx from our app
  - Not be delivered at all  
  Stripe retries, but if we keep failing, the event can eventually be marked as failed. In that case the charge succeeds in Stripe, but we never execute the code that attaches the payment method and sets it as default.

- **Result**  
  The card was **used** for the invoice payment (so Stripe has a successful charge and a PaymentIntent with a `payment_method`), but we never ran:
  - `savePaymentMethodToCustomer`, so the payment method was never attached/set as default on the customer.
  - `updateGymMembershipPaymentMethod`, so our DB never got the payment method id either.

So in Stripe it looks like “no payment method saved” for that customer even though a payment with that card succeeded.

## Other possible (less likely) causes

- **Subscription created without a valid default**  
  If the subscription was created with a `default_payment_method` that was later removed, expired, or detached, and the next invoice was paid via a different flow where our webhook didn’t run, we’d never save that new card.
- **Wrong customer**  
  If the payment was somehow associated with a different Stripe customer, we’d update the wrong (or no) record. Unlikely if the customer id is correct everywhere.

## What we can do going forward

1. **Recover from last invoice (admin)**  
   Use an admin-only “sync payment method from last successful invoice” action that:
   - Finds the customer’s last paid subscription invoice
   - Gets the PaymentIntent → `payment_method`
   - Calls the same attach + set-default + DB update logic  
   That way we can fix Jake (and any similar case) without waiting for the next payment.

2. **Harden webhooks**  
   - Return 200 quickly and process async where possible to avoid timeouts.
   - Make handler idempotent so retries are safe.
   - Monitor webhook failures in Stripe Dashboard and fix 5xx/timeouts.

3. **Optional: double-save on confirm**  
   For “Pay Now” / one-off flows that use a subscription’s invoice PaymentIntent, we could also save the payment method when the frontend calls our “record payment” endpoint (in addition to the webhook), so we have a second chance if the webhook fails.
