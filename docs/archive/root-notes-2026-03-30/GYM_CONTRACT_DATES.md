# Gym membership contract dates (`contract_start_date` / `contract_end_date`)

## Policy (self-serve signup)

- **Set only when money succeeds** — from the successful **Charge** (`latest_charge.created` when available), converted to **America/Denver** calendar date for `contract_start_date`, plus **30 calendar days** for the current billing period end (`contract_end_date`).
- **Not** set when the user starts signup, fills the profile, or while the PaymentIntent is unpaid / failed.
- **Implementation**:
  - `POST /gym-memberships/create` inserts `NULL` for both contract columns until payment.
  - `POST /gym-memberships/confirm-payment` and `payment_intent.succeeded` (metadata `type: gym_membership`) fill them via `lib/gym-contract-dates.js` (`getContractStartEndYmdFromSucceededPaymentIntent`, `computeGymContractEndYmdFromStartYmd` for **30 calendar days** from start in America/Denver).

## Stripe subscription (invoice) gym members

- `invoice.payment_succeeded` / related handlers sync `contract_start_date` / `contract_end_date` from Stripe `current_period_start` / `current_period_end` after successful invoice payment.
- If Stripe’s UTC date slices yield a **29-calendar-day** span between those two dates, the handler **normalizes** `contract_end_date` to **30 calendar days after** `contract_start_date` (Mountain) so the admin UI matches app policy (same as PaymentIntent flow).

## Other / renewals

- Renewals use PaymentIntents with metadata `type: gym_membership_renewal` (not `gym_membership`) and extend `contract_end_date` from existing logic — they do not reset `contract_start_date`.

## Admin / migration

- Imported members may still get dates from admin `membership_start_date` on confirm — separate from self-serve.

## Existing members (wrong dates before the code fix)

On startup, Postgres/SQLite run an **idempotent** update: any `gym_memberships` row (except `free_trial`) where `contract_end_date − contract_start_date` is exactly **29** calendar days is set so the period is **30** calendar days (end = start plus 30 days), fixing historical off-by-one rows (including cases like Mar 9 → Apr 7).

For a **single** member who still needs a manual anchor from Stripe or a known start date:

1. **Script** (needs production DB + `STRIPE_SECRET_KEY` in `.env`):

   ```bash
   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --dry-run
   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --apply
   ```

   If Stripe’s first succeeded `gym_membership` charge doesn’t match the real start day, force the calendar start:

   ```bash
   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --start-date 2026-03-09 --apply
   ```

2. **Admin API** (after deploy): `POST /api/admin/gym-memberships/reanchor-contract-from-stripe` with JSON `{ "email": "...", "dryRun": true }` then `{ "email": "...", "startDate": "2026-03-09" }` (optional).
