# Fix Jake Fotu's Gym Membership - Browser Console Method

## Quick Fix (30 seconds)

1. **Go to production**: https://app.stoic-fit.com
2. **Log in as admin** (jameypowell@gmail.com)
3. **Open browser console** (F12 or Cmd+Option+I)
4. **Paste and run this code**:

```javascript
(function() {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('❌ Please log in first');
    return;
  }
  
  fetch('/api/admin/gym-memberships/fix-jake-fotu', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  })
  .then(r => r.json())
  .then(data => {
    console.log('Result:', data);
    if (data.success) {
      alert('✅ Jake Fotu\'s gym membership has been fixed!\n\n' +
            'Subscription ID: ' + data.subscriptionId + '\n' +
            'Next billing date: ' + data.nextBillingDate + '\n' +
            'Membership type: ' + data.membershipType + '\n' +
            'Monthly price: $' + data.monthlyPrice);
      console.log('Full response:', data);
    } else {
      alert('❌ Error: ' + (data.error || 'Unknown error'));
      console.error('Error:', data);
    }
  })
  .catch(err => {
    console.error('Error:', err);
    alert('❌ Error: ' + err.message);
  });
})();
```

## What This Will Do

The endpoint will:
1. ✅ Find Jake's customer in Stripe (`cus_Tn4vCyVuETJUTe`)
2. ✅ Find his user and membership records in the database
3. ✅ Get his payment method
4. ✅ Create a subscription with `billing_cycle_anchor` set to 30 days from today
5. ✅ Update the database with subscription IDs
6. ✅ **NO CHARGE** - Customer was already charged, next billing is in 30 days

## Expected Result

- Subscription created in Stripe
- Subscription ID saved in database
- Next billing date: 30 days from today
- No immediate charge
- Subscription status: `active`

