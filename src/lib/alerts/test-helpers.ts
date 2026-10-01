// src/lib/alerts/test-helpers.ts — a phone, for tests: its keys, and what its
// browser does with a push message (RFC 8291's receiving side).

import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

/** A browser's subscription keys, as PushSubscription.toJSON() gives them, with the private half kept for decrypting. */
export function phoneKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url"), privateKey: ecdh.getPrivateKey(), authSecret: auth };
}

/** The plaintext a phone reads from a push message body, or a throw when it isn't for this phone. */
export function decryptAsPhone(body: Buffer, uaPrivate: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const h = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();
  const ikm = h(h(auth, ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = h(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const record = body.subarray(21 + idlen);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const out = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  if (out.at(-1) !== 2) throw new Error("Not a last record.");
  return out.subarray(0, -1);
}
