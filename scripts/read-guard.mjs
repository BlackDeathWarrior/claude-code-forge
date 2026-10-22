#!/usr/bin/env node
// PreToolUse hook for Read: caps how many image files one transcript may read.
// Each image stays in context and is re-read on every later turn, so a 62-frame
// transcription once cost 80M cache-read and 33M cache-write tokens on its own.
// Exit 2 blocks the call; stderr tells the agent how to carry on (one contact sheet).
// Fails open: anything it cannot parse is allowed.
import { closeSync, openSync, readSync, fstatSync, readFileSync } from "node:fs";

const LIMIT = Number(process.env.AUTOPILOT_IMAGE_LIMIT || 12);
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function countImages(path) {
  // Count image blocks already in the transcript, in 8 MB chunks so a huge file stays cheap.
  let fd;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(8 * 1024 * 1024);
    let count = 0;
    let carry = "";
    for (let pos = 0; pos < size; ) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const text = carry + buf.toString("latin1", 0, n);
      count += (text.match(/"type":"image"/g) || []).length;
      carry = text.slice(-16);
      pos += n;
    }
    return count;
  } catch {
    return 0;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const file = input?.tool_input?.file_path;
  if (typeof file !== "string" || !IMAGE.test(file)) return 0;
  const seen = input.transcript_path ? countImages(input.transcript_path) : 0;
  if (seen < LIMIT) return 0;
  process.stderr.write(
    `read-guard: this transcript already holds ${seen} images; each is re-read on every turn. ` +
      `Tile the rest into one contact sheet and read that: ` +
      `ffmpeg -pattern_type glob -i 'DIR/*.png' -vf scale=480:-1,tile=4x3 sheet_%02d.png. ` +
      `If a human really needs more, they can raise AUTOPILOT_IMAGE_LIMIT.\n`,
  );
  return 2;
}

process.exit(main());
