const { Client } = require('pg');

const client = new Client({
  host: 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'postgres',
  user: 'stoicapp',
  password: 'StoicDBtrong',
  ssl: { rejectUnauthorized: false }
});

(async () => {
  await client.connect();
  const result = await client.query('SELECT COUNT(*) as count, MIN(workout_number) as min_num, MAX(workout_number) as max_num FROM strength_workouts WHERE phase = $1', ['Phase One: Beginner']);
  console.log('Phase One workouts in production:');
  console.log('  Total:', result.rows[0].count);
  console.log('  Workout numbers:', result.rows[0].min_num, 'to', result.rows[0].max_num);
  const sample = await client.query('SELECT workout_date, workout_number FROM strength_workouts WHERE phase = $1 ORDER BY workout_date LIMIT 3', ['Phase One: Beginner']);
  console.log('  Sample (first 3):');
  sample.rows.forEach(w => console.log(`    ${w.workout_date}: Workout:${w.workout_number}`));
  await client.end();
})();



