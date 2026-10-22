import { test } from "node:test";
import assert from "node:assert/strict";
import { lanes } from "../scripts/host-load.mjs";
import { node } from "./helpers.mjs";

test("lanes shrink with load and memory, never below one or above the plan", () => {
  assert.equal(lanes({ max: 5, cores: 8, load: 0.5, freeGb: 32 }), 5, "idle: the plan's maximum");
  assert.equal(lanes({ max: 5, cores: 8, load: 5.5, freeGb: 32 }), 2, "busy cpu");
  assert.equal(lanes({ max: 5, cores: 8, load: 0, freeGb: 4 }), 2, "tight memory");
  assert.equal(lanes({ max: 5, cores: 4, load: 14, freeGb: 0.2 }), 1, "overloaded: still one");
  assert.equal(lanes({ max: 1, cores: 64, load: 0, freeGb: 512 }), 1, "plan says serial");
  assert.equal(lanes({ max: 5, cores: 4, load: 0, freeGb: 3, laneGb: 1 }), 3, "lane memory is tunable");
});

test("CLI prints one line and exits 0, whatever it is given", () => {
  for (const arg of [["5"], ["0"], ["x"], []]) {
    const r = node(process.cwd(), "host-load.mjs", arg);
    assert.equal(r.status, 0);
    assert.match(r.out, /^lanes: [1-9]\d* of [1-9]\d* \(load [\d.]+ on \d+ cores, [\d.]+ GB free\)$/);
  }
});
