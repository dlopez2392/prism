// src/lib/i18n/es/calendar.ts — the calendar file itself (finance/calendar.ts):
// the events Google, Apple or Outlook show for each bill, payday and card or
// loan payment, their notes, and the calendar's own name. Voice and glossary
// as at the top of core.ts and future.ts: payday "día de pago" · statement
// balance "saldo del estado de cuenta" · minimum "mínimo" · due "vence". A
// title is short, since it shows on a lock screen; the notes say the rest.

export const CALENDAR: Record<string, string> = {
  "A snapshot from {date}. Download it again from {product} to refresh.": "Una copia del {date}. Descárgala de nuevo desde {product} para actualizarla.",
  "Based on the last {n} charges.": "Según los últimos {n} cargos.",
  "Based on the last {n} deposits.": "Según los últimos {n} depósitos.",
  "Bills, subscriptions and paydays {product} found repeating. Information, not financial advice.":
    "Facturas, suscripciones y días de pago que {product} encontró que se repiten. Es información, no asesoría financiera.",
  "Expected in: {amount} · {account} · {every}.": "Entrada esperada: {amount} · {account} · {every}.",
  "Expected in: {amount} · {every}.": "Entrada esperada: {amount} · {every}.",
  "Expected out: {amount} · {account} · {every}.": "Salida esperada: {amount} · {account} · {every}.",
  "Expected out: {amount} · {every}.": "Salida esperada: {amount} · {every}.",
  "From your lender. The next statement brings the next due date.": "Según tu prestamista. El próximo estado de cuenta trae la próxima fecha de pago.",
  "Payday: {name}": "Día de pago: {name}",
  Paydays: "Días de pago",
  "Payment due.": "Vence un pago.",
  "Payment due: {owed}.": "Vence un pago: {owed}.",
  "See what's coming up: {url}": "Mira lo que viene: {url}",
  "The amount changes from one time to the next; this is the typical recent charge.": "El monto cambia de una vez a otra; este es el cargo reciente típico.",
  "The price went up from {from} to {to} on {date}.": "El precio subió de {from} a {to} el {date}.",
  "This calendar updates itself.": "Este calendario se actualiza solo.",
  Transfers: "Transferencias",
  "every month": "cada mes",
  "every three months": "cada tres meses",
  "every two weeks": "cada dos semanas",
  "every week": "cada semana",
  "every year": "cada año",
  "minimum {amount}": "mínimo {amount}",
  "statement balance {amount}": "saldo del estado de cuenta {amount}",
  "twice a month": "dos veces al mes",
  "twice a year": "dos veces al año",
  "{account} payment due": "Vence el pago de {account}",
  "{account} payment due · {amount} min": "Vence el pago de {account} · mín. {amount}",
  "{product} demo: bills": "{product} (ejemplo): facturas",
  "{product} demo: bills & paydays": "{product} (ejemplo): facturas y días de pago",
  "{product}: bills": "{product}: facturas",
  "{product}: bills & paydays": "{product}: facturas y días de pago",
};
