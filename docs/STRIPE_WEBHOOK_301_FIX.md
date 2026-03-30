# Fix Stripe Webhook 301 (Redirect) – app.stoic-fit.com

Stripe disabled your webhook because **5 requests got HTTP 301** instead of 200–299. Stripe does **not** follow redirects; the endpoint must respond with 2xx directly.

## What’s going on

- **Failing URL:** `https://app.stoic-fit.com/api/webhooks/stripe`
- **Symptom:** Something in front of your app is responding with **301 Moved Permanently** (redirect). Common causes:
  1. **HTTP → HTTPS redirect** – Stripe is hitting `http://` and your server/CDN redirects to `https://` with 301.
  2. **Wrong URL in Stripe** – Endpoint was added as `http://` or with a typo, so Stripe sends to the wrong URL and gets a redirect.
  3. **Host/path redirect** – e.g. www → non-www, or trailing slash redirect.

Your Express app does **not** redirect this path; the 301 is from your **hosting/proxy** (load balancer, CDN, or platform).

---

## What to do

### 1. Fix the endpoint URL in Stripe (most likely fix)

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Find the endpoint for **app.stoic-fit.com** (it may be **disabled**).
3. Check the **Endpoint URL**:
   - It **must** be exactly:  
     `https://app.stoic-fit.com/api/webhooks/stripe`
   - **Must use `https`** (not `http`).
   - No trailing slash: **not** `.../stripe/`.
   - Host must be **app.stoic-fit.com** (not www, not a different subdomain).
4. If the URL was wrong (e.g. `http://` or different path/host):
   - Either **edit** the endpoint URL to the correct one above, or
   - **Add a new** endpoint with the correct URL and remove the old one.
5. **Re-enable** the endpoint (Stripe disables it after repeated failures): open the endpoint → click **Enable**.

### 2. Confirm infrastructure doesn’t redirect this path

Wherever **app.stoic-fit.com** is hosted (e.g. AWS ALB, CloudFront, Vercel, Nginx):

- Ensure **HTTPS** is the only public entry (or that Stripe is configured to use HTTPS, per step 1).
- If you have “redirect HTTP → HTTPS” with **301**, that’s fine as long as Stripe **never** hits HTTP. So again: endpoint URL in Stripe must be `https://...`.
- Make sure there is **no** redirect rule that applies to  
  `POST https://app.stoic-fit.com/api/webhooks/stripe`  
  (e.g. no “redirect to new location” for that path or host).

### 3. Verify the endpoint responds 200

After fixing the URL and re-enabling:

- From Stripe Dashboard: open the endpoint → **Send test webhook** (e.g. `invoice.payment_succeeded` or `payment_intent.succeeded`).
- Or from your project (if prod URL is set):  
  `npm run test:production`  
  (includes a webhook test that expects 400 for invalid signature; 400 is OK, 301/302/404 are not).

If the test returns **200** (or 400 for invalid body/signature), Stripe will consider delivery successful. No 301 = problem fixed.

---

## Summary

| Step | Action |
|------|--------|
| 1 | In Stripe, set endpoint URL to **https://app.stoic-fit.com/api/webhooks/stripe** (https, no trailing slash). |
| 2 | Re-enable the webhook endpoint in Stripe. |
| 3 | Ensure no proxy/load balancer redirects **POST** requests to this URL (Stripe must get 2xx from this URL, not 301). |
| 4 | Send a test webhook and confirm you get 200 (or 400 for bad payload), not 301. |

After this, Stripe will resume sending events and the endpoint will stay enabled.
