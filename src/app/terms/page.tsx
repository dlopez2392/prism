// src/app/terms/page.tsx — Prism's Terms of Service.
//
// Written in plain words from what Prism does, like the privacy policy, and
// checked against the code the same way: the facts it rests on live in
// src/lib/terms.ts, and terms.test.ts fails if Prism asks a bank or Coinbase
// for anything that isn't read-only, or for accounts outside the United
// States. When the Terms change in substance, TERMS_UPDATED moves too.
//
// DESIGN.md rule 10 exception: people must agree to Plaid's End User Privacy
// Policy before connecting a bank, so this page names Plaid (and Coinbase).

import type { Metadata } from "next";
import Link from "next/link";
import { Info, KeyRound, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { Bullets, legalLink as link, Section, ShortVersion } from "@/components/legal";
import { Card, PageHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { LIABILITY_FLOOR_USD, MINIMUM_AGE, SECURITY_POLICY_URL, SHUTDOWN_NOTICE_DAYS, TERMS_CONTACT, TERMS_UPDATED } from "@/lib/terms";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The agreement between you and ${BRAND.company} for using ${BRAND.product}, in plain words.`,
};

const SHORT_VERSION: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Prism shows you your money. It can read your accounts but can never move money." },
  { icon: Info, text: "It's information, not financial advice. The decisions are yours." },
  { icon: KeyRound, text: "Your email is the key to your account. Keep it safe, and turn on two-step sign-in for more protection." },
  { icon: ShieldCheck, text: "Your data stays yours. We never sell it." },
  { icon: Trash2, text: "Leave any time. Deleting your account disconnects everything, then erases your data." },
];

export default function TermsPage() {
  const mail = (
    <a href={`mailto:${TERMS_CONTACT}`} className={link}>
      {TERMS_CONTACT}
    </a>
  );
  const privacy = (
    <Link href="/privacy" className={link}>
      privacy policy
    </Link>
  );
  const account = (
    <Link href="/account" className={link}>
      Account
    </Link>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Legal" title="Terms of Service" subtitle={`Last updated ${TERMS_UPDATED}. The agreement for using ${BRAND.product}, in plain words.`} />

      <ShortVersion items={SHORT_VERSION} />

      <Card as="article" className="mt-5 space-y-6 p-5 sm:p-8">
        <Section id="agree" title="Agreeing to these terms">
          <p>
            These terms are an agreement between you and {BRAND.company} ({BRAND.companyShort}, &ldquo;we&rdquo; and &ldquo;us&rdquo;) about using {BRAND.product}.
            By creating an account, or by using {BRAND.product} at all, you agree to them. If you don&apos;t agree, please don&apos;t use {BRAND.product}.
          </p>
          <p>Our {privacy} explains what we collect, how we use it and who else sees it. It&apos;s part of this agreement.</p>
        </Section>

        <Section id="who" title="Who can use Prism">
          <Bullets>
            <li>
              To create an account or connect accounts, you must be at least {MINIMUM_AGE} and live in the United States. Anyone can look around the demo
              household.
            </li>
            <li>{BRAND.product} is for your own personal use, not for running a business or managing other people&apos;s money for pay.</li>
            <li>Only connect accounts that are yours, or that you&apos;re allowed to view.</li>
          </Bullets>
        </Section>

        <Section id="what" title="What Prism is, and isn't">
          <p>
            {BRAND.product} shows you your balances, spending, budgets, goals, bills and forecasts, in one place. It only reads your accounts. It can never move
            money, pay bills, open accounts or make trades.
          </p>
          <p>
            {BRAND.product} isn&apos;t a bank, a broker, a financial adviser or a credit bureau. What it shows you is information, not financial, investment, tax
            or legal advice. Forecasts, insights and suggested budgets are estimates based on your past transactions, and they can be wrong. For big decisions,
            talk to a qualified professional.
          </p>
          <p>
            Your numbers come from your banks and other companies, through the providers named below. They can be late, incomplete or wrong. Before you rely on
            one, such as a balance before a payment, check it with your bank.
          </p>
        </Section>

        <Section id="account" title="Your account">
          <Bullets>
            <li>
              You sign in with a one-time code sent to your email. That makes your email the key to your account: anyone who can read it can sign in, unless you
              turn on two-step sign-in on the {account} page. Keep your email account secure.
            </li>
            <li>You&apos;re responsible for what happens in your account. If you think someone else got in, email {mail} right away.</li>
            <li>
              For your protection, we may ask you to prove the account is yours before we act on a request, such as removing two-step sign-in, and we may say
              no if you can&apos;t.
            </li>
          </Bullets>
        </Section>

        <Section id="connect" title="Connecting your accounts">
          <p>You choose what to connect, and you can disconnect anything, any time.</p>
          <Bullets>
            <li>
              Connecting a bank or Coinbase needs a {BRAND.product} account, so every connection is kept in your account, protected by your sign-in, and removed
              when you delete the account.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Banks, cards, loans and investments</span> connect through Plaid. By connecting one, you authorize{" "}
              {BRAND.product} and Plaid to get your information from that institution for you, and you agree that Plaid handles it under{" "}
              <a href="https://plaid.com/legal/#end-user-privacy-policy" className={link} target="_blank" rel="noopener noreferrer">
                Plaid&apos;s End User Privacy Policy
              </a>
              . You sign in to your bank through Plaid, and {BRAND.product} never sees your bank password.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Coinbase</span>, if you connect it, gives {BRAND.product} permission to read your balances, and nothing
              else. You can take that permission back in {BRAND.product} or at Coinbase.
            </li>
            <li>
              Your own agreements with your banks and Coinbase still apply. {BRAND.product} doesn&apos;t control those companies, and isn&apos;t responsible for
              their services or for a connection they stop supporting.
            </li>
          </Bullets>
        </Section>

        <Section id="household" title="Sharing with your household">
          <Bullets>
            <li>
              You can invite up to three other adults to a household. Each of you keeps your own {BRAND.product} account, and nothing you&apos;ve
              connected is shared until you choose to share it.
            </li>
            <li>
              Share only accounts you have the right to share. For an account you hold with someone else, share it only if they agree. The people you
              share with see that account&apos;s balances and transactions; they never get a way into your bank.
            </li>
            <li>
              A household can keep budgets and goals together. Everyone in it sees them and can change them, and {BRAND.product} shows who changed each
              list last. They belong to the household, so they stay with it when someone leaves, and go when its last member does.
            </li>
            <li>You can stop sharing an account, or leave the household, at any time. Leaving stops everything you shared at once.</li>
          </Bullets>
        </Section>

        <Section id="apps" title="AI apps and your calendar">
          <Bullets>
            <li>
              If you connect an AI app, such as Claude or ChatGPT, you authorize it to read your {BRAND.product} information to answer your questions. It can
              never change anything. That company&apos;s own terms and privacy policy cover what it does with what it reads. AI answers can be wrong, so check
              anything important. Disconnect an app any time on the {account} page.
            </li>
            <li>
              If you turn on the calendar feed, anyone with its private link can see what it includes. Keep the link to yourself, and reset it if it gets out.
            </li>
          </Bullets>
        </Section>

        <Section id="use" title="Using Prism fairly">
          <p>Please don&apos;t:</p>
          <Bullets>
            <li>get into anyone else&apos;s account or data, or try to;</li>
            <li>overload, disrupt or scrape {BRAND.product}, or get around its limits or security;</li>
            <li>copy {BRAND.product} to build a competing service, or resell access to it;</li>
            <li>use {BRAND.product} for anything illegal, or to harm or deceive anyone.</li>
          </Bullets>
          <p>
            Found a security problem? We welcome reports made in good faith and within the limits of our{" "}
            <a href={SECURITY_POLICY_URL} className={link} target="_blank" rel="noopener noreferrer">
              security policy
            </a>
            .
          </p>
        </Section>

        <Section id="data" title="Your data">
          <p>
            Your data is yours. You let us handle it only to run {BRAND.product} for you, as our {privacy} describes, and that permission ends when you delete
            your account. We never sell your data. If you send us ideas or feedback, we may use them without owing you anything for them.
          </p>
        </Section>

        <Section id="cost" title="What it costs">
          <p>
            {BRAND.product} doesn&apos;t charge you anything today. If we ever offer paid features, we&apos;ll show you the price first, and you&apos;ll only pay if
            you choose to.
          </p>
        </Section>

        <Section id="ours" title="Prism itself">
          <p>
            {BRAND.product}, its name, design and software belong to {BRAND.companyShort}. We give you a personal permission to use {BRAND.product} under these
            terms, which you can&apos;t transfer to anyone else. {BRAND.product}&apos;s source code is published so anyone can see how it protects your data, but
            publishing it gives no permission to copy or reuse it.
          </p>
        </Section>

        <Section id="changes" title="Changes, and keeping Prism running">
          <Bullets>
            <li>
              We keep improving {BRAND.product}, so features may change or go away. We work to keep it running, but it may sometimes be unavailable, for example
              for maintenance or when a provider has an outage.
            </li>
            <li>
              If we ever shut {BRAND.product} down, we&apos;ll tell you at least {SHUTDOWN_NOTICE_DAYS} days ahead where we can, and your data will be deleted as
              our {privacy} describes.
            </li>
            <li>
              When these terms change, the date at the top changes too. If a change matters, we&apos;ll tell you in the app or by email before it takes effect.
              Using {BRAND.product} after that means you accept the new terms. If you don&apos;t, you can delete your account.
            </li>
          </Bullets>
        </Section>

        <Section id="ending" title="Ending your account">
          <p>
            You can delete your account any time on the {account} page. We disconnect every bank and Coinbase link first, then erase your account and everything
            in it.
          </p>
          <p>
            We may suspend or close an account that breaks these terms, puts other people or {BRAND.product} at risk, or when the law requires it. We&apos;ll tell
            you why when we can. The parts of these terms that are meant to last, such as the limits below, still apply afterwards.
          </p>
        </Section>

        <Section id="warranty" title="Disclaimers">
          <p>
            We work hard to make {BRAND.product} accurate and reliable, but we provide it &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; As far as the law
            allows, we don&apos;t promise that it will always be available, error-free or accurate, or that it fits any particular purpose. Some places don&apos;t
            allow these disclaimers, so some may not apply to you.
          </p>
        </Section>

        <Section id="liability" title="Limits on our liability">
          <p>
            As far as the law allows, {BRAND.companyShort} isn&apos;t liable for indirect, incidental, special, consequential or punitive losses, or for lost
            profits or data. That includes losses from decisions made using {BRAND.product}&apos;s information, and from what your banks, Plaid, Coinbase or AI apps
            you connect do or fail to do.
          </p>
          <p>
            As far as the law allows, our total liability for any claim is limited to the greater of what you paid us in the 12 months before the claim or $
            {LIABILITY_FLOOR_USD}. Nothing in these terms limits liability for fraud, gross negligence or intentional misconduct, or anything else the law
            doesn&apos;t allow us to limit.
          </p>
        </Section>

        <Section id="disputes" title="If something goes wrong">
          <p>
            Please talk to us first: email {mail}, and we&apos;ll try to put it right within 30 days. These terms are governed by the laws of Texas and the United
            States. A dispute that isn&apos;t resolved goes to the state or federal courts in Texas, unless the law where you live gives you the right to bring it
            there. Either of us may also use small-claims court.
          </p>
        </Section>

        <Section id="notices" title="How we reach you">
          <p>
            You agree that we can send you notices, including sign-in codes, security alerts and changes to these terms, by email to your account&apos;s address or
            in {BRAND.product}, and that they count as being in writing.
          </p>
        </Section>

        <Section id="general" title="The rest">
          <Bullets>
            <li>These terms and our {privacy} are the whole agreement between you and us about {BRAND.product}.</li>
            <li>If part of these terms can&apos;t be enforced, the rest still applies.</li>
            <li>If we don&apos;t enforce a term right away, we haven&apos;t given it up.</li>
            <li>You can&apos;t transfer your account or these terms to someone else. We may transfer them if {BRAND.companyShort} is merged or sold.</li>
          </Bullets>
        </Section>

        <Section id="contact" title="Contact us">
          <p>
            Questions about these terms: email {mail}. {BRAND.company}.
          </p>
        </Section>
      </Card>
    </div>
  );
}
