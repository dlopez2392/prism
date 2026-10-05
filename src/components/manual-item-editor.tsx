"use client";

// src/components/manual-item-editor.tsx
//
// "Add something you own or owe" on Net worth — a home, a vehicle, anything
// else of value, or money owed — and the same form to update its value,
// rename it or remove it. Saved to the person's account; each update becomes
// that month's value, so its trend line and "12 mo" change stay honest.
// Removing asks once, because an item's history can't be brought back.
// A home can have RentCast keep its value up to date (`estimates`, when the
// operator has switched it on): the person ticks it and gives the address,
// told first exactly what is sent, to whom, and how often.
//
// The way in is `AddWhatYouOwn`, a card of one tile per kind on Net worth
// (each opens the form with its kind chosen), which a link ending
// #add-home, -vehicle, -debt or -asset opens too (`addLink`). The small Add
// beside the accounts list is the same form, for whoever is already there.

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Car, CircleCheck, Gem, HandCoins, House, Plus, Trash2, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, MoneyInput, TextInput } from "@/components/dialog";
import { Card, CardHeader } from "@/components/ui";
import { money0, shortDate } from "@/lib/finance/format";
import { ADDRESS_MAX, type HomeValuation } from "@/lib/finance/home-value";
import { addKindFromHash, MANUAL_KINDS, MANUAL_NAME_MAX, type ManualItem, type ManualKind } from "@/lib/finance/manual";
import { dollarsInput, IDLE, type PlanFormState } from "@/lib/finance/plan";
import { deleteManualItem, saveManualItem } from "@/lib/server/manual-actions";

const ICONS: Record<ManualKind, LucideIcon> = { home: House, vehicle: Car, asset: Gem, debt: HandCoins };
const KINDS = Object.keys(MANUAL_KINDS) as ManualKind[];

/** The "Add" button, with its dialog and the line that says what was saved. */
export function AddManualItem({ estimates = false }: { estimates?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-y-1">
      {/* Always in the DOM so screen readers announce it; spaced only when it speaks. */}
      <p role="status" className={clsx("flex items-center gap-1 text-xs font-semibold text-good-ink", notice && "mr-3")}>
        {notice ? (
          <>
            <CircleCheck aria-hidden className="size-3.5" />
            {notice}
          </>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => {
          setSession((s) => s + 1);
          setNotice(null);
          dialog.current?.showModal();
        }}
        className={buttonSmall}
      >
        <Plus aria-hidden className="size-4" />
        Add
      </button>
      <ManualDialog dialogRef={dialog} session={session} estimates={estimates} onDone={setNotice} />
    </div>
  );
}

/** Each tile, in the order people think of them: what it adds, in a few words. */
const TILES: { kind: ManualKind; label: string; hint: (estimates: boolean) => string }[] = [
  { kind: "home", label: "Add your home", hint: (estimates) => (estimates ? "Its value kept up to date by RentCast" : "Update its value whenever it changes") },
  { kind: "vehicle", label: "Add a vehicle", hint: () => "A car, truck or motorcycle" },
  { kind: "debt", label: "Add money you owe", hint: () => "A loan from family, or one your bank doesn't show" },
  { kind: "asset", label: "Add something else", hint: () => "Jewelry, art, a share in a business" },
];

/**
 * Everything a bank can't report, on Net worth: a tile per kind, each opening
 * the form with that kind chosen, and a link ending #add-<kind> opens it on
 * arrival. `added` is how many the person has already, which changes only
 * what the card says.
 */
export function AddWhatYouOwn({ estimates = false, added = 0 }: { estimates?: boolean; added?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [kind, setKind] = useState<ManualKind>("home");
  const [notice, setNotice] = useState<string | null>(null);
  const open = (k: ManualKind) => {
    setKind(k);
    setSession((s) => s + 1);
    setNotice(null);
    dialog.current?.showModal();
  };

  // Read after hydration (the server never sees a fragment), and again whenever the fragment changes.
  useEffect(() => {
    const fromLink = () => {
      // A link to the card itself (Overview's "Add your home or car") lands on it, at any width: the page may still be streaming in when the browser looks for it.
      if (window.location.hash === "#add") document.getElementById("add")?.scrollIntoView({ block: "start" });
      const k = addKindFromHash(window.location.hash);
      if (!k) return;
      // Once: a refresh, or coming Back, doesn't open it again.
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      setKind(k);
      setSession((s) => s + 1);
      setNotice(null);
      dialog.current?.showModal();
    };
    fromLink();
    window.addEventListener("hashchange", fromLink);
    return () => window.removeEventListener("hashchange", fromLink);
  }, []);

  return (
    <Card id="add" className="scroll-mt-24 p-5 sm:p-6">
      <CardHeader
        title={added ? "Add more of what you own or owe" : "Add what your bank can't see"}
        subtitle={
          added
            ? `You've added ${added}. Anything else a bank doesn't report counts too.`
            : "Your home, a car, a loan from family: add them and your net worth counts everything you own and owe, not just your accounts."
        }
      />
      {/* Always in the DOM so screen readers announce it; drawn only when it speaks. */}
      <p role="status" className={clsx("flex items-center gap-1 text-xs font-semibold text-good-ink", notice && "mt-3")}>
        {notice ? (
          <>
            <CircleCheck aria-hidden className="size-3.5" />
            {notice}
          </>
        ) : null}
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <li key={t.kind}>
              <button
                type="button"
                onClick={() => open(t.kind)}
                className="flex h-full w-full flex-col items-start gap-2 rounded-ctl border border-line bg-surface-2 p-3.5 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] sm:p-4"
              >
                <span className="grid size-9 place-items-center rounded-ctl bg-accent-soft text-accent">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <span className="text-sm font-bold text-ink-1">{t.label}</span>
                <span className="text-xs text-ink-3">{t.hint(estimates)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ManualDialog dialogRef={dialog} session={session} kind={kind} estimates={estimates} onDone={setNotice} />
    </Card>
  );
}

/** A Net worth row for something the person added: the whole row opens it for editing. */
export function ManualItemRow({
  item,
  label,
  children,
  estimates = false,
  valuation,
}: {
  item: ManualItem;
  label: string;
  children: ReactNode;
  estimates?: boolean;
  valuation?: HomeValuation;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          setSession((s) => s + 1);
          setNotice(null);
          dialog.current?.showModal();
        }}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-ctl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        {children}
      </button>
      {/* The row itself shows the change; this tells a screen reader. */}
      <span role="status" className="sr-only">
        {notice}
      </span>
      <ManualDialog dialogRef={dialog} session={session} item={item} estimates={estimates} valuation={valuation} onDone={setNotice} />
    </>
  );
}

function ManualDialog({
  dialogRef,
  session,
  item,
  kind,
  estimates,
  valuation,
  onDone,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  session: number;
  item?: ManualItem;
  /** The kind chosen to start with, for something new. */
  kind?: ManualKind;
  estimates: boolean;
  valuation?: HomeValuation;
  onDone: (message: string) => void;
}) {
  return (
    <Dialog
      dialogRef={dialogRef}
      title={item ? item.name : "Add something you own or owe"}
      description={item ? "Update its value whenever it changes. Prism keeps the trend." : "A home, a car, a loan from family: anything a bank doesn't report, so your net worth is the whole picture."}
      icon={item ? ICONS[item.kind] : Plus}
    >
      <ManualForm
        key={session}
        item={item}
        initialKind={kind}
        estimates={estimates}
        valuation={valuation}
        onDone={(message) => {
          onDone(message);
          dialogRef.current?.close();
        }}
        onCancel={() => dialogRef.current?.close()}
      />
    </Dialog>
  );
}

function ManualForm({
  item,
  initialKind,
  estimates,
  valuation,
  onDone,
  onCancel,
}: {
  item?: ManualItem;
  initialKind?: ManualKind;
  estimates: boolean;
  valuation?: HomeValuation;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = form.get("intent") === "delete" ? await deleteManualItem(prev, form) : await saveManualItem(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const [kind, setKind] = useState<ManualKind>(item?.kind ?? initialKind ?? "home");
  const [confirming, setConfirming] = useState(false);
  const [estimate, setEstimate] = useState(valuation !== undefined);
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  const meta = MANUAL_KINDS[kind];
  const offersEstimate = estimates && kind === "home";
  const estimating = offersEstimate && estimate;

  // By hand, not <form action>: React resets a form after its action, which
  // would throw away everything typed whenever a save needs a correction.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  function remove() {
    const form = new FormData();
    form.set("intent", "delete");
    form.set("id", item?.id ?? "");
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink-2">What is it?</legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => {
              const Icon = ICONS[k];
              return (
                <label key={k} className="relative">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="peer sr-only" />
                  <span className="flex min-h-12 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
                    <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                    <span className="min-w-0 leading-tight">{MANUAL_KINDS[k].label}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.kind ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.kind}</p> : null}
        </fieldset>
        <TextInput name="name" label="Name" defaultValue={item?.name ?? ""} maxLength={MANUAL_NAME_MAX} error={errors.name} hint={`For example, “${meta.placeholder}”.`} />
        {offersEstimate ? (
          <div className="rounded-ctl border border-line bg-surface-2 p-3">
            <label className="flex items-start gap-2.5 text-sm text-ink-1">
              <input type="checkbox" name="estimate" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-button" />
              <span>
                <span className="font-semibold">Keep its value up to date with RentCast</span>
                <span className="mt-0.5 block text-xs text-ink-2">
                  Once a month Prism sends the address, and nothing else about you, to RentCast, a property-data company, for an estimate of what the home is worth. The address is kept encrypted in your
                  account and never shared with your household.
                </span>
              </span>
            </label>
            {estimate ? (
              <div className="mt-3">
                <TextInput
                  name="address"
                  label="Address"
                  defaultValue={valuation?.address ?? ""}
                  maxLength={ADDRESS_MAX}
                  autoComplete="street-address"
                  error={errors.address}
                  hint="Street, city, state and ZIP code, like 12 Maple Ct, Austin, TX 78701."
                />
                {valuation?.estimate ? (
                  <p className="mt-2 text-xs text-ink-3">
                    Last estimate, {shortDate(valuation.estimate.on)}: between {money0(valuation.estimate.low)} and {money0(valuation.estimate.high)}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <MoneyInput
          key={estimating ? "estimating" : "own"}
          name="value"
          label={meta.owed ? "How much you owe today" : "What it's worth today"}
          defaultValue={item && !estimating ? dollarsInput(item.values.at(-1)!.value) : ""}
          placeholder={estimating ? "RentCast's estimate" : meta.owed ? "5,000" : "350,000"}
          error={errors.value}
          hint={
            estimating
              ? "Leave it blank to use RentCast's estimate, or enter your own for this month."
              : item
                ? "Saved as this month's value; earlier months keep theirs."
                : undefined
          }
        />
      </div>

      <FormMessage state={state} />

      {confirming ? (
        <div role="alert" className="mt-5 rounded-ctl border border-line-strong bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink-1">Remove “{item?.name}”? Its history goes with it.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-3.5 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60">
              <Trash2 aria-hidden className="size-4" />
              {pending ? "Removing…" : "Remove it"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonSmall}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {item && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-crit-ink hover:underline">
            <Trash2 aria-hidden className="size-4" />
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={buttonGhost}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={clsx(buttonPrimary, "min-w-24")}>
            {pending ? "Saving…" : item ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
