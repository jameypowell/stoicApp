# How to Get Stripe Price IDs

You provided **Product IDs**, but for recurring subscriptions, I need **Price IDs**.

## Quick Steps:

1. Go to: https://dashboard.stripe.com/products
2. Click on each product (Daily, Weekly, Monthly)
3. Under each product, you'll see **"Pricing"** section
4. Each price will show a **Price ID** (starts with `price_...`)
5. Copy the Price ID for the recurring monthly price

## Example:

For your **Daily Subscription** product (`prod_TRpudq0ZYlnNnP`):
- Click on it
- Look for the price that says "Monthly" or "Recurring"
- Copy the Price ID (looks like `price_1ABC...`)

Do this for all three products and send me the Price IDs.

---

**Note:** If you haven't created prices yet:
1. Click on the product
2. Click **"+ Add another price"**
3. Set:
   - **Price**: $7.00 (or $12.00, $18.00)
   - **Billing period**: Monthly
   - **Recurring**: Yes
4. Save and copy the Price ID






