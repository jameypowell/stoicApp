# Complete User Flow Test Guide

## Test the Full Workflow

Now that everything is working, let's test the complete user journey:

### Step 1: Sync a Workout

```bash
# Get a token (register as admin/user)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Sync a workout
curl -X POST http://localhost:3000/api/admin/workouts/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4","workoutDate":"2024-11-05"}' \
  | python3 -m json.tool
```

### Step 2: Register a New User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"user123"}' \
  | python3 -m json.tool
```

Save the token from the response.

### Step 3: Create Payment Intent

```bash
TOKEN="YOUR_USER_TOKEN_HERE"

curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"daily"}' \
  | python3 -m json.tool
```

### Step 4: Confirm Payment

```bash
# Get payment intent ID from step 3
PAYMENT_INTENT_ID="pi_xxx"

curl -X POST http://localhost:3000/api/payments/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"paymentIntentId\":\"$PAYMENT_INTENT_ID\",\"tier\":\"daily\"}" \
  | python3 -m json.tool
```

### Step 5: Access Workout

```bash
curl http://localhost:3000/api/workouts/2024-11-05 \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

## What You'll See

- **Workout content** extracted from Google Slides
- **Subscription access** control working
- **Payment processing** complete
- **User can view workouts** they've paid for

## Next Steps After Testing

Once you've verified the flow works:

1. **Build Frontend** - Create user interface
2. **Deploy to AWS** - Set up production environment
3. **Automate Sync** - Set up daily workout sync
4. **Add Features** - Email notifications, admin dashboard, etc.

## Quick Test Script

Want a simpler way? I can create a script that runs all these steps automatically!

