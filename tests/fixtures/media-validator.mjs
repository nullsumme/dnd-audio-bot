#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('-version')) {
  process.stdout.write('soundkeep hermetic media validator 1.0\n');
  process.exit(0);
}

const inputIndex = args.indexOf('-i');
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : args.at(-1);
if (!inputPath) process.exit(2);

const bytes = readFileSync(inputPath);
let offset = 0;
let frames = 0;
while (offset < bytes.length) {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || bytes[offset + 1] !== 0xfb) {
    process.exit(1);
  }
  const padded = (bytes[offset + 2] & 0x02) !== 0;
  const frameSize = 417 + Number(padded);
  if (offset + frameSize > bytes.length || bytes[offset + 3] !== 0x64) process.exit(1);
  offset += frameSize;
  frames += 1;
}
if (frames !== 80 || offset !== bytes.length) process.exit(1);

if (args.includes('-show_entries')) {
  process.stdout.write(
    `${JSON.stringify({
      streams: [{ codec_name: 'mp3', codec_type: 'audio' }],
      format: {
        duration: process.env.SOUNDKEEP_TEST_MEDIA_DURATION ?? '2.087500',
        format_name: 'mp3'
      }
    })}\n`
  );
}
