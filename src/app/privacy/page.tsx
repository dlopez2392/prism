// src/app/privacy/page.tsx — Prism's privacy policy.
//
// Written from what the code does, not from a template: every cookie and
// browser-storage key comes from src/lib/privacy.ts, which a test checks
// against the source. When Prism starts collecting, storing or sharing
// something new, this page changes in the same commit, with a new
// POLICY_UPDATED date.
//
// DESIGN.md rule 10 exception: a privacy policy must name the companies that
// handle people's data, so this page names Plaid (and the rest) by design.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Ban, KeyRound, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { POLICY_UPDATED, PRIVACY_CONTACT, PROVIDERS, STORED_ON_DEVICE } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${BRAND.product} handles your money data: what it reads, where it's kept, who else sees it, and how to delete it.`,
};

const SHORT_VERSION: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Prism can read your accounts but can never move money." },
  { icon: Ban, text: "We don't sell your data, show you ads, or use your money data to train AI." },
  { icon: KeyRound, text: "Your bank password goes to your bank through Plaid. Prism never sees it." },
  { icon: ShieldCheck, text: "Bank access keys and your transactions are encrypted before they're stored." },
  { icon: Trash2, text: "Delete your account any time. We disconnect every bank first, then erase your data." },
];

const link = "font-semibold text-accent-ink hover:underline";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-ink-1">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">{children}</ul>;
}

export default function PrivacyPage() {
  const mail = <a href={`mailto:${PRIVACY_CONTACT}`} className={link}>{PRIVACY_CONTACT}</a>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Legal" title="Privacy policy" subtitle={`Last updated ${POLICY_UPDATED}. How ${BRAND.product} handles your money data, in plain words.`} />

      <Card className="p-5 sm:p-6">
        <h2 className="text-[15px] font-bold tracking-tight text-ink-1">The short version</h2>
        <ul className="mt-3 space-y-2.5">
          {SHORT_VERSION.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-ink-1">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
                <Icon className="size-4" />
              </span>
              <span className="pt-1">{text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="article" className="mt-5 space-y-6 p-5 sm:p-8">
        <Section id="who" title="Who we are">
          <p>
            {BRAND.product} is a personal finance app made by {BRAND.company} ({BRAND.companyShort}), called &ldquo;we&rdquo; and &ldquo;us&rdquo; here. This
            policy covers the {BRAND.product} website and app. Questions or requests: email {mail}.
          </p>
        </Section>

        <Section id="collect" title="What we collect">
          <p className="font-semibold text-ink-1">Your account</p>
          <Bullets>
            <li>Your email address, to sign you in with a one-time code. There is no password.</li>
            <li>Your first name, if you give it, so Prism can greet you.</li>
            <li>Your time zone, so &ldquo;today&rdquo; and &ldquo;this month&rdquo; match yours.</li>
          </Bullets>
          <p className="font-semibold text-ink-1">Money you choose to connect</p>
          <Bullets>
            <li>
              Banks, cards, loans and investments, through Plaid: account names, the last four digits of account numbers, balances, transactions (merchant, amount,
              date and category), investment holdings and loan details. You sign in to your bank through Plaid; {BRAND.product} never sees your bank username or
              password.
            </li>
            <li>Coinbase, if you connect it: your crypto balances, read-only.</li>
          </Bullets>
          <p className="font-semibold text-ink-1">What you set up</p>
          <Bullets>
            <li>Your budgets and goals.</li>
            <li>Your upcoming bills and paydays, if you turn on the calendar feed.</li>
            <li>Which AI apps you&apos;ve allowed to read your money, if any.</li>
          </Bullets>
          <p className="font-semibold text-ink-1">Technical details</p>
          <p>
            Like any website, our hosting and sign-in providers keep short-lived technical logs (IP address, browser type and the time of each request) to keep{" "}
            {BRAND.product} secure and working. We don&apos;t use advertising or analytics trackers.
          </p>
        </Section>

        <Section id="use" title="How we use it">
          <Bullets>
            <li>To show you your money: balances, spending, budgets, goals, bills and insights.</li>
            <li>To keep your connections up to date, and to tell you when one needs attention.</li>
            <li>To sign you in and send your sign-in codes.</li>
            <li>To answer questions from AI apps you&apos;ve approved, read-only.</li>
            <li>To keep {BRAND.product} secure, prevent abuse, and fix problems.</li>
          </Bullets>
          <p>We don&apos;t sell your data, use it for advertising, or use your financial data to train AI models.</p>
        </Section>

        <Section id="share" title="Who else sees it">
          <p>Only the companies that run {BRAND.product} for us, and only what each one needs:</p>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-ctl border border-line">
            {PROVIDERS.map((p) => (
              <li key={p.name} className="flex flex-col gap-1 bg-surface-2 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="w-24 shrink-0 font-semibold text-ink-1">{p.name}</span>
                <span className="min-w-0 flex-1">
                  {p.does}{" "}
                  <a href={p.policy} className={link} target="_blank" rel="noopener noreferrer">
                    Their privacy policy
                  </a>
                </span>
              </li>
            ))}
          </ul>
          <p>And, only when you choose:</p>
          <Bullets>
            <li>
              <span className="font-semibold text-ink-1">AI apps you connect</span>, such as Claude or ChatGPT. They read your accounts, transactions, budgets
              and goals only when answering your questions, can never change anything, and that company&apos;s own privacy policy covers what they receive.
              Disconnect them any time on the{" "}
              <Link href="/account" className={link}>
                Account
              </Link>{" "}
              page.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Your calendar app</span>, if you subscribe to the bills feed. It reads your upcoming bills and paydays,
              and amounts only if you choose to include them.
            </li>
          </Bullets>
          <p>
            We may also share information when the law requires it, to protect someone&apos;s safety, or if {BRAND.companyShort} is ever merged or sold. In that
            case we&apos;d tell you, and this policy would keep protecting your data. We never sell or rent your personal information.
          </p>
        </Section>

        <Section id="protect" title="How we protect it">
          <Bullets>
            <li>Everything travels over encrypted connections (HTTPS).</li>
            <li>The keys that let {BRAND.product} read your banks and Coinbase, and your synced transactions, are encrypted (AES-256) before they&apos;re stored.</li>
            <li>Our database is encrypted at rest, and every account can reach only its own data.</li>
            <li>AI apps you connect are read-only. The database itself refuses any change they try to make.</li>
            <li>Sign-in uses a one-time code sent to your email, so there&apos;s no password to steal.</li>
          </Bullets>
          <p>No system is perfectly secure. If a breach ever affects your information, we&apos;ll tell you as the law requires.</p>
        </Section>

        <Section id="keep" title="How long we keep it">
          <Bullets>
            <li>While you have an account, we keep your data so {BRAND.product} can show it to you.</li>
            <li>Transactions older than about two years drop out of {BRAND.product}&apos;s copy.</li>
            <li>
              When you delete your account, we disconnect every bank and Coinbase link first, then erase your account and everything in it. Encrypted database
              backups roll off shortly after.
            </li>
            <li>Using {BRAND.product} without an account keeps your data on your device, in the cookies listed below. Clearing this site&apos;s data removes it.</li>
          </Bullets>
        </Section>

        <Section id="choices" title="Your choices">
          <Bullets>
            <li>
              Disconnect any bank, Coinbase or AI app at any time from{" "}
              <Link href="/connections" className={link}>
                Connections
              </Link>{" "}
              or{" "}
              <Link href="/account" className={link}>
                Account
              </Link>
              .
            </li>
            <li>Change your name, and turn the calendar feed off, whenever you like.</li>
            <li>
              Delete your account for good on the{" "}
              <Link href="/account" className={link}>
                Account
              </Link>{" "}
              page.
            </li>
            <li>Ask us for a copy of your data, or to correct it, at {mail}.</li>
          </Bullets>
          <p>
            Depending on where you live, such as California, you may have more rights over your information. We honour these requests wherever you live, and we
            never treat you differently for making one.
          </p>
        </Section>

        <Section id="device" title="Cookies and what's stored on your device">
          <p>
            {BRAND.product} stores only what it needs to work. There are no advertising or tracking cookies. Here is everything, and what each one does:
          </p>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-ctl border border-line">
            {STORED_ON_DEVICE.map((c) => (
              <li key={c.name} className="bg-surface-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <code className="font-mono text-xs font-semibold text-ink-1">{c.name}</code>
                  <span className="text-xs text-ink-3">
                    {c.kind} · kept {c.lasts.charAt(0).toLowerCase()}
                    {c.lasts.slice(1)}
                  </span>
                </div>
                <p className="mt-1">{c.what}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="children" title="Children">
          <p>
            {BRAND.product} is for adults 18 and over. It isn&apos;t meant for children, and if we learn we&apos;ve collected information from a child under 13,
            we&apos;ll delete it.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            When this policy changes, the date at the top changes too. If a change matters, such as a new kind of data or a new company that sees it, we&apos;ll tell
            you in the app or by email before it takes effect.
          </p>
        </Section>

        <Section id="contact" title="Contact us">
          <p>
            Questions, requests or concerns: email {mail}. {BRAND.company}.
          </p>
        </Section>
      </Card>
    </div>
  );
}
