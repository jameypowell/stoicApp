/**
 * Push the functional fitness workout to production by calling the admin bulk API.
 * Uses ADMIN_TOKEN and PRODUCTION_URL (or API_URL) from .env.
 *
 * Usage: node scripts/push_workout_to_production_via_api.js [date]
 *   No date = tomorrow. Date = YYYY-MM-DD.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const WORKOUT_CONTENT = `MONDAY, March 9th

Warm Up – 5 minutes
(40 sec each / continuous rotation)
1. 40 sec Jog
2. Mini Band Lateral Walks
3. Toy Soldiers
4. Hamstring Scoops
5. PVC Overhead Squats
6. Reverse Lunges
7. Air Squats

Core Conditioning – 5 minutes:
40 sec work / 20 sec transition
1. Hollow Hold
2. DB Farmer Carry March
3. Mini Band Deadbugs
4. Plank Shoulder Taps
5. Hollow Hold
repeat sequence

Main Circuit-Lower Body/Squat Dominant 35 min:
1. Barbell Front Squat 3–4 sets x4–6 reps Blue pill (Hypertrophy 70%-85% of 1RM: 45 sec rest) 1–2 sets x10–12 reps Green pill (Conditioning 30%-50% of 1RM: 20 sec rest)
2. DB Step Ups 3–4 sets x4–6 reps ea Blue pill (Hypertrophy 70%-85% of 1RM: 45 sec rest) 1–2 sets x10–12 reps alt Green pill (Conditioning 30%-50% of 1RM: 20 sec rest)
3. DB Walking Lunges x16–20 reps alt
4. Jump Squats 2 sets x30 sec
5. Weighted Bar Overhead Squats x12 reps
6. KB Goblet Cyclist Squats x12 reps
7. Rower – Sprint Pace x1 min max effort
8. KB Swings 2 sets x6–8 reps`;

const FILE_ID = '1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4';

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  const token = process.env.ADMIN_TOKEN;
  const baseUrl = process.env.API_URL || process.env.PRODUCTION_URL || 'https://app.stoic-fit.com/api';
  const date = process.argv[2] || getTomorrow();

  if (!token) {
    console.error('ADMIN_TOKEN is not set in .env');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Invalid date. Use YYYY-MM-DD');
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/$/, '')}/admin/workouts/bulk`;
  const body = {
    workouts: [{
      date,
      fileId: FILE_ID,
      title: 'Functional Fitness',
      content: WORKOUT_CONTENT,
      workout_type: 'functional_fitness'
    }]
  };

  console.log('Pushing workout to production via API');
  console.log('  URL:', url);
  console.log('  Date:', date);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    console.error('Error:', res.status, data);
    process.exit(1);
  }

  console.log('Success:', data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
