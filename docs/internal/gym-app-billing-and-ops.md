# Gym and app billing (internal)

## How billing dates work

- **Calendar month in `America/Denver`**, not “add 30 days.” The same calendar day each month is the anchor when possible; **last-day-of-month** anchors roll to the last day of shorter months (e.g. Jan 31 → Feb 28/29 → Mar 31).
- **Gym contract anchor:** After the first successful gym charge, persist and rely on **`contract_start_date`** (and derived **`contract_end_date`**) for the next period. Renewal and admin “charge now” paths use the shared helpers in `lib/gym-contract-dates.js`.
- **App subscription next end:** Denver calendar rules apply where `payments` / subscription end logic uses the same calendar-month model (see `payments.js` and payload builders).

### Admin “Add member” (legacy migration)

- Enter each member’s **next due date from the old system**. That **calendar day in `America/Denver`** is their **first Stoic pay date** and is stored as **`contract_start_date`**. That is also the **start of the 12-month commitment** — there is no extra field; **`contract_months = 12`** defines the term from that date.
- Initially **`contract_end_date`** is the same calendar day so the nightly job uses it as the **first billing due**; after each successful payment, **`contract_end_date`** advances by Denver calendar-month rules for ongoing monthly billing.
- The member must **`contract_terms_acknowledged`** on `POST /gym-memberships/confirm-migration` before the row is created (`routes.js`).

## Production checks (Stripe and refunds)

Do these after deploys or webhook URL changes.

1. **Stripe API check (from repo):** `npm run verify:stripe-refund-webhook` — lists webhook endpoints for the key in `.env` and confirms **`charge.refunded`** (or `*`) is enabled.
2. **Stripe Dashboard → Developers → Webhooks** (live endpoint): confirm recent successful deliveries for at least:
   - `payment_intent.succeeded`
   - `invoice.paid` / `invoice.payment_succeeded` (if you use invoices for gym)
   - `customer.subscription.deleted` (gym Stripe subscription cleanup when applicable)
   - **`charge.refunded`** — must hit the app so `payments` rows update; admin transaction lists hide refunded / partially refunded rows.
3. **Refund smoke test (staging or low-risk live):** Issue a small test refund in Stripe; verify the corresponding **`payments.status`** matches Stripe and the row **does not appear** in admin “upcoming transactions” style views.
4. **Logs:** On refund, if zero DB rows update, the app should log a warning (see `webhooks.js` around `charge.refunded`) — investigate idempotency / `stripe_payment_intent_id` linkage.

## Operational scripts

| Command | Purpose |
|--------|---------|
| `npm run renewal:dry-run` | Runs `scripts/nightly-renewal-job.js` with `RENEWAL_DRY_RUN=true` — no Stripe writes; use before/after deploys when renewal logic changes. Requires env (DB, Stripe) like production. |
| `npm run audit:gym-calendar-drift` | Read-only JSON lines: calendar-month next due vs legacy +30. Options: `--outliers-only`, `--limit N`. Requires production-like DB. |
| `npm run audit:gym-calendar-drift:monthly` | Same as full audit with **`--outliers-only`** (good default for scheduled jobs). |
| `npm run audit:gym-repeat-renewals` | Guardrail for unexpected repeat gym charges in the last 30 days using **succeeded-only** payments. Exits non-zero if suspicious same-day/consecutive-day patterns are present. |
| `npm run audit:gym-repeat-renewals:strict` | Same guardrail but includes refunded/partially_refunded rows to catch historical incidents that were refunded later. |
| `npm run verify:stripe-refund-webhook` | Confirms Stripe webhook endpoints include **`charge.refunded`** (uses `STRIPE_SECRET_KEY`). |
| `npm run verify:refunds-in-db` | Compares recent Stripe **`charge.refunded`** events to **`payments`** rows (needs `DATABASE_URL` or `DB_*`). Exit non-zero if rows missing or status not `refunded` / `partially_refunded`. |
| `npm run backfill:payment-refund-status` | Dry-run: for recent **`charge.refunded`** PIs, set DB **`payments.status`** from Stripe if still wrong. Add **`--execute`** to apply; optional **`--event-limit N`**. |

### Suggested schedules (production host / job runner)

Adapt paths and env loading to your deployment (ECS, systemd, etc.).

```bash
# First of month, outliers only (low noise)
0 3 1 * * cd /path/to/Stoic\ Shop && set -a && source /path/to/.env && set +a && npm run audit:gym-calendar-drift:monthly >> /var/log/stoic-gym-calendar-audit.log 2>&1

# Daily safety check for accidental repeat gym renewals (succeeded charges only)
15 3 * * * cd /path/to/Stoic\ Shop && set -a && source /path/to/.env && set +a && npm run audit:gym-repeat-renewals >> /var/log/stoic-gym-repeat-renewals.log 2>&1
```

Before risky releases:

```bash
RENEWAL_DRY_RUN=true node scripts/nightly-renewal-job.js
# or: npm run renewal:dry-run
```

## Related code (quick navigation)

- `lib/gym-contract-dates.js` — Denver YMD helpers, end-of-month behavior, `extractYmdFromDbValue` (node-pg `Date` values).
- `scripts/nightly-renewal-job.js` — Renewals, preflight, metadata `userId` / `user_id`.
- `webhooks.js` — Refund handling and gym PI success routes.
- `database.js` — Gym due queries use Denver “today”; admin transaction queries exclude refunded states.
