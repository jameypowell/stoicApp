# Deploy and Run JD Nielson Fix on Production

## Quick Fix Options (Fastest to Slowest)

### Option 1: Browser Console (30 seconds) ⚡ FASTEST

1. Go to https://stoic-fit.com (or your production URL)
2. Log in as admin
3. Open browser console (F12)
4. Paste and run:

```javascript
const token = localStorage.getItem('token');
fetch('/api/admin/subscriptions/sync', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    customerId: 'cus_TTQrfuTZCoc0Yy'
  })
})
.then(r => r.json())
.then(data => {
  console.log('✅ Result:', data);
  if (data.error) {
    console.error('❌ Error:', data.error);
  } else {
    alert('✅ JD Nielson\'s account has been fixed!');
  }
})
.catch(err => console.error('❌ Error:', err));
```

### Option 2: AWS ECS Exec (2 minutes)

If you have AWS CLI access:

```bash
# 1. Get your cluster name and task ID
CLUSTER_NAME="your-cluster-name"  # Replace with actual cluster name
SERVICE_NAME="stoic-shop"  # Replace with actual service name

# 2. Get the running task ID
TASK_ID=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query 'taskArns[0]' --output text | cut -d'/' -f3)

# 3. Copy the fix script to the container
aws ecs execute-command \
  --cluster $CLUSTER_NAME \
  --task $TASK_ID \
  --container stoic-shop \
  --interactive \
  --command "cat > /tmp/fix-jd-production.js" < fix-jd-production.js

# 4. Run the fix script
aws ecs execute-command \
  --cluster $CLUSTER_NAME \
  --task $TASK_ID \
  --container stoic-shop \
  --interactive \
  --command "node /tmp/fix-jd-production.js"
```

### Option 3: Deploy Script with Code (5 minutes)

1. **Copy fix-jd-production.js to your production codebase**
2. **Rebuild and deploy Docker image** (or just copy the file if you have file access)
3. **Run via ECS exec**:

```bash
aws ecs execute-command \
  --cluster <cluster> \
  --task <task-id> \
  --container <container> \
  --interactive \
  --command "node /app/fix-jd-production.js"
```

### Option 4: SSH to Production Server (if applicable)

If you have SSH access:

```bash
# 1. Copy script to server
scp fix-jd-production.js user@production-server:/path/to/app/

# 2. SSH and run
ssh user@production-server
cd /path/to/app
node fix-jd-production.js
```

## What the Script Does

1. ✅ Connects to production database
2. ✅ Finds JD Nielson's user account
3. ✅ Fetches his active subscription from Stripe
4. ✅ Syncs subscription status to database
5. ✅ Verifies the fix was successful

## Verification

After running the fix, verify:

1. JD can log in successfully
2. His subscription shows as "Active"
3. He has access to tier_four features

## Troubleshooting

**If script fails with "User not found":**
- Check that JD's email is correct: jbnielson16@gmail.com
- Check that customer ID is correct: cus_TTQrfuTZCoc0Yy

**If script fails with "No active subscriptions":**
- Check Stripe dashboard for customer cus_TTQrfuTZCoc0Yy
- Ensure there's an active subscription in Stripe

**If database connection fails:**
- Ensure production environment variables are set correctly
- Check that DB_HOST, DB_USER, DB_NAME, DB_PASSWORD are configured

## Recommended: Use Option 1 (Browser Console)

The browser console method is the fastest and doesn't require AWS CLI or SSH access. Just log in as admin and run the JavaScript code.


