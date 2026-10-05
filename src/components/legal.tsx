// src/components/legal.tsx — the building blocks of Prism's legal pages
// (/privacy, /terms): a "short version" card, sections with anchor ids,
// and plain bullets. Both pages read the same way, so someone who
// has read one knows how to read the other, and their Spanish translations
// are built from the same blocks, with the same anchors.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";

/** The link style legal pages use in running text. */
export const legalLink = "font-semibold text-accent-ink hover:underline";

export function ShortVersion({ items, title = "The short version" }: { items: { icon: LucideIcon; text: string }[]; title?: string }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[15px] font-bold tracking-tight text-ink-1">{title}</h2>
      <ul className="mt-3 space-y-2.5">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm text-ink-1">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
              <Icon className="size-4" />
            </span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="text-lg font-bold tracking-tight text-ink-1">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-3">{children}</ul>;
}
