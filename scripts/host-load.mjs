#!/usr/bin/env node
// How many lanes this machine can carry right now. No model tokens, always exits 0.
//
//   node host-load.mjs <max lanes>      prints `lanes: N of <max> (load 1.2 on 4 cores, 6.1 GB free)`
//
// The conductor asks at the start of every wave and runs min(plan Lanes, N). A lane is a worktree with
// its own dependency install, test run and often a browser, so a machine that is already busy gets fewer
// of them. It never says 0: one lane is always progress, and the wave before it has finished.
// AUTOPILOT_LANE_GB (default 1.5) is the memory one lane is assumed to need.
import { cpus, freemem, loadavg } from "node:os";
import { pathToFileURL } from "node:url";

/** Lanes by load and by memory, at least one and at most max. */
export function lanes({ max, cores, load, freeGb, laneGb = 1.5 }) {
  const byLoad = Math.floor(cores - load);
  const byMem = Math.floor(freeGb / laneGb);
  return Math.max(1, Math.min(max, byLoad, byMem));
}

function main() {
  const max = Math.max(1, Math.floor(Number(process.argv[2])) || 1);
  const cores = Math.max(1, cpus().length);
  const load = loadavg()[0]; // 0 on Windows, where only memory limits the lanes
  const freeGb = freemem() / 2 ** 30;
  const laneGb = Number(process.env.AUTOPILOT_LANE_GB) > 0 ? Number(process.env.AUTOPILOT_LANE_GB) : 1.5;
  const n = lanes({ max, cores, load, freeGb, laneGb });
  console.log(`lanes: ${n} of ${max} (load ${load.toFixed(1)} on ${cores} cores, ${freeGb.toFixed(1)} GB free)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.log(`lanes: 1 (could not read the host: ${e.message})`);
  }
  process.exit(0);
}
