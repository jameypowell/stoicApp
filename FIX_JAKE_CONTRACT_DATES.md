# Fix Jake Fotu's Contract Dates - Browser Console Method

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
  
  fetch('/api/admin/gym-memberships/fix-jake-contract-dates', {
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
      alert('✅ Jake Fotu\'s contract dates have been fixed!\n\n' +
            'Old Dates:\n' +
            '  Start: ' + data.oldDates.contract_start_date + '\n' +
            '  End: ' + data.oldDates.contract_end_date + '\n\n' +
            'New Dates:\n' +
            '  Start: ' + data.newDates.contract_start_date + '\n' +
            '  End: ' + data.newDates.contract_end_date);
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
1. ✅ Find Jake's user and membership records
2. ✅ Update `contract_start_date` to `2026-01-14` (payment date)
3. ✅ Update `contract_end_date` to `2026-02-13` (30 days later)
4. ✅ Return the old and new dates for verification

## Expected Result

- Contract Start Date: 2026-01-14 (Jan 14, 2026)
- Contract End Date: 2026-02-13 (Feb 13, 2026)
- Billing Period: 30 days (monthly)
- Frontend will now display correct dates

