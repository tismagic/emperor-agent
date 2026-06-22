const test = require("node:test");
const assert = require("node:assert/strict");

const { probeBackend, waitForBackend } = require("../health.js");

const BASE = "http://127.0.0.1:8765";

test("probeBackend returns true on a 2xx response", async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: true };
  };
  assert.equal(await probeBackend(BASE, { fetchFn }), true);
  assert.equal(calls[0], `${BASE}/api/bootstrap`);
});

test("probeBackend returns false on a non-2xx response", async () => {
  const fetchFn = async () => ({ ok: false });
  assert.equal(await probeBackend(BASE, { fetchFn }), false);
});

test("probeBackend returns false when fetch rejects", async () => {
  const fetchFn = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await probeBackend(BASE, { fetchFn }), false);
});

test("waitForBackend resolves once a later probe succeeds", async () => {
  let attempts = 0;
  const probe = async () => {
    attempts += 1;
    return attempts >= 3;
  };
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  await waitForBackend(BASE, { probe, sleep, retries: 5, intervalMs: 250 });
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2); // slept between the 2 failed attempts
});

test("waitForBackend rejects with a readable message after exhausting retries", async () => {
  const probe = async () => false;
  const sleep = async () => {};
  await assert.rejects(
    () => waitForBackend(BASE, { probe, sleep, retries: 3, intervalMs: 100 }),
    /did not become ready/,
  );
});
