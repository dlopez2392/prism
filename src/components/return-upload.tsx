"use client";

// src/components/return-upload.tsx
//
// Add a filed return (finance/tax-return.ts) in two steps: choose its PDF,
// then check the figures Prism found and save them. The PDF is opened here,
// in the browser, by pdf.js, and never uploaded: only its text is looked at,
// only the figures beside a handful of the 1040's lines are kept, and the
// person sees and can change every one before it's sent
// (server/return-actions.ts). A PDF with a password asks for it; one that
// isn't a 1040, or can't be read, can still be typed in by hand.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LockKeyhole } from "lucide-react";
import { buttonGhost, buttonPrimary, SelectInput, TextInput } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card, CardHeader } from "@/components/ui";
import { dollarsInput, parseDollars } from "@/lib/finance/plan";
import { FIGURE_LABELS, FILING_STATUSES, readReturn, RETURN_FIGURES, RETURN_LINES, STATUS_LABELS, type FilingStatus, type PageText, type ReadReturn, type ReturnFigure, type TaxReturn } from "@/lib/finance/tax-return";
import type { Cents } from "@/lib/finance/types";
import { saveTaxReturn } from "@/lib/server/return-actions";

/** The most of a PDF Prism reads: a return with its schedules, never a scan of a filing cabinet. */
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 60;

type Step =
  | { kind: "choose"; error: string | null }
  | { kind: "password"; file: File; wrong: boolean }
  | { kind: "check"; read: ReadReturn | null; fileName: string | null; error: string | null };

/** Every run of text on each page of the PDF, where it sits; or why it can't be read. */
async function pdfText(bytes: Uint8Array, password: string | undefined): Promise<{ pages: PageText[][] } | { password: "needed" | "wrong" } | { failed: true }> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  // Text only: no forms run and no fonts loaded (pdf.js 6 never evaluates code from a file).
  const task = pdfjs.getDocument({ data: bytes, password, disableFontFace: true, enableXfa: false, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const pages: PageText[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap((it) => ("str" in it && it.str ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : [])));
      page.cleanup();
    }
    await task.destroy();
    return { pages };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    if (e && typeof e === "object" && (e as { name?: string }).name === "PasswordException") return { password: (e as { code?: number }).code === 2 ? "wrong" : "needed" };
    return { failed: true };
  }
}

/** "85,432" or "-2,300" or "(2,300)" → cents; empty → null; anything else → undefined. */
function centsOf(raw: string, signed: boolean): Cents | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const negative = signed && /^(-|\(.*\)$)/.test(s);
  const v = parseDollars(s.replace(/^-|^\(|\)$/g, ""));
  if (v === null) return undefined;
  return negative ? -v : v;
}

export function ReturnUpload({ thisYear, years }: { thisYear: number; years: number[] }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const [busy, setBusy] = useState(false);

  async function open(file: File | undefined, password?: string) {
    if (!file) return;
    if (file.size > MAX_BYTES) return setStep({ kind: "choose", error: t("That file is over 20 MB. Choose the PDF of your return as your tax software saved it.") });
    setBusy(true);
    try {
      const r = await pdfText(new Uint8Array(await file.arrayBuffer()), password);
      if ("password" in r) return setStep({ kind: "password", file, wrong: r.password === "wrong" });
      if ("failed" in r) return setStep({ kind: "choose", error: t("That file couldn't be opened as a PDF. Choose the PDF of your return, or type the figures in yourself.") });
      const read = readReturn(r.pages);
      setStep({ kind: "check", read, fileName: file.name, error: read.found ? null : t("Prism couldn't find a Form 1040 in that file. Type the figures in from your return, or choose another file.") });
    } catch {
      setStep({ kind: "choose", error: t("That file couldn't be opened as a PDF. Choose the PDF of your return, or type the figures in yourself.") });
    } finally {
      setBusy(false);
    }
  }

  async function save(form: FormData, s: Extract<Step, { kind: "check" }>) {
    const year = Number(form.get("year"));
    const status = String(form.get("status") ?? "");
    const r: Record<string, unknown> = { year, status: FILING_STATUSES.includes(status as FilingStatus) ? status : null };
    for (const k of RETURN_FIGURES) {
      const v = centsOf(String(form.get(k) ?? ""), k === "business");
      if (v === undefined) return setStep({ ...s, error: t("{figure} isn't an amount. Use digits, like 85,432.", { figure: t(FIGURE_LABELS[k]) }) });
      r[k] = v;
    }
    setBusy(true);
    const result = await saveTaxReturn(r as TaxReturn);
    setBusy(false);
    if (result.status === "error") return setStep({ ...s, error: result.message });
    router.push("/taxes");
  }

  if (step.kind === "choose") {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader title={t("Choose your return")} subtitle={t("The PDF your tax software saved when you filed: TurboTax, H&R Block, FreeTaxUSA or any other. It's opened on this device and never uploaded.")} />
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <input ref={input} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => open(e.currentTarget.files?.[0])} />
          <button type="button" className={buttonPrimary} disabled={busy} onClick={() => input.current?.click()}>
            <FileUp aria-hidden className="size-4" />
            {busy ? t("Reading your return…") : t("Choose a PDF")}
          </button>
          <button type="button" className={buttonGhost} disabled={busy} onClick={() => setStep({ kind: "check", read: null, fileName: null, error: null })}>
            {t("Type the figures in yourself")}
          </button>
        </div>
        {step.error ? (
          <p role="alert" className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm font-medium text-crit-ink">
            {step.error}
          </p>
        ) : null}
        <p className="mt-4 text-xs text-ink-3">
          {t("Only the figures on a few lines of your Form 1040 are kept, after you check them: never your name, Social Security number, address, dependents or bank details.")}
        </p>
      </Card>
    );
  }

  if (step.kind === "password") {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader title={t("This PDF has a password")} subtitle={t("Type the password you set when you saved it. It's used on this device to open the file, and never sent or kept.")} />
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void open(step.file, String(new FormData(e.currentTarget).get("password") ?? ""));
          }}
        >
          <label className="block flex-1">
            <span className="mb-1 flex items-center gap-1 text-[13px] font-semibold text-ink-2">
              <LockKeyhole aria-hidden className="size-3.5" />
              {t("PDF password")}
            </span>
            <input name="password" type="password" autoComplete="off" autoFocus className="h-10 w-full rounded-ctl border border-line-strong bg-surface-2 px-3 text-sm text-ink-1 focus:border-[var(--focus)]" />
          </label>
          <button type="submit" className={buttonPrimary} disabled={busy}>
            {busy ? t("Reading your return…") : t("Open it")}
          </button>
          <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
            {t("Choose another file")}
          </button>
        </form>
        {step.wrong ? (
          <p role="alert" className="mt-3 text-sm font-medium text-crit-ink">
            {t("That password didn't open it. Try again.")}
          </p>
        ) : null}
      </Card>
    );
  }

  const found = step.read?.figures;
  const year = step.read?.year ?? thisYear - 1;
  const yearOptions = [...new Set([thisYear, thisYear - 1, thisYear - 2, thisYear - 3, ...years, year])].filter((y) => y <= thisYear && y >= 2000).sort((a, b) => b - a);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t("Check the figures")}
        subtitle={
          step.fileName && step.read?.found
            ? t("From {file}. Check each one against your return: change any that's wrong, and leave blank any your return doesn't have.", { file: step.fileName })
            : t("Type each one from your Form 1040. Leave blank any your return doesn't have.")
        }
      />
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(new FormData(e.currentTarget), step);
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectInput name="year" label={t("Tax year")} showLabel defaultValue={String(year)} options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))} />
          <SelectInput
            name="status"
            label={t("Filing status")}
            showLabel
            defaultValue={step.read?.status ?? ""}
            options={[{ value: "", label: t("Not sure") }, ...FILING_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABELS[s]) }))]}
          />
          {RETURN_FIGURES.map((k) => (
            <TextInput
              key={k}
              name={k}
              label={t(FIGURE_LABELS[k])}
              inputMode="text"
              defaultValue={found?.[k] !== null && found?.[k] !== undefined ? `${found[k]! < 0 ? "-" : ""}${Number(dollarsInput(Math.abs(found[k]!))).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
              hint={k === "business" ? t("Schedule 1, line {line}", { line: "3" }) : t("Line {line}", { line: RETURN_LINES[k] })}
            />
          ))}
        </div>
        {step.error ? (
          <p role="alert" className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm font-medium text-crit-ink">
            {step.error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" className={buttonPrimary} disabled={busy}>
            {busy ? t("Saving…") : t("Save these figures")}
          </button>
          <button type="button" className={buttonGhost} onClick={() => setStep({ kind: "choose", error: null })}>
            {t("Choose another file")}
          </button>
        </div>
      </form>
    </Card>
  );
}
