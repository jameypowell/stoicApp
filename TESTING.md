# Testing Stripe Payments from Command Line

## Quick Test Script

Run the interactive test script:
```bash
./test-payment.sh
```

## Manual Testing Steps

### 1. Start Your Server
```bash
npm run dev
```

### 2. Register a User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

**Response:**
```json
{
  "message": "User created successfully",
  "user": {"id": 1, "email": "test@example.com"},
  "token": "eyJhbGc..."
}
```

**Save the token!** Let's call it `TOKEN`:
```bash
TOKEN="eyJhbGc..."  # Paste your token here
```

### 3. Login (if user already exists)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### 4. Create Payment Intent
```bash
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"daily"}'
```

**Response:**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "amount": 299,
  "tier": "daily"
}
```

**Save the payment intent ID:**
```bash
PAYMENT_INTENT_ID="pi_xxx..."  # Extract from response
```

### 5. Test Payment with Stripe CLI

#### Option A: Confirm Payment Intent (Recommended)
```bash
# Install Stripe CLI first: brew install stripe/stripe-cli/stripe
stripe payment_intents confirm pi_xxx --payment-method=pm_card_visa
```

Where `pi_xxx` is the payment intent ID from step 4.

#### Option B: Use Test Card Directly
```bash
stripe payment_intents confirm pi_xxx \
  --payment-method=pm_card_visa \
  --return-url=https://example.com/return
```

### 6. Verify Subscription Activated

The webhook should automatically activate your subscription. Check your subscription:
```bash
curl http://localhost:3000/api/subscriptions/me \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Manual Payment Confirmation (Alternative)

If webhook isn't working, manually confirm:
```bash
curl -X POST http://localhost:3000/api/payments/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "paymentIntentId": "pi_xxx",
    "tier": "daily"
  }'
```

## Complete Test Flow (One Command)

```bash
# Register and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test'$(date +%s)'@example.com","password":"test123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Create payment intent
INTENT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"daily"}')

# Extract payment intent ID
PI_ID=$(echo $INTENT_RESPONSE | grep -o '"paymentIntentId":"[^"]*' | cut -d'"' -f4)

# Confirm with Stripe CLI (if installed)
stripe payment_intents confirm $PI_ID --payment-method=pm_card_visa

# Check subscription
curl http://localhost:3000/api/subscriptions/me \
  -H "Authorization: Bearer $TOKEN"
```

## Stripe Test Cards

You can use these test cards with Stripe CLI:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0025 0000 3155`

Use any:
- Expiry: `12/34`
- CVC: `123`
- ZIP: `12345`

## Using Stripe CLI Payment Methods

```bash
# Create a test payment method
stripe payment_methods create \
  --type=card \
  --card[number]=4242 \
  --card[exp_month]=12 \
  --card[exp_year]=34 \
  --card[cvc]=123

# Attach to payment intent
stripe payment_intents confirm pi_xxx \
  --payment-method=pm_xxx
```

## Testing Webhook Locally

1. **Start webhook forwarding** (in a separate terminal):
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

2. **When you confirm a payment**, the webhook will automatically:
   - Verify the payment signature
   - Activate the subscription
   - Update payment status

## Troubleshooting

**"Invalid token"**: Make sure you copied the full JWT token

**"Payment intent not found"**: Check the payment intent ID is correct

**"Webhook not triggered"**: 
- Make sure Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Check webhook secret matches `.env` file

**"Subscription not activated"**:
- Check webhook logs: Look for errors in server console
- Manually confirm payment via `/api/payments/confirm` endpoint

## Testing Different Tiers

```bash
# Daily ($2.99)
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"daily"}'

# Weekly ($9.99)
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"weekly"}'

# Monthly ($29.99)
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"monthly"}'
```

