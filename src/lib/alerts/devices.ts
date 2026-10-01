// src/lib/alerts/devices.ts
//
// What kind of device a browser is on, from its user agent, as one of a few
// words: enough for a person to tell their phone from their laptop in the
// list of devices Prism notifies, and nothing that could single them out.
// The database accepts these words and no others.

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
