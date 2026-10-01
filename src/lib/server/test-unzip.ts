// src/lib/server/test-unzip.ts — for tests: a zip read back the way an unzip
// tool reads it, from the end record through the central directory to each
// file, checking every checksum and size. Throws on anything off.

import { crc32, inflateRawSync } from "node:zlib";

export function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end !== buf.length - 22) throw new Error("no end record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad directory entry");
    const crc = buf.readUInt32LE(at + 16);
    const packedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = inflateRawSync(buf.subarray(start, start + packedSize));
    if (raw.length !== size) throw new Error("wrong size");
    if (crc32(raw) !== crc) throw new Error("wrong checksum");
    files.set(name, raw.toString("utf8"));
    at += 46 + nameLen;
  }
  return files;
}
