// src/lib/i18n/es/estimated-tax.ts — Spanish for estimated tax: the card on
// Taxes, the check-in item and the calendar events. In the voice and glossary
// of core.ts. "Impuesto estimado" and "pagos estimados" as the IRS's Spanish
// pages say them; the safe harbor is "la regla de puerto seguro", its name in
// the IRS's Spanish edition of Form 2210's instructions; "irs.gov/payments"
// stays as written, it's an address.

export const ESTIMATED_TAX: Record<string, string> = {
  "About {amount} a quarter under the safe-harbor rule, with withholding like last year's. What you owe depends on this year's income.":
    "Unos {amount} por trimestre según la regla de puerto seguro, con retenciones como las del año pasado. Lo que debes depende de tu ingreso de este año.",
  "Add last year's return and Prism shows what each date asks for under the safe-harbor rule.":
    "Agrega tu declaración del año pasado y Prism muestra lo que pide cada fecha según la regla de puerto seguro.",
  "Add last year's return in Prism to see what the safe-harbor rule asks for.": "Agrega tu declaración del año pasado en Prism para ver lo que pide la regla de puerto seguro.",
  "By then": "Para esa fecha",
  Due: "Vence",
  "Due soon": "Vence pronto",
  "Estimated tax": "Impuesto estimado",
  "Estimated tax due (payment {n} of 4 for {year})": "Vence el impuesto estimado (pago {n} de 4 de {year})",
  "Estimated tax due dates for {year}": "Fechas de vencimiento del impuesto estimado de {year}",
  "Estimated tax for {year}": "Impuesto estimado de {year}",
  "Estimated tax payment due {date}": "Pago de impuesto estimado vence el {date}",
  "Last year's withholding ({withheld}) already covered the safe-harbor amount ({amount}). If this year's is about the same, there may be nothing to pay.":
    "Las retenciones del año pasado ({withheld}) ya cubrieron el monto de puerto seguro ({amount}). Si las de este año son parecidas, puede que no haya nada que pagar.",
  "No payment seen": "No se ve ningún pago",
  "Not counted: {amount} paid on {date}, last year's balance due. ": "No se cuenta: {amount} pagado el {date}, el saldo del año pasado. ",
  "Paid by then": "Pagado para esa fecha",
  "Pay at irs.gov/payments. Prism never pays anything.": "Paga en irs.gov/payments. Prism nunca paga nada.",
  "Paying {amount} in all for {year}, {share} of your {last} total tax, generally avoids an underpayment penalty. With withholding like last year's ({withheld}), that leaves about {quarter} a quarter.":
    "Pagar {amount} en total para {year}, el {share} de tu impuesto total de {last}, por lo general evita una multa por pago insuficiente. Con retenciones como las del año pasado ({withheld}), quedan unos {quarter} por trimestre.",
  "Payment seen": "Pago visto",
  "Prism counts payments to the IRS from your linked accounts. One made by check, or from an account that isn't linked, isn't here. Pay at irs.gov/payments; Prism never pays anything.":
    "Prism cuenta los pagos al IRS desde tus cuentas conectadas. Uno hecho con cheque, o desde una cuenta que no está conectada, no aparece aquí. Paga en irs.gov/payments; Prism nunca paga nada.",
  "See the year: {url}": "Mira el año: {url}",
  Status: "Estado",
  "Taxes shows the year's four dates and what Prism has seen paid to the IRS.": "Impuestos muestra las cuatro fechas del año y lo que Prism ha visto pagado al IRS.",
  "Under the safe-harbor rule, about {amount} more by then, with withholding like last year's.":
    "Según la regla de puerto seguro, unos {amount} más para esa fecha, con retenciones como las del año pasado.",
  "A week before each quarterly IRS due date, if you pay estimated tax and Prism hasn't seen this quarter's payment.":
    "Una semana antes de cada fecha trimestral del IRS, si pagas impuesto estimado y Prism no ha visto el pago de ese trimestre.",
  "An estimated tax payment is due": "Se vence un pago de impuesto estimado",
  "Pay on IRS Direct Pay or your IRS online account; Prism never pays anyone for you.":
    "Paga en IRS Direct Pay o en tu cuenta en línea del IRS; Prism nunca le paga a nadie por ti.",
  "See Taxes": "Ver Impuestos",
  "Under the safe-harbor rule, about {amount} more by then, with withholding like last year's. Taxes shows the year.":
    "Según la regla de puerto seguro, unos {amount} más para esa fecha, con retenciones como las del año pasado. Impuestos muestra el año.",
  "Your business made {amount} so far this year, and no paycheck withholds tax on it.": "Tu negocio ha ganado {amount} en lo que va del año, y ningún cheque de pago le retiene impuestos.",
  "Your {year} return had a balance due of $1,000 or more, the line at which the IRS generally expects estimated payments.":
    "Tu declaración de {year} tuvo un saldo a pagar de $1,000 o más, el límite a partir del cual el IRS por lo general espera pagos estimados.",
  "Your {year} return had estimated payments, so the IRS likely expects them again.": "Tu declaración de {year} tuvo pagos estimados, así que es probable que el IRS los espere de nuevo.",
  "{amount} short": "Faltan {amount}",
};
