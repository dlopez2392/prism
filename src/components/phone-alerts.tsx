"use client";

// src/components/phone-alerts.tsx
//
// Alerts on a device, on the Account page: the same alerts as the emails, as
// a notification, for the browser in hand and any other device the person
// turned them on for. One primary action for the card (turning them on here);
// everything else is ghost.
//
// The browser is asked for permission only when the person taps the button,
// never on arrival. An iPhone lets a website notify only once it's on the
// Home Screen, so a Safari tab on one is shown how, rather than a button that
// can't work.

import { useEffect, useState, useTransition } from "react";
import { CircleCheck, Laptop, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { buttonGhost, buttonPrimary, buttonSmall } from "@/components/dialog";
import { Bone } from "@/components/skeletons";
import { StatusPill } from "@/components/ui";
import { DEVICE_NAMES, deviceKind, type DeviceKind } from "@/lib/alerts/devices";
import { BRAND } from "@/lib/brand";
import { dayDate } from "@/lib/finance/format";
import { testDevice, turnOffDevice, turnOnDevice, type PhoneResult } from "@/lib/server/phone-actions";

export type PhoneDevice = { hash: string; device: DeviceKind; since: string };

type Here =
  | { kind: "checking" }
  /** An iPhone or iPad in a browser tab: it must be added to the Home Screen first. */
  | { kind: "install" }
  | { kind: "unsupported" }
  | { kind: "blocked" }
  /** `hash` names this browser's subscription to Prism's key, when it has one. */
  | { kind: "ready"; hash: string | null };

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const toB64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** True when the subscription was made for this key: after the key changes, a browser has to subscribe again. */
function forKey(sub: PushSubscription, vapidKey: string): boolean {
  const k = sub.options.applicationServerKey;
  return k !== null && toB64u(k) === vapidKey;
}

const ICONS: Partial<Record<DeviceKind, LucideIcon>> = {
  iPhone: Smartphone,
  Android: Smartphone,
  iPad: Tablet,
};

const touch = () => navigator.maxTouchPoints > 1;
const appleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && touch());
const installed = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function PhoneAlerts({ vapidKey, devices, alertsOn }: { vapidKey: string; devices: PhoneDevice[] | null; alertsOn: boolean }) {
  const [here, setHere] = useState<Here>({ kind: "checking" });
  const [name, setName] = useState<string>(DEVICE_NAMES.Other);
  const [result, setResult] = useState<PhoneResult | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setName(DEVICE_NAMES[deviceKind(navigator.userAgent, touch())]);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setHere(appleMobile() && !installed() ? { kind: "install" } : { kind: "unsupported" });
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setHere({ kind: "blocked" });
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      const hash = sub && Notification.permission === "granted" && forKey(sub, vapidKey) ? await sha256Hex(sub.endpoint) : null;
      if (!cancelled) setHere({ kind: "ready", hash });
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidKey]);

  const hash = here.kind === "ready" ? here.hash : null;
  const onHere = hash !== null && (devices ?? []).some((d) => d.hash === hash);
  const others = (devices ?? []).filter((d) => d.hash !== hash);

  function turnOn() {
    setResult(null);
    start(async () => {
      try {
        // First, while the tap still counts: browsers only ask in answer to one.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          if (permission === "denied") setHere({ kind: "blocked" });
          else
            setResult({
              status: "error",
              message: `Allow notifications when your browser asks, and ${BRAND.product} can send alerts here.`,
            });
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (sub && !forKey(sub, vapidKey)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromB64u(vapidKey),
        });
        const saved = await turnOnDevice(sub.toJSON(), touch());
        setHere({ kind: "ready", hash: await sha256Hex(sub.endpoint) });
        setResult(saved);
      } catch {
        setResult({
          status: "error",
          message: "This browser didn't let notifications start. Try again, or reload the page.",
        });
      }
    });
  }

  function stop(target: string, mine: boolean) {
    setResult(null);
    start(async () => {
      if (mine) {
        const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
        await (await reg?.pushManager.getSubscription().catch(() => null))?.unsubscribe().catch(() => false);
        setHere({ kind: "ready", hash: null });
      }
      setResult(await turnOffDevice(target));
    });
  }

  function test(target: string) {
    setResult(null);
    start(async () => setResult(await testDevice(target)));
  }

  if (!alertsOn) {
    return (
      <p className="mt-4 rounded-ctl bg-surface-2 p-3 text-sm text-ink-2">
        Turn on alert emails above first. A device gets the same alerts, the moment each email goes.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-ctl bg-surface-2 p-3 text-sm text-ink-1">
        {here.kind === "checking" ? (
          <div aria-busy="true" aria-label="Checking this device" className="space-y-2">
            <Bone className="h-4 w-48" />
            <Bone className="h-10 w-56" />
          </div>
        ) : here.kind === "install" ? (
          <div>
            <p className="font-semibold">First, add {BRAND.product} to your Home Screen</p>
            <p className="mt-0.5 text-xs text-ink-2">
              An iPhone or iPad lets {BRAND.product} send notifications only from the Home Screen app. It takes three taps:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>Tap Share, the square with an arrow, at the bottom of Safari.</li>
              <li>Choose Add to Home Screen, then Add.</li>
              <li>Open {BRAND.product} from your Home Screen and come back to this page.</li>
            </ol>
          </div>
        ) : here.kind === "unsupported" ? (
          <p>This browser can&apos;t show notifications from {BRAND.product}. On a phone, use Safari on an iPhone (iOS 16.4 or later) or Chrome on Android.</p>
        ) : here.kind === "blocked" ? (
          <p>Notifications are blocked for {BRAND.product} in this browser. Allow them in its settings, then reload this page.</p>
        ) : onHere ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="good">On for this {name}</StatusPill>
            <button type="button" disabled={pending} onClick={() => test(hash!)} className={buttonGhost}>
              Send a test
            </button>
            <button type="button" disabled={pending} onClick={() => stop(hash!, true)} className={buttonGhost}>
              Stop on this {name}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={pending} onClick={turnOn} className={buttonPrimary}>
              {pending ? "Turning on…" : `Send alerts to this ${name}`}
            </button>
            <span className="text-xs text-ink-3">Your browser will ask to allow notifications.</span>
          </div>
        )}
      </div>

      {devices === null ? (
        <p role="alert" className="text-sm font-medium text-crit-ink">
          We couldn&apos;t load your other devices just now. Try again in a minute.
        </p>
      ) : others.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Also getting alerts</p>
          <ul className="mt-1 divide-y divide-[var(--line)]">
            {others.map((d) => {
              const Icon = ICONS[d.device] ?? Laptop;
              return (
                <li key={d.hash} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Icon aria-hidden className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 text-sm text-ink-1">
                    {d.device === "Other" ? "A browser" : DEVICE_NAMES[d.device]}
                    <span className="text-ink-3"> · since {dayDate(d.since.slice(0, 10))}</span>
                  </span>
                  <button type="button" disabled={pending} onClick={() => stop(d.hash, false)} className={buttonSmall}>
                    Stop
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Always in the DOM so screen readers announce it. */}
      <p
        role="status"
        className={result?.status === "error" ? "text-sm font-medium text-crit-ink" : "flex items-center gap-1 text-xs font-semibold text-good-ink"}
      >
        {result ? (
          <>
            {result.status === "error" ? null : <CircleCheck aria-hidden className="size-3.5" />}
            {result.message}
          </>
        ) : null}
      </p>
    </div>
  );
}
