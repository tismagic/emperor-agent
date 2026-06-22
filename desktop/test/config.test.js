const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveConfig } = require("../config.js");

const throwingRead = () => {
  throw new Error("ENOENT");
};

test("falls back to defaults when emperor.local.json is unreadable", () => {
  const cfg = resolveConfig({ readFile: throwingRead });
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.port, 8765);
  assert.equal(cfg.backendBaseUrl, "http://127.0.0.1:8765");
  assert.equal(cfg.configSource, "default");
});

test("reads host and port from emperor.local.json", () => {
  const readFile = () => JSON.stringify({ webui: { host: "0.0.0.0", port: 9100 } });
  const cfg = resolveConfig({ readFile });
  assert.equal(cfg.host, "0.0.0.0");
  assert.equal(cfg.port, 9100);
  assert.equal(cfg.backendBaseUrl, "http://0.0.0.0:9100");
  assert.equal(cfg.configSource, "file");
});

test("--port argument overrides the file value", () => {
  const readFile = () => JSON.stringify({ webui: { host: "127.0.0.1", port: 8765 } });
  const cfg = resolveConfig({ argv: ["--port", "9000"], readFile });
  assert.equal(cfg.port, 9000);
  assert.equal(cfg.backendBaseUrl, "http://127.0.0.1:9000");
});

test("EMPEROR_WEBUI_PORT env overrides the file value", () => {
  const readFile = () => JSON.stringify({ webui: { port: 8765 } });
  const cfg = resolveConfig({ env: { EMPEROR_WEBUI_PORT: "9200" }, readFile });
  assert.equal(cfg.port, 9200);
});

test("invalid ports fall back to the default 8765", () => {
  const readFile = () => JSON.stringify({ webui: { port: "abc" } });
  assert.equal(resolveConfig({ readFile }).port, 8765);
  assert.equal(resolveConfig({ readFile: () => JSON.stringify({ webui: { port: -1 } }) }).port, 8765);
  assert.equal(resolveConfig({ readFile: () => JSON.stringify({ webui: { port: 70000 } }) }).port, 8765);
});

test("--root and EMPEROR_AGENT_ROOT control where the config is read from", () => {
  const seen = [];
  const readFile = (p) => {
    seen.push(p);
    throw new Error("ENOENT");
  };
  resolveConfig({ argv: ["--root", "/tmp/custom-root"], readFile });
  assert.equal(seen[0], "/tmp/custom-root/emperor.local.json");

  seen.length = 0;
  resolveConfig({ env: { EMPEROR_AGENT_ROOT: "/tmp/env-root" }, readFile });
  assert.equal(seen[0], "/tmp/env-root/emperor.local.json");
});
