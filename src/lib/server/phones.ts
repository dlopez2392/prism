// src/lib/server/phones.ts
//
// The devices a person lets Prism notify (push_subscriptions), read and
// written AS the person: row-level security keeps each to its owner, refuses
// a connected app and a session short of the second step, and accepts one
// only while their alert emails are on. A subscription is sealed with the
// vault key before it's stored; the table names it only by the sha256 of its
// address and the kind of device.

import "server-only";
import { DEVICE_KINDS, type DeviceKind } from "@/lib/alerts/devices";
import { endpointHash, validSubscription, type PushSubscription } from "@/lib/alerts/webpush";
import type { Account } from "@/lib/supabase/server";
import { openJson, sealJson, type VaultKey } from "./vault";

export type MyDevice = { hash: string; device: DeviceKind; since: string };

export const HASH = /^[0-9a-f]{64}$/;

const isKind = (x: unknown): x is DeviceKind => DEVICE_KINDS.includes(x as DeviceKind);

/** The person's devices, oldest first; null when the database can't be asked. */
export async function myDevices(account: Account): Promise<MyDevice[] | null> {
  const { data, error } = await account.supabase.from("push_subscriptions").select("endpoint_hash, device, created_at").order("created_at");
  if (error || !Array.isArray(data)) return null;
  return data.flatMap((r: { endpoint_hash: unknown; device: unknown; created_at: unknown }) =>
    typeof r.endpoint_hash === "string" && HASH.test(r.endpoint_hash) && isKind(r.device) && typeof r.created_at === "string"
      ? [{ hash: r.endpoint_hash, device: r.device, since: r.created_at }]
      : [],
  );
}

export type KeepResult = "saved" | "full" | "off" | "error";

/**
 * Saves a device (again, if it's already one of theirs: same address, same
 * row), with the VAPID public key it subscribed to, so the job can tell a
 * device made for a replaced key (one no push service will deliver to) and
 * forget it rather than fail on it every morning.
 */
export async function keepDevice(account: Account, sub: PushSubscription, device: DeviceKind, vapidPublicKey: string, key: VaultKey): Promise<KeepResult> {
  const sealed = sealJson({ ...sub, vapid: vapidPublicKey }, key);
  const { error } = await account.supabase
    .from("push_subscriptions")
    .upsert({ user_id: account.userId, endpoint_hash: endpointHash(sub.endpoint), sealed, device }, { onConflict: "user_id,endpoint_hash" });
  if (!error) return "saved";
  // The database's own words: five already (the limit trigger), or alerts are off (row-level security).
  if (error.code === "23514") return "full";
  if (error.code === "42501") return "off";
  return "error";
}

/** One of their devices, opened; null when it isn't theirs, isn't there, or no key in the ring opens it. */
export async function openMyDevice(account: Account, hash: string, key: VaultKey): Promise<{ sub: PushSubscription; device: DeviceKind } | null> {
  if (!HASH.test(hash)) return null;
  const { data, error } = await account.supabase.from("push_subscriptions").select("sealed, device").eq("endpoint_hash", hash).maybeSingle<{ sealed: string; device: unknown }>();
  if (error || !data) return null;
  const sub = validSubscription(openJson(data.sealed, key));
  return sub && isKind(data.device) ? { sub, device: data.device } : null;
}

/** Forgets one of their devices. True when the database answered, whether or not it was there. */
export async function dropDevice(account: Account, hash: string): Promise<boolean> {
  if (!HASH.test(hash)) return false;
  const { error } = await account.supabase.from("push_subscriptions").delete().eq("endpoint_hash", hash);
  return !error;
}
