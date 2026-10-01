// Device kinds (devices.ts): a few words a person recognises, never a model or a version.

import { describe, expect, it } from "vitest";
import { DEVICE_KINDS, deviceKind } from "./devices";

describe("a device's kind", () => {
  it("is named from the user agent, in one of a few words", () => {
    expect(deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")).toBe("Android");
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Mac");
    expect(deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Windows");
    expect(deviceKind("Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("ChromeOS");
    expect(deviceKind("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Linux");
    expect(deviceKind(null)).toBe("Other");
    expect(deviceKind("curl/8.0")).toBe("Other");
  });

  it("knows an iPad asking for the desktop site by its touch screen", () => {
    const desktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    expect(deviceKind(desktop, true)).toBe("iPad");
    expect(DEVICE_KINDS).toContain(deviceKind(desktop, true));
  });

  it("offers exactly the words the database accepts", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../supabase/migrations/20261001190000_phone_alerts.sql", import.meta.url), "utf8");
    const allowed = /device in \(([^)]+)\)/.exec(sql)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(allowed).toEqual([...DEVICE_KINDS]);
  });
});
