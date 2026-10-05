"use client";

// src/components/skeletons.tsx
//
// Loading = skeletons shaped like the content (DESIGN.md rule 5). Each
// screen's loading.tsx lays these out the way the screen itself is laid out,
// so what shows while money loads is the shape of what's coming — never a
// chart where a list will be, or a list where the legal text will be.

import clsx from "clsx";
import type { ReactNode } from "react";
import { useT } from "@/components/locale";

/** The whole placeholder: announced once to assistive tech, silent otherwise. `label` is English, said in the page's language. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  const t = useT();
  return (
    <div aria-busy="true" aria-label={t(label)} className="space-y-5">
      {children}
    </div>
  );
}

export function Bone({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

/** The page header: eyebrow, title, subtitle and, where the screen has one, its action. */
export function Header({ eyebrow = false, action = false }: { eyebrow?: boolean; action?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        {eyebrow ? <Bone className="h-3 w-28" /> : null}
        <Bone className="h-8 w-48" />
        <Bone className="h-4 w-72 max-w-[80vw]" />
      </div>
      {action ? <Bone className="h-9 w-36" /> : null}
    </div>
  );
}

/** A card's outline, holding bones shaped like its contents. */
export function Frame({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={clsx("rounded-card border border-line bg-surface-1 p-5 shadow-card sm:p-6", className)}>{children}</div>;
}

/** A card-sized block: the hero, or a chart card, before anything inside it is known. */
export function Block({ className }: { className?: string }) {
  return <Bone className={clsx("rounded-card", className)} />;
}

/** A card title and its subtitle. */
export function CardTitle() {
  return (
    <div className="space-y-2">
      <Bone className="h-5 w-40" />
      <Bone className="h-3 w-56 max-w-full" />
    </div>
  );
}

/** List rows: a mark (icon, initial or ring), two lines of text, a figure on the right. */
export function Rows({ count, mark = "size-10" }: { count: number; mark?: string }) {
  return (
    <ul className="mt-5 space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3">
          <Bone className={clsx("shrink-0", mark)} />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-4 w-2/5" />
            <Bone className="h-3 w-3/5" />
          </div>
          <Bone className="h-4 w-16 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** Paragraphs of prose, for the legal pages. */
export function Prose({ sections }: { sections: number }) {
  return (
    <Frame className="space-y-7 sm:p-8">
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="space-y-2.5">
          <Bone className="h-5 w-48" />
          <Bone className="h-3.5 w-full" />
          <Bone className="h-3.5 w-11/12" />
          <Bone className="h-3.5 w-4/5" />
        </div>
      ))}
    </Frame>
  );
}

/** One card in the middle of the page: sign-in, the second step, consent. */
export function CenteredCard() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <Frame className="space-y-4">
        <Bone className="size-10" />
        <Bone className="h-7 w-48" />
        <Bone className="h-4 w-full" />
        <Bone className="h-11 w-full" />
        <Bone className="h-10 w-full" />
      </Frame>
    </div>
  );
}
