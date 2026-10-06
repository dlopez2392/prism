// src/lib/alerts/devices.ts
//
// What kind of device a browser is on, from its user agent, as one of a few
// words: enough for a person to tell their phone from their laptop in the
// list of devices Prism notifies, and nothing that could single them out.
// The database accepts these words and no others.

import { msg } from "@/lib/i18n/t";

export const DEVICE_KINDS = ["iPhone", "iPad", "Android", "Mac", "Windows", "Linux", "ChromeOS", "Other"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** How a device is named on the Account page: "this iPhone", "your Android phone"… */
export const DEVICE_NAMES: Record<DeviceKind, string> = {
  iPhone: "iPhone",
  iPad: "iPad",
  Android: "Android device",
  Mac: "Mac",
  Windows: "Windows computer",
  Linux: "Linux computer",
  ChromeOS: "Chromebook",
  Other: "browser",
};

/**
 * The same names as the Account page says them, to be translated where
 * they're shown (msg, lib/i18n/t.ts). "this iPhone" goes whole into a
 * sentence ("Stop on this iPhone"), because another language's word for
 * "this" can change with the device: "este iPhone", "esta computadora". The
 * English is "this " and DEVICE_NAMES, word for word.
 */
export const THIS_DEVICE: Record<DeviceKind, string> = {
  iPhone: msg("this iPhone"),
  iPad: msg("this iPad"),
  Android: msg("this Android device"),
  Mac: msg("this Mac"),
  Windows: msg("this Windows computer"),
  Linux: msg("this Linux computer"),
  ChromeOS: msg("this Chromebook"),
  Other: msg("this browser"),
};

/** A device on its own, in the list of a person's others, where its name isn't a brand that every language keeps. */
export const DEVICE_LABELS: Partial<Record<DeviceKind, string>> = {
  Android: msg("Android device"),
  Windows: msg("Windows computer"),
  Linux: msg("Linux computer"),
  Other: msg("A browser"),
};

/** `touch` is true when the browser reports a touch screen: an iPad asks for desktop sites and says it's a Mac. */
export function deviceKind(userAgent: string | null | undefined, touch = false): DeviceKind {
  const ua = userAgent ?? "";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}
