# How to Run the Exercise Fix

## Quick Start

The fix has been deployed to production. To execute it, you need to call the API endpoint with admin authentication.

## Method 1: Using the Execute Script (Recommended)

```bash
ADMIN_EMAIL=your@admin.email ADMIN_PASSWORD=yourpassword ./scripts/execute_fix.sh
```

## Method 2: Manual API Call

1. **Get an admin token:**
   ```bash
   TOKEN=$(curl -s -X POST https://stoic-fit.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"your@admin.email","password":"yourpassword"}' \
     | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
   ```

2. **Run the fix:**
   ```bash
   curl -X POST https://stoic-fit.com/api/admin/workouts/fix-exercises \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     | python3 -m json.tool
   ```

## What Gets Fixed

- **Banded Pull Aparts** → Equipment: Super Band only
- **Dumbbell Shoulder Fly** → Shoulder Fly (Equipment: Dumbbells)  
- **Primary block title** → "Primary Exercises (Shoulders)"
- **Alternating Dumbbell Overhead Should Press** → Alternating Overhead Shoulder Press (Equipment: Dumbbell)
- **Alternating Dumbbell Front Raises** → Alternating Front Raises (Equipment: Dumbbell)
- **Alternating Dumbbell Lateral Raises (Band)** → Alternating Lateral Raises (Equipment: Dumbbells)
- **Alternating Dumbbell Curls (Bodyweight)** → Alternating Curls (Equipment: Dumbbell)
- **Dumbbell Single Arm Kickbacks (PVC Pipes)** → Single Arm Kickbacks (Equipment: Dumbbell)

## Expected Response

```json
{
  "success": true,
  "message": "Applied X fixes to Y workout(s)",
  "workoutsFixed": 2,
  "totalFixes": 16,
  "log": [
    "Found 2 workout(s) that need fixes",
    "✅ Exercise Name → New Name (Equipment)",
    ...
  ]
}
```

## Notes

- The fix is idempotent - safe to run multiple times
- All changes are logged for audit
- Only admin users can run this fix



















