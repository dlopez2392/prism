// The download's zip (zip.ts), read back the way an unzip tool reads it: from
// the end record, through the central directory, to each file, with every
// checksum and size checked. (It was also opened by Python's zipfile and by
// unzip -t when written.)

import { describe, expect, it } from "vitest";
import { unzip } from "./test-unzip";
import { zip } from "./zip";

describe("the download's zip", () => {
  it("holds each file exactly, compressed, with its checksum", () => {
    const files = [
      { name: "transactions.csv", content: "\uFEFFDate,Merchant\r\n2026-01-02,Café Olé\r\n" },
      { name: "everything.json", content: JSON.stringify({ rows: "x".repeat(10_000) }) },
      { name: "empty.txt", content: "" },
    ];
    const buf = zip(files, new Date("2026-10-01T12:34:56Z"));
    expect(unzip(buf)).toEqual(new Map(files.map((f) => [f.name, f.content])));
    // Compressed: ten thousand of one letter takes a few dozen bytes.
    expect(buf.length).toBeLessThan(600);
  });

  it("only takes plain file names, never a path out of the folder it's unpacked in", () => {
    for (const name of ["../evil.csv", "/etc/passwd", "a/b.csv", "", "x".repeat(101)]) expect(() => zip([{ name, content: "x" }])).toThrow();
  });
});
