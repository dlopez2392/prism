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
import { Ban, KeyRound, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { Bullets, legalLink as link, Section, ShortVersion } from "@/components/legal";
import { Card, PageHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { liabilitiesEnabled } from "@/lib/plaid/liabilities";
import { POLICY_UPDATED, PRIVACY_CONTACT, providers, PUSH_SERVICES, STORED_ON_DEVICE } from "@/lib/privacy";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { chainEnabled } from "@/lib/crypto/balances";
import { alertsConfig } from "@/lib/alerts/send";

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

export default function PrivacyPage() {
  const alerts = alertsConfig() !== null;
  const mail = <a href={`mailto:${PRIVACY_CONTACT}`} className={link}>{PRIVACY_CONTACT}</a>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Legal" title="Privacy policy" subtitle={`Last updated ${POLICY_UPDATED}. How ${BRAND.product} handles your money data, in plain words.`} />

      <ShortVersion items={SHORT_VERSION} />

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
            <li>If you turn on two-step sign-in, the secret your authenticator app shares with us. Our sign-in provider keeps it, to check your codes.</li>
          </Bullets>
          <p className="font-semibold text-ink-1">Money you choose to connect</p>
          <Bullets>
            <li>
              Banks, cards, loans and investments, through Plaid: account names, the last four digits of account numbers, balances, transactions (merchant, amount,
              date and category) and investment holdings. You sign in to your bank through Plaid; {BRAND.product} never sees your bank username or password.
              {/* Reading loan details is switched on by the operator (PLAID_LIABILITIES); this sentence changes with it, in the same deploy. */}
              {liabilitiesEnabled() ? (
                <>
                  With your permission, which Plaid asks for when you connect, {BRAND.product} also reads loan details: each card&apos;s or loan&apos;s due
                  date, minimum payment, statement balance and interest rate, at most once a day. It uses them to show when each payment is due, on Future,
                  on Net worth, in your calendar reminders and to AI apps you connect, and keeps them encrypted with the rest of that bank&apos;s copy. They
                  aren&apos;t shown to your household.
                </>
              ) : (
                <>
                  Plaid also asks your permission for loan details, such as a card&apos;s due date, minimum payment and interest rate, so a future feature
                  won&apos;t need you to connect again. {BRAND.product} doesn&apos;t read them yet, and this page will say so before it does.
                </>
              )}
            </li>
            <li>Coinbase, if you connect it: your crypto balances, read-only.</li>
            <li>
              Connecting either needs a {BRAND.product} account. The connection is kept in your account, where your sign-in (and two-step sign-in, if you turn
              it on) protects it, and deleting your account removes it.
            </li>
          </Bullets>
          <p className="font-semibold text-ink-1">What you set up</p>
          <Bullets>
            <li>Your budgets and goals.</li>
            <li>
              Your household, if you join one: who is in it, which of your accounts you share with them, and the budgets and goals you keep together,
              with who changed them last.
            </li>
            <li>Things you add yourself, such as your home, a car or a loan, and what you say they&apos;re worth, stored encrypted.</li>
            {/* Home estimates are switched on by the operator (RENTCAST_API_KEY); this sentence changes with it, in the same deploy. */}
            {homeValuesEnabled() ? (
              <li>
                If you ask {BRAND.product} to keep a home&apos;s value up to date, its address, stored encrypted and never shared with your household, and
                RentCast&apos;s monthly estimates of its value.
              </li>
            ) : null}
            <li>
              History you import from a file, such as a Mint or Monarch export: the transactions you choose to import (each one&apos;s date, description,
              amount and category), stored encrypted in your account. The file itself is read on your device and never sent to {BRAND.product}.
            </li>
            <li>
              If you add a Venmo, PayPal or Cash App activity file: for each payment that matches a line from your bank, who it was to or from (another
              person&apos;s name, as that app shows it) and the note on it, stored encrypted in your account and never shown to your household. The file
              itself is read on your device and never sent to {BRAND.product}, and payments that don&apos;t match a line from your bank aren&apos;t kept.
            </li>
            <li>
              The public address of each crypto wallet you add, or for a whole Bitcoin wallet its extended public key, and what it last held, stored encrypted and never
              shared with your household. A public address is the one you&apos;d give someone to pay you, and an extended public key shows every address in a wallet:
              {BRAND.product} can see what they hold and can never move it, and never asks for a recovery phrase or private key.
            </li>
            <li>Categories you fix, such as &ldquo;everything at this shop is groceries&rdquo;, so Prism files your purchases where you put them. They name the shops, so they&apos;re stored encrypted, like your transactions.</li>
            <li>
              What you add to a transaction yourself: how you split it across categories, your tags, and who owes you for it (the name you type and the
              amount), stored encrypted in your account and never shown to your household.
            </li>
            <li>Your upcoming bills and paydays, if you turn on the calendar feed.</li>
            {alerts ? (
              <li>
                If you turn on alert emails: what you chose them to cover; what your last visit found worth one, such as a bill that may not be covered, and
                the figures for your summaries (last week&apos;s and last month&apos;s), stored encrypted; and a fingerprint of each alert sent, so none is sent twice. A fingerprint is a
                scrambled code that names no bank, shop or amount.
              </li>
            ) : null}
            {alerts ? (
              <li>
                If you turn on alerts on a phone or other device: what its browser gives {BRAND.product} to reach it (an address at its notification service,
                and the keys to encrypt messages for it), stored encrypted, and which kind of device it is, such as &ldquo;iPhone&rdquo;, so you can tell your
                devices apart.
              </li>
            ) : null}
            {alerts ? (
              <li>
                If you also leave &ldquo;Check my banks each morning&rdquo; on, {BRAND.product} reads your banks&apos; balances and new transactions once each morning,
                even when you haven&apos;t opened it, so an alert email speaks for that day. It keeps them encrypted like the rest, and never does this with Coinbase
                connected. Turn it off on the Account page and only your own visits read your banks again.
              </li>
            ) : null}
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
            {alerts ? <li>To email you alerts and summaries, and send the same alerts to your devices, if you turn them on.</li> : null}
            <li>To answer questions from AI apps you&apos;ve approved, read-only.</li>
            <li>To keep {BRAND.product} secure, prevent abuse, and fix problems.</li>
          </Bullets>
          <p>We don&apos;t sell your data, use it for advertising, or use your financial data to train AI models.</p>
        </Section>

        <Section id="share" title="Who else sees it">
          <p>Only the companies that run {BRAND.product} for us, and only what each one needs:</p>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-ctl border border-line">
            {providers(homeValuesEnabled(), chainEnabled("ethereum"), alerts).map((p) => (
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
              <span className="font-semibold text-ink-1">People in your household</span>, if you join one. They see the balances and transactions of
              the accounts you choose to share, and nothing else: not your other accounts, not your bank sign-in, and never a way into your bank. You
              can stop sharing an account, or leave the household, at any time, and it takes effect at once. If you share Coinbase, they see only
              its total value as of your last visit, and {BRAND.product} keeps that one number, sealed, only while you share it. The household&apos;s
              budgets and goals belong to the household: everyone in it sees them and can change them, and they stay with the household if you
              leave. History you import is never shared with them, even for an account you share.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Your calendar app</span>, if you subscribe to the bills feed. It reads your upcoming bills and paydays,
              and amounts only if you choose to include them.
            </li>
            {alerts ? (
              <li>
                <span className="font-semibold text-ink-1">Your browser&apos;s notification service</span>, if you turn on alerts on a device. It carries each
                alert to that device, and it&apos;s run by the company that makes your browser:{" "}
                {PUSH_SERVICES.map((p, i) => (
                  <span key={p.name}>
                    {i ? "; " : null}
                    <a href={p.policy} className={link} target="_blank" rel="noopener noreferrer">
                      {p.name}
                    </a>{" "}
                    for {p.does.replace(/\.$/, "")}
                  </span>
                ))}
                . Each alert is encrypted for your device before it leaves {BRAND.product}, so the service can&apos;t read it: it sees only that a message went
                to your device, how big it was, and when.
              </li>
            ) : null}
          </Bullets>
          <p>
            We may also share information when the law requires it, to protect someone&apos;s safety, or if {BRAND.companyShort} is ever merged or sold. In that
            case we&apos;d tell you, and this policy would keep protecting your data. We never sell or rent your personal information.
          </p>
        </Section>

        <Section id="protect" title="How we protect it">
          <Bullets>
            <li>Everything travels over encrypted connections (HTTPS).</li>
            <li>The keys that let {BRAND.product} read your banks and Coinbase, your synced transactions, and your calendar feed of bills are encrypted (AES-256) before they&apos;re stored.</li>
            <li>Our database is encrypted at rest, and every account can reach only its own data.</li>
            <li>AI apps you connect are read-only. The database itself refuses any change they try to make.</li>
            <li>Sign-in uses a one-time code sent to your email, so there&apos;s no password to steal.</li>
            <li>
              You can add two-step sign-in with an authenticator app. Then your email alone can&apos;t open your account: until the second code is entered, the
              database refuses to show or change any of your data.
            </li>
          </Bullets>
          <p>No system is perfectly secure. If a breach ever affects your information, we&apos;ll tell you as the law requires.</p>
        </Section>

        <Section id="keep" title="How long we keep it">
          <Bullets>
            <li>While you have an account, we keep your data so {BRAND.product} can show it to you.</li>
            <li>Transactions from your bank older than about two years drop out of {BRAND.product}&apos;s copy of them.</li>
            <li>History you import stays until you remove it on Connections, or delete your account.</li>
            {homeValuesEnabled() ? <li>A home&apos;s address stays until you turn off its estimates, remove the home, or delete your account.</li> : null}
            <li>A wallet&apos;s address or extended public key stays until you remove the wallet on Connections, or delete your account.</li>
            {alerts ? (
              <li>
                What&apos;s kept for your alert emails, and every device you get alerts on, is deleted the moment you turn them off. A device is also deleted
                when you stop alerts on it, or when its notification service says it no longer exists. The fingerprints of alerts already sent are deleted
                after 120 days.
              </li>
            ) : null}
            <li>
              When you delete your account, we disconnect every bank and Coinbase link first, then erase your account and everything in it. Encrypted database
              backups roll off shortly after.
            </li>
            <li>
              Using {BRAND.product} without an account keeps your budgets and goals on your device, in the cookies listed below. Clearing this site&apos;s data
              removes them. A bank or Coinbase connected on a device before connecting needed an account stays there, encrypted, until you sign in, which moves it
              into your account, or until it expires.
            </li>
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
            {alerts ? (
              <li>
                Turn alert emails on or off, and choose what they cover, on the Account page, or stop them with the link in any of them. Turn alerts on or
                off for each of your devices there too.
              </li>
            ) : null}
            <li>
              Delete your account for good on the{" "}
              <Link href="/account" className={link}>
                Account
              </Link>{" "}
              page.
            </li>
            <li>
              Download a copy of everything {BRAND.product} shows you, whenever you like, from the{" "}
              <Link href="/account#data" className={link}>
                Account
              </Link>{" "}
              page: spreadsheets of your transactions, accounts and balances, budgets and goals, and one file with all of it. It&apos;s made from your own accounts
              only, never anyone else&apos;s in your household.
            </li>
            <li>Ask us for a copy of anything else we hold about you, or to correct it, at {mail}.</li>
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
