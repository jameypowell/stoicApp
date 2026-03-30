# Authentication Pattern Guide

## Critical Rule: Always Use `req.userId` After `authenticateToken`

### The Problem

The `authenticateToken` middleware sets `req.userId` (NOT `req.user.id`). Using `req.user.id` will cause:
- `TypeError: Cannot read properties of undefined (reading 'id')`
- 500 Internal Server Error
- Broken functionality

### Correct Pattern

```javascript
// ✅ CORRECT - Use req.userId
router.get('/some-route', authenticateToken, async (req, res) => {
  const userId = req.userId;
  // ... rest of code
});

// ❌ WRONG - req.user does not exist
router.get('/some-route', authenticateToken, async (req, res) => {
  const userId = req.user.id; // This will fail!
});
```

### What `authenticateToken` Does

```javascript
// From auth.js
function authenticateToken(req, res, next) {
  // ... token validation ...
  req.userId = decoded.userId;  // Sets req.userId
  next();
}
```

**Note:** The middleware sets `req.userId` directly. There is no `req.user` object created.

### How to Prevent This Mistake

1. **Always use `req.userId`** after `authenticateToken` middleware
2. **Never assume `req.user` exists** - it doesn't unless explicitly set
3. **Search before adding new routes**: Use `grep -r "req\.user\.id" routes.js` to find any incorrect patterns
4. **Test routes immediately** after creation to catch this error early

### Routes Fixed

The following routes had this bug and were fixed:
- `/api/pr-logs` - PR logs routes (GET, POST, DELETE, POST /bulk)
- `/api/gym-memberships/create` - Create gym membership
- `/api/gym-memberships/create-payment-intent` - Create payment intent
- `/api/gym-memberships/confirm-payment` - Confirm payment

### Verification Checklist

Before deploying new routes with `authenticateToken`:
- [ ] Route uses `req.userId` (not `req.user.id`)
- [ ] Verified with `grep -r "req\.user\.id" routes.js` shows no matches
- [ ] Route tested locally to confirm no runtime errors
- [ ] Error handling in place for missing userId
