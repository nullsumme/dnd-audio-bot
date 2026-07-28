export function validTestMp3(): Uint8Array {
  const frames = Array.from({ length: 80 }, (_, index) => {
    const padding = index % 2;
    const frame = Buffer.alloc(417 + padding);
    frame.set([0xff, 0xfb, 0x90 + padding * 2, 0x64]);
    return frame;
  });
  return Buffer.concat(frames);
}

export function byteStream(
  bytes: Uint8Array,
  chunkSize = bytes.byteLength || 1
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    }
  });
}
