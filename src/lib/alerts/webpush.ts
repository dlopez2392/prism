// src/lib/alerts/webpush.ts
//
// Notifications to a phone, by the open Web Push standards and nothing else:
// the message is encrypted for that one phone (RFC 8291, aes128gcm), so the
// push service carrying it (Apple's, Google's, Mozilla's, Microsoft's) can't
// read it; and each request is signed with Prism's application server key
// (VAPID, RFC 8292), so a push service accepts it only from Prism.
//
// The VAPID key is derived from CRON_SECRET (HKDF, with its own label), so
// there's no extra key for anyone to make, store or paste: replacing the
// secret replaces the key, and phones then subscribe again. A subscription is
// only ever sent to the push services Prism knows, never to whatever address
// a browser hands over.

import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { BRAND } from "@/lib/brand";

/** Who a push service writes to about Prism's notifications (RFC 8292's "sub"): a mailbox someone reads. */
export const PUSH_SUBJECT = `mailto:${BRAND.privacyEmail}`;

/** What a browser's PushSubscription.toJSON() gives, checked. */
export type PushSubscription = { endpoint: string; p256dh: string; auth: string };

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

/** The push services browsers use. Anything else is refused, so the job never posts to an address someone chose. */
export const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname)) && endpoint.length <= 1000;
  } catch {
    return false;
  }
}

/** A subscription as a browser sends it, or null: an allowed endpoint, a P-256 public key and a 16-byte secret. */
export function validSubscription(x: unknown): PushSubscription | null {
  const s = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; p256dh?: unknown; auth?: unknown } | null;
  const endpoint = s?.endpoint;
  const p256dh = s?.keys?.p256dh ?? s?.p256dh;
  const auth = s?.keys?.auth ?? s?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string" || !pushEndpointAllowed(endpoint)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return null;
  const key = fromB64u(p256dh);
  if (key.length !== 65 || key[0] !== 4 || fromB64u(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}

/** A subscription's identity in the database: a hash, so the table names no push service address in the clear. */
export const endpointHash = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();

/**
 * The payload encrypted for one subscription (RFC 8291 with RFC 8188's
 * aes128gcm, one record). `test` fixes the server's key pair and the salt,
 * for the RFC's own worked example; real messages get fresh ones.
 */
export function encryptPush(plaintext: Uint8Array, sub: Pick<PushSubscription, "p256dh" | "auth">, test?: { serverPrivateKey: Buffer; salt: Buffer }): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = createECDH("prime256v1");
  if (test) ecdh.setPrivateKey(test.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = test?.salt ?? randomBytes(16);
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  // One record: the plaintext, then the last-record delimiter.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** P-256's group order: a private key must be below it. */
const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

export type VapidKeys = { privateKey: KeyObject; publicKey: string };

/** Prism's VAPID key pair, derived from CRON_SECRET: the same secret always gives the same key. */
export function vapidKeys(secret: string): VapidKeys {
  for (let n = 0; ; n++) {
    const d = Buffer.from(hkdfSync("sha256", secret, "prism-vapid", `p256 private key ${n}`, 32));
    const value = BigInt(`0x${d.toString("hex")}`);
    if (value === BigInt(0) || value >= P256_N) continue;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey();
    const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
    return { privateKey, publicKey: b64u(pub) };
  }
}

/** The Authorization header for one push service (RFC 8292): a short-lived ES256 token for its origin, and the public key. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** What a phone shows: a title, a line, and where tapping it goes (a path on Prism). */
export type PushMessage = { title: string; body: string; url: string };

export type PushResult = "sent" | "gone" | "failed";

/** One notification. "gone" is the push service saying the subscription no longer exists (it should be forgotten). */
export async function sendPush(sub: PushSubscription, message: PushMessage, keys: VapidKeys, subject: string, fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  if (!pushEndpointAllowed(sub.endpoint)) return "gone";
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(24 * 3600),
        Urgency: "normal",
      },
      body: new Uint8Array(encryptPush(Buffer.from(JSON.stringify(message)), sub)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "sent";
    return res.status === 404 || res.status === 410 ? "gone" : "failed";
  } catch {
    return "failed";
  }
}
