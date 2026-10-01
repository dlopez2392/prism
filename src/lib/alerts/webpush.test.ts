// Notifications to a phone (webpush.ts): encrypted exactly as RFC 8291's own
// worked example, decryptable by the phone it was meant for and no other,
// signed per RFC 8292 with a key the job's secret alone determines, and only
// ever sent to the push services browsers use.

import { createECDH, createPublicKey, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptAsPhone } from "./test-helpers";
import { encryptPush, endpointHash, pushEndpointAllowed, sendPush, validSubscription, vapidAuthorization, vapidKeys } from "./webpush";

const b = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "base64url");

// RFC 8291, section 5 and appendix A.
const RFC = {
  plaintext: b("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
  asPrivate: b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: b("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  salt: b("DGv6ra1nlYgDCS1FRnbzlw"),
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  // The header and the ciphertext are separate base64url strings in the RFC: decoded apart, then joined.
  result: Buffer.concat([
    b("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
    b("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ"),
  ]),
};

const SECRET = "s".repeat(44);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

describe("a push message's encryption", () => {
  it("matches RFC 8291's own worked example, byte for byte", () => {
    expect(encryptPush(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { serverPrivateKey: RFC.asPrivate, salt: RFC.salt })).toEqual(RFC.result);
  });

  it("opens on the phone it was meant for, with a fresh key and salt every time, and on no other", () => {
    const message = Buffer.from(JSON.stringify({ title: "First Bank needs you to sign in again", body: "…", url: "/connections" }));
    const one = encryptPush(message, { p256dh: RFC.uaPublic, auth: RFC.auth });
    const two = encryptPush(message, { p256dh: RFC.uaPublic, auth: RFC.auth });
    expect(one.equals(two)).toBe(false);
    expect(decryptAsPhone(one, RFC.uaPrivate, b(RFC.auth))).toEqual(message);
    const other = createECDH("prime256v1");
    other.generateKeys();
    expect(() => decryptAsPhone(one, other.getPrivateKey(), b(RFC.auth))).toThrow();
    expect(() => decryptAsPhone(one, RFC.uaPrivate, Buffer.alloc(16))).toThrow();
  });
});

describe("Prism's VAPID key", () => {
  it("is the same for the same secret and different for another, so replacing the secret replaces it", () => {
    expect(vapidKeys(SECRET).publicKey).toBe(vapidKeys(SECRET).publicKey);
    expect(vapidKeys(SECRET).publicKey).not.toBe(vapidKeys("t".repeat(44)).publicKey);
    expect(b(vapidKeys(SECRET).publicKey)).toHaveLength(65);
  });

  it("signs a short-lived token for the push service's origin only, which its public key verifies", () => {
    const keys = vapidKeys(SECRET);
    const now = Date.parse("2026-10-06T13:00:00Z");
    const header = vapidAuthorization(ENDPOINT, keys, "mailto:privacy@bis-rgv.com", now);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt!.split(".");
    expect(JSON.parse(b(h!).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b(c!).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:privacy@bis-rgv.com" });
    const pub = b(keys.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, b(s!))).toBe(true);
  });
});

describe("where a push may go", () => {
  it("only to the push services browsers use, over HTTPS, with nothing hidden in the address", () => {
    for (const ok of [ENDPOINT, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QK2", "https://wns2-by3p.notify.windows.com/w/?token=x"]) {
      expect(pushEndpointAllowed(ok)).toBe(true);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com:8443/x",
      "https://user@fcm.googleapis.com/x",
      "https://169.254.169.254/latest",
      "not a url",
    ]) {
      expect(pushEndpointAllowed(bad)).toBe(false);
    }
  });

  it("reads a browser's subscription only when it is whole and its keys are the right size", () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    expect(validSubscription({ endpoint: ENDPOINT, keys })).toEqual({ endpoint: ENDPOINT, ...keys });
    expect(validSubscription({ endpoint: "https://evil.example/x", keys })).toBeNull();
    expect(validSubscription({ endpoint: ENDPOINT, keys: { ...keys, auth: "short" } })).toBeNull();
    expect(validSubscription({ endpoint: ENDPOINT, keys: { ...keys, p256dh: RFC.auth } })).toBeNull();
    expect(validSubscription(null)).toBeNull();
    expect(endpointHash(ENDPOINT)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sending one", () => {
  const sub = { endpoint: ENDPOINT, p256dh: RFC.uaPublic, auth: RFC.auth };
  const message = { title: "Your week in Prism", body: "Spent $840", url: "/" };

  it("posts the encrypted message with the signature, a day to live, and normal urgency", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendPush(sub, message, vapidKeys(SECRET), "mailto:privacy@bis-rgv.com", fetchImpl)).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: Uint8Array }];
    expect(url).toBe(ENDPOINT);
    expect(init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "86400", Urgency: "normal", Authorization: expect.stringMatching(/^vapid t=/) });
    expect(JSON.parse(decryptAsPhone(Buffer.from(init.body), RFC.uaPrivate, b(RFC.auth)).toString())).toEqual(message);
  });

  it("tells a subscription that's gone from a failure, and never posts to an address it doesn't know", async () => {
    const status = (n: number) => sendPush(sub, message, vapidKeys(SECRET), "mailto:x@y.z", async () => new Response(null, { status: n }));
    expect(await status(410)).toBe("gone");
    expect(await status(404)).toBe("gone");
    expect(await status(500)).toBe("failed");
    expect(await status(429)).toBe("failed");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendPush({ ...sub, endpoint: "https://evil.example/x" }, message, vapidKeys(SECRET), "mailto:x@y.z", fetchImpl)).toBe("gone");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
