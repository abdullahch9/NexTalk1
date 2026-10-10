const { test } = require("node:test");
const assert = require("node:assert/strict");
const { remember, deleteCache } = require("../utils/cache");

test("concurrent cache misses share one load and expire after the configured gap", async () => {
  let calls = 0;
  const load = async () => ++calls;
  const values = await Promise.all(Array.from({ length: 100 }, () => remember("stampede", load, 20)));
  assert.equal(calls, 1); assert.ok(values.every(value => value === 1));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await remember("stampede", load), 2);
  deleteCache("stampede");
});

test("a mutation detaches old reads so they cannot overwrite refreshed cache", async () => {
  let complete;
  const old = remember("race", () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  deleteCache("race");
  assert.equal(await remember("race", async () => "new"), "new");
  complete("old"); await old;
  assert.equal(await remember("race", () => assert.fail("cached value expected")), "new");
  deleteCache("race");
});

test("failed cache loads allow a fresh retry without caching the failure", async () => {
  await assert.rejects(remember("failure", () => { throw new Error("unavailable"); }));
  assert.equal(await remember("failure", async () => "recovered"), "recovered");
  deleteCache("failure");
});
