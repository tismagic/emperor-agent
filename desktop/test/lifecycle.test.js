const test = require("node:test");
const assert = require("node:assert/strict");

const { planStartup, planShutdown } = require("../lifecycle.js");

test("planStartup attaches to an already-healthy backend without owning it", () => {
  assert.deepEqual(planStartup({ alreadyHealthy: true }), {
    action: "attach",
    ownsBackend: false,
  });
});

test("planStartup spawns and owns the backend when nothing is running", () => {
  assert.deepEqual(planStartup({ alreadyHealthy: false }), {
    action: "spawn",
    ownsBackend: true,
  });
});

test("planShutdown kills only a backend we own and actually spawned", () => {
  const child = { pid: 123 };
  assert.deepEqual(planShutdown({ ownsBackend: true, child }), { shouldKill: true });
  assert.deepEqual(planShutdown({ ownsBackend: false, child }), { shouldKill: false });
  assert.deepEqual(planShutdown({ ownsBackend: true, child: null }), { shouldKill: false });
});
