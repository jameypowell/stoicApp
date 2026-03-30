# Payment Flow Debugging Guide

## Common Issues and Fixes

### Issue: "Network error" when clicking payment button

**Possible Causes:**

1. **Stripe not initialized**
   - Check browser console for "Stripe initialized successfully"
   - If missing, check `/api/stripe-key` endpoint returns key
   - Verify `STRIPE_PUBLISHABLE_KEY` is set in `.env`

2. **Authentication token missing**
   - Check that user is logged in
   - Verify token exists in localStorage
   - Check browser console for 401 errors

3. **CORS issues**
   - Server should already have CORS enabled
   - Check browser console for CORS errors
   - Verify API requests are going to same origin

4. **Server not running**
   - Check server is running: `npm start`
   - Verify health endpoint works: `curl http://localhost:3000/health`

## Debugging Steps

### 1. Check Browser Console
Open browser DevTools (F12) and check Console tab for errors:
- Look for red error messages
- Check Network tab for failed requests
- Verify request URLs and status codes

### 2. Verify Stripe Key
```bash
curl http://localhost:3000/api/stripe-key
```
Should return: `{"publishableKey":"pk_test_..."}`

### 3. Test Payment Intent Endpoint
```bash
# First, get a token by logging in
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Then test payment intent
curl -X POST http://localhost:3000/api/payments/create-intent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"tier":"daily"}'
```

### 4. Check Server Logs
Look at your server console output for:
- Error messages
- Failed requests
- Stripe API errors

## Recent Fixes Applied

✅ **Fixed Stripe Elements initialization**
- Now properly initializes with client secret
- Clears existing elements before creating new ones

✅ **Improved error handling**
- Better error messages
- Check for Stripe initialization before use
- Proper JSON parsing with error handling

✅ **Fixed response structure**
- Backend now returns `paymentIntentId` in response
- Frontend properly handles `clientSecret`

✅ **Added logging**
- Console logs for debugging
- Better error messages to user

## Still Having Issues?

1. **Clear browser cache** and refresh
2. **Check `.env` file** has all required keys
3. **Restart server** after `.env` changes
4. **Test with curl** to isolate frontend vs backend issues
5. **Check browser console** for detailed error messages

