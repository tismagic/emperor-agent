const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IDLE_BANTER,
  IDLE_BUBBLE_DURATION_MS,
  IDLE_BUBBLE_INTERVAL_MS,
  IDLE_SCENES,
  IDLE_SLEEP_DURATION_MS,
  idleSceneAt,
} = require("../idle-scenes");

test("uses richer idle timing and enough local banter", () => {
  assert.equal(IDLE_BUBBLE_INTERVAL_MS, 25000);
  assert.equal(IDLE_BUBBLE_DURATION_MS, 6000);
  assert.equal(IDLE_SLEEP_DURATION_MS, 8000);
  assert.ok(IDLE_BANTER.length >= 30);
});

test("rotates idle-only assets and keeps sleeping short", () => {
  const animations = IDLE_SCENES.map((scene) => scene.animation);
  assert.deepEqual(new Set(animations), new Set(["idle", "sweeping", "sleeping"]));
  assert.equal(animations.includes("thinking"), false);
  assert.equal(animations.includes("happy"), false);
  assert.equal(animations.includes("notification"), false);
  assert.equal(animations.includes("dizzy"), false);
  assert.equal(animations.includes("disconnected"), false);

  const sleeping = IDLE_SCENES.find((scene) => scene.animation === "sleeping");
  assert.equal(sleeping.durationMs, 8000);
  assert.equal(sleeping.wakeAnimation, "idle");
});

test("provides deterministic idle scenes with clipped display durations", () => {
  const first = idleSceneAt(0);
  const sleeping = idleSceneAt(6);
  const wrapped = idleSceneAt(IDLE_SCENES.length);

  assert.equal(first.animation, "idle");
  assert.equal(first.bubbleDurationMs, 6000);
  assert.equal(typeof first.bubble, "string");
  assert.ok(first.bubble.length > 0);
  assert.equal(sleeping.animation, "sleeping");
  assert.equal(sleeping.durationMs, 8000);
  assert.equal(wrapped.animation, first.animation);
});
