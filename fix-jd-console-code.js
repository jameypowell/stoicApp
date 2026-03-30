// Fix JD Nielson's Account - Browser Console Code
// Paste this entire block into the browser console

(function() {
  const adminToken = localStorage.getItem('token');
  
  if (!adminToken) {
    console.error('❌ No token found. Make sure you are logged in as admin.');
    alert('❌ Not logged in. Please log in as admin first.');
    return;
  }
  
  console.log('🚨 Fixing JD Nielson\'s account...');
  console.log('Customer ID: cus_TTQrfuTZCoc0Yy');
  
  fetch('/api/admin/subscriptions/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      customerId: 'cus_TTQrfuTZCoc0Yy'
    })
  })
  .then(r => r.json())
  .then(data => {
    console.log('✅ Result:', data);
    if (data.success) {
      alert('✅ JD Nielson\'s account has been fixed!\n\nStatus: ' + data.subscription.status + '\nTier: ' + data.subscription.tier);
      console.log('Subscription details:', data.subscription);
    } else {
      alert('❌ Error: ' + (data.error || 'Unknown error'));
      console.error('Error details:', data);
    }
  })
  .catch(err => {
    console.error('❌ Error:', err);
    alert('❌ Error: ' + err.message);
  });
})();


