/**
 * Simple test runner - executes async tests and collects results.
 * Use: const { run, test } = require('./runner');
 * test('name', async () => { ... })  // throws on failure
 * run(suite)  // returns { passed, failed, results }
 */

async function run(suite) {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of suite) {
    try {
      await fn();
      results.push({ name, ok: true });
      passed++;
    } catch (err) {
      results.push({ name, ok: false, error: err.message || String(err) });
      failed++;
    }
  }

  return { passed, failed, results };
}

module.exports = { run };
