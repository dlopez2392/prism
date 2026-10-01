"use server";

// src/lib/server/phone-actions.ts
//
// Alerts on a device (Account page): turn them on for the browser in hand,
// send it a test, or stop them on any of the person's devices. Nothing from
// the browser is trusted: the subscription must name a push service Prism
// knows and carry well-formed keys (validSubscription), a device is named
// from the request's own user agent in one of a few words, and a device is
// addressed by the sha256 of its address, only among the person's own.

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { DEVICE_NAMES, deviceKind } from "@/lib/alerts/devices";
import { alertsConfig } from "@/lib/alerts/send";
import { PUSH_SUBJECT, sendPush, validSubscription, vapidKeys, type PushMessage } from "@/lib/alerts/webpush";
import { BRAND } from "@/lib/brand";
import { currentAccount } from "@/lib/supabase/server";
import { dropDevice, keepDevice, openMyDevice } from "./phones";
import { vaultKey, type Keyring } from "./vault";

export type PhoneResult = { status: "on" | "off" | "sent" | "error"; message: string };

const UNAVAILABLE: PhoneResult = { status: "error", message: "Alerts on a device aren't available yet." };
const SIGNED_OUT: PhoneResult = { status: "error", message: "Your sign-in ended. Sign in again, then try once more." };

function ready(): { secret: string; key: Keyring } | null {
  const config = alertsConfig();
  let key: Keyring | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  return config && key ? { secret: config.secret, key } : null;
}

/** Turns alerts on for the browser in hand, then sends it a first notification so the person sees it work. */
export async function turnOnDevice(subscription: unknown, touch: boolean): Promise<PhoneResult> {
  const account = await currentAccount();
  if (!account) return SIGNED_OUT;
  const env = ready();
  if (!env) return UNAVAILABLE;
  const sub = validSubscription(subscription);
  if (!sub) return { status: "error", message: `This browser's notification service isn't one ${BRAND.product} can use. Try Safari on an iPhone or Chrome on Android.` };
  const device = deviceKind((await headers()).get("user-agent"), touch === true);
  const vapid = vapidKeys(env.secret);
  const kept = await keepDevice(account, sub, device, vapid.publicKey, env.key);
  if (kept === "full") return { status: "error", message: `${BRAND.product} notifies five devices at most. Stop one of them below, then try again.` };
  if (kept === "off") return { status: "error", message: "Turn on alert emails above first: a device gets the same alerts." };
  if (kept === "error") return { status: "error", message: "We couldn't save that just now. Try again in a minute." };
  refresh();
  const hello: PushMessage = {
    title: `Alerts are on for this ${DEVICE_NAMES[device]}`,
    body: `${BRAND.product} will tell you here the morning there's news, with the same alerts as your emails.`,
    url: "/account#phone",
  };
  const sent = await sendPush(sub, hello, vapid, PUSH_SUBJECT);
  return sent === "sent"
    ? { status: "on", message: "Done. A first notification is on its way." }
    : { status: "on", message: "Saved, but this device's notification service didn't answer. Send a test in a minute." };
}

/** A test notification to one of the person's own devices. */
export async function testDevice(hash: string): Promise<PhoneResult> {
  const account = await currentAccount();
  if (!account) return SIGNED_OUT;
  const env = ready();
  if (!env) return UNAVAILABLE;
  const mine = await openMyDevice(account, String(hash), env.key);
  if (!mine) return { status: "error", message: `${BRAND.product} doesn't have this device any more. Turn alerts on for it again.` };
  const test: PushMessage = { title: `A test from ${BRAND.product}`, body: "Notifications work on this device.", url: "/account#phone" };
  const sent = await sendPush(mine.sub, test, vapidKeys(env.secret), PUSH_SUBJECT);
  if (sent === "gone") {
    await dropDevice(account, String(hash));
    refresh();
    return { status: "error", message: "This device's notifications have ended, so it was removed. Turn alerts on for it again." };
  }
  return sent === "sent"
    ? { status: "sent", message: "Sent. It should arrive within a few seconds." }
    : { status: "error", message: "This device's notification service didn't answer. Try again in a minute." };
}

/** Stops alerts on one of the person's devices. */
export async function turnOffDevice(hash: string): Promise<PhoneResult> {
  const account = await currentAccount();
  if (!account) return SIGNED_OUT;
  if (!(await dropDevice(account, String(hash)))) return { status: "error", message: "We couldn't change that just now. Try again in a minute." };
  refresh();
  return { status: "off", message: `Stopped. ${BRAND.product} won't notify that device.` };
}
