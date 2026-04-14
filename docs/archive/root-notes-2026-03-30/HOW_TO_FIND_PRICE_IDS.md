# How to Find Stripe Price IDs

## The Issue
You're providing **Product IDs** (`prod_...`), but I need **Price IDs** (`price_...`).

Each Product can have multiple Prices (e.g., monthly, yearly, one-time). For recurring subscriptions, I need the specific **Price ID** for the monthly recurring price.

## Step-by-Step Instructions

### For Each Product (Daily, Weekly, Monthly):

1. **Go to Stripe Dashboard**: https://dashboard.stripe.com/products

2. **Click on the Product** (e.g., "Daily Subscription" - `prod_TRpudq0ZYlnNnP`)

3. **Look for the "Pricing" section** on the product page

4. **Find the recurring monthly price** - You should see something like:
   ```
   $7.00 / month (recurring)
   Price ID: price_1ABC123xyz...
   ```

5. **Copy the Price ID** (starts with `price_...`)

### If You Don't See a Price:

If the product doesn't have a price yet, you need to create one:

1. **On the product page**, click **"+ Add another price"** or **"Add price"**

2. **Fill in:**
   - **Price**: $7.00 (or $12.00, $18.00)
   - **Billing period**: Monthly
   - **Recurring**: Yes (toggle on)
   - **Currency**: USD

3. **Click "Save"** or "Add price"

4. **Copy the Price ID** that appears (starts with `price_...`)

## What I Need

Send me the **Price IDs** (not Product IDs):

```
STRIPE_PRICE_DAILY=price_1ABC...
STRIPE_PRICE_WEEKLY=price_1DEF...
STRIPE_PRICE_MONTHLY=price_1GHI...
```

## Visual Guide

When you click on a product, you should see:

```
Product: Daily Subscription
Product ID: prod_TRpudq0ZYlnNnP

Pricing:
┌─────────────────────────────────┐
│ $7.00 / month (recurring)       │
│ Price ID: price_1ABC123xyz...   │ ← THIS IS WHAT I NEED
└─────────────────────────────────┘
```

The Price ID is usually shown in small text below or next to the price amount.






