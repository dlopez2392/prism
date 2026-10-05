// src/lib/i18n/es/year-taxes.ts — Spanish for Your year and Taxes, in the voice and glossary of core.ts.
//
// Taxes in the words the IRS uses in Spanish: tax return declaración de
// impuestos · itemize detallar tus deducciones · taxable sujeto a impuestos ·
// tax preparer preparador de impuestos · gifts to charity donaciones
// caritativas · refund reembolso · withheld retenido · tuition colegiatura.
// Form names stay as the IRS writes them (W-2, 1099-INT, 1098-T); a credit
// keeps its English name beside the Spanish, as a tax form or a preparer
// says it. Information, never advice: "can", "may" and "usually" stay.

export const YEAR_TAXES: Record<string, string> = {
  // Your year ("Year", its tabs' name, is in goals.ts)
  "Your {year}": "Tu {year}",
  "{year} so far · {from} – {to}": "{year} hasta ahora · {from} – {to}",
  "{from} – {to}, {year}": "{from} – {to} de {year}",
  "The year on one page: what came in, where it went, and how far you came.": "El año en una página: lo que entró, a dónde se fue y cuánto avanzaste.",
  "Nothing from {year} yet": "Todavía no hay nada de {year}",
  "Your year appears here once Prism has your transactions: link a bank, or import your history from Mint, Monarch or a spreadsheet.":
    "Tu año aparece aquí cuando Prism tenga tus transacciones: conecta un banco o importa tu historial desde Mint, Monarch o una hoja de cálculo.",
  "Prism's records start on {date}, so this year does too. Import older history on Connections to fill in the months before.":
    "Los registros de Prism empiezan el {date}, y este año también. Importa tu historial anterior en Conexiones para completar los meses previos.",
  "No income came in over this stretch.": "No entró ningún ingreso en este periodo.",
  "You spent {amount} more than came in.": "Gastaste {amount} más de lo que entró.",
  "{pct} of everything that came in.": "El {pct} de todo lo que entró.",
  "{amount} over the same stretch last year.": "{amount} en el mismo periodo del año pasado.",
  "{amount} over {year}.": "{amount} en {year}.",
  "Nothing kept over the same stretch last year.": "No ahorraste nada en el mismo periodo del año pasado.",
  "Nothing kept over {year}.": "No ahorraste nada en {year}.",
  "vs the same stretch last year": "vs. el mismo periodo del año pasado",
  "vs {year}": "vs. {year}",
  "the whole year": "todo el año",
  "since {month} ended": "desde el cierre de {month}",
  "at the end of {year}": "al final de {year}",
  "paychecks and other pay, {span}": "cheques de pago y otros ingresos del trabajo, {span}",
  "none found, {span}": "no se encontró ninguna, {span}",
  "1 subscription, {span}": "1 suscripción, {span}",
  "{n} subscriptions, {span}": "{n} suscripciones, {span}",
  "Month by month": "Mes a mes",
  "Every month of {year}, in and out": "Cada mes de {year}, entradas y salidas",
  "Money in and out each month of {year}": "Entradas y salidas de cada mes de {year}",
  "Each category's share of what you spent": "La parte de cada categoría en lo que gastaste",
  "Each category's share, and how it compares with the same stretch last year": "La parte de cada categoría, y cómo se compara con el mismo periodo del año pasado",
  "Each category's share, and how it compares with {year}": "La parte de cada categoría, y cómo se compara con {year}",
  "Who you paid most": "A quién le pagaste más",
  "The ten places that took the most, {span}": "Los diez lugares que se llevaron más, {span}",
  "1 time": "1 vez",
  "{n} times": "{n} veces",
  "The year in a few lines": "El año en pocas líneas",
  "What stood out": "Lo que más destacó",
  "Biggest one-off purchase": "La compra más grande de una sola vez",
  "{amount} at {merchant}, {date}": "{amount} en {merchant}, {date}",
  "Costliest month": "El mes más caro",
  "Lightest month": "El mes con menos gastos",
  "{month}, {amount} out": "{Month}: salieron {amount}",
  "Biggest subscription": "La suscripción más cara",
  "{merchant}, {amount} so far": "{merchant}, {amount} hasta ahora",
  "{merchant}, {amount} for the year": "{merchant}, {amount} en el año",
  "Download {year}'s transactions": "Descargar las transacciones de {year}",
  "Print or save as PDF": "Imprimir o guardar como PDF",
  "See {year} for your taxes": "Ver tus impuestos de {year}",
  "Information, not financial or tax advice. 1 transaction counted.": "Información, no asesoría financiera ni de impuestos. 1 transacción contada.",
  "Information, not financial or tax advice. {n} transactions counted.": "Información, no asesoría financiera ni de impuestos. Transacciones contadas: {n}.",

  // Taxes
  "Tax year": "Año fiscal",
  "Your {year} taxes": "Tus impuestos de {year}",
  "What your accounts saw that a tax return asks about, and the form that has the official figure.":
    "Lo que tus cuentas vieron de lo que pide una declaración de impuestos, y el formulario que tiene la cifra oficial.",
  "Your interest, gifts to charity, medical bills and more are gathered here for tax time once Prism has your transactions: link a bank, or import your history.":
    "Tus intereses, donaciones caritativas, gastos médicos y más se reúnen aquí para la temporada de impuestos cuando Prism tenga tus transacciones: conecta un banco o importa tu historial.",
  "Prism's records start on {date}, so anything earlier in {year} isn't here. Import older history on Connections to fill it in.":
    "Los registros de Prism empiezan el {date}, así que lo anterior de {year} no está aquí. Importa tu historial anterior en Conexiones para completarlo.",
  "This is your household's shared money. If you file on your own, switch to Me for just yours.":
    "Este es el dinero compartido de tu hogar. Si declaras por tu cuenta, cambia a Yo para ver solo el tuyo.",
  "Found for your {year} return": "Encontrado para tu declaración de {year}",
  "of {n} things a return asks about": "de {n} cosas que pide una declaración",
  "Forms to watch for:": "Formularios que debes esperar:",
  "No forms to watch for from what Prism can see.": "Por lo que Prism puede ver, no hay formularios que esperar.",
  Counted: "Contadas",
  "transaction, {from} to today.": "transacción, del {from} a hoy.",
  "transaction, {from} – {to}.": "transacción, {from} – {to}.",
  "transactions, {from} to today.": "transacciones, del {from} a hoy.",
  "transactions, {from} – {to}.": "transacciones, {from} – {to}.",
  "{year} isn't over, so these will grow until December 31.": "{year} no ha terminado, así que estas cifras crecerán hasta el 31 de diciembre.",
  "Money out that may count": "Salidas que pueden contar",
  "1 gift of $250 or more": "1 donación de $250 o más",
  "{n} gifts of $250 or more": "{n} donaciones de $250 o más",
  "Form {form}": "Formulario {form}",
  "{a} or {b}": "{a} o {b}",
  "{a}, {b} or {c}": "{a}, {b} o {c}",
  "Show the transaction": "Ver la transacción",
  "Show the {n} transactions": "Ver las {n} transacciones",
  "Keep the charity's receipt": "Guarda el recibo de la organización benéfica",
  "Not found": "No encontrado",
  "Prism looked and saw none of these": "Prism buscó y no vio ninguno de estos",
  "If you had any, paid by check or cash, or from an account that isn't linked, add them from your own records.":
    "Si tuviste alguno, pagado con cheque o en efectivo, o desde una cuenta que no está conectada, agrégalo de tus propios registros.",
  "Prism found something for every part of a return it looks for.": "Prism encontró algo para cada parte de la declaración que busca.",
  "Left out: 1 gift to a campaign or a party ({amount}). Those aren't deductible.": "Quedó fuera: 1 donación a una campaña o a un partido ({amount}). No es deducible.",
  "Left out: {n} gifts to a campaign or a party ({amount}). Those aren't deductible.": "Quedaron fuera: {n} donaciones a campañas o partidos ({amount}). No son deducibles.",
  "Download for your tax preparer": "Descargar para tu preparador de impuestos",
  "Information, not tax advice. Prism finds these by your bank's categories and by name, and a bank line is what landed, not what a form says: trust the forms, and check each line against your own records.":
    "Información, no asesoría de impuestos. Prism encuentra estas líneas por las categorías de tu banco y por nombre, y una línea del banco es lo que llegó, no lo que dice un formulario: confía en los formularios y compara cada línea con tus propios registros.",

  // What a tax return asks about (finance/taxes.ts)
  "Benefits, pensions and retirement": "Beneficios, pensiones y jubilación",
  "Other money in": "Otro dinero que entró",
  "Gifts to charity": "Donaciones caritativas",
  "Medical and dental": "Gastos médicos y dentales",
  "Taxes you paid": "Impuestos que pagaste",
  "Mortgage payments": "Pagos de hipoteca",
  "Student loan payments": "Pagos de préstamo estudiantil",
  Childcare: "Cuidado infantil",
  "Tuition and school": "Colegiatura y escuela",
  "What landed in your accounts, after taxes and deductions came out. Your W-2 shows what you earned before them, and that's the figure your return needs.":
    "Lo que llegó a tus cuentas, después de descontar impuestos y deducciones. Tu W-2 muestra lo que ganaste antes de eso, y esa es la cifra que necesita tu declaración.",
  "Interest is taxable. Each bank that paid you $10 or more sends a 1099-INT by early February.":
    "Los intereses están sujetos a impuestos. Cada banco que te pagó $10 o más te envía un 1099-INT a principios de febrero.",
  "Dividends are taxable, even when they're reinvested. Your brokerage sends a 1099-DIV.":
    "Los dividendos están sujetos a impuestos, aunque se reinviertan. Tu casa de bolsa te envía un 1099-DIV.",
  "Unemployment shows on a 1099-G, Social Security on an SSA-1099, and pensions and retirement withdrawals on a 1099-R. Some or all of it can be taxable.":
    "El desempleo aparece en un 1099-G, el Seguro Social en un SSA-1099, y las pensiones y los retiros de jubilación en un 1099-R. Una parte o todo puede estar sujeto a impuestos.",
  "Money from clients, side work or selling things online can be taxable even when no form arrives. Nothing was taken out of it for taxes, so a large amount can mean a bill in April, or quarterly estimated payments.":
    "El dinero de clientes, trabajos extra o ventas en línea puede estar sujeto a impuestos aunque no te llegue ningún formulario. No se le retuvo nada para impuestos, así que una cantidad grande puede significar que debas pagar en abril, o hacer pagos estimados cada trimestre.",
  "A federal refund isn't income. A state or local refund can be, if you itemized the year before; your state sends a 1099-G.":
    "Un reembolso federal no es ingreso. Uno estatal o local puede serlo, si detallaste tus deducciones el año anterior; tu estado te envía un 1099-G.",
  "From 2026, up to $1,000 of cash gifts to charity ($2,000 filing jointly) can be deducted even if you don't itemize. Keep the charity's written receipt for any single gift of $250 or more. Gifts to campaigns, parties or people aren't deductible.":
    "Desde 2026, puedes deducir hasta $1,000 en donaciones caritativas en efectivo ($2,000 si declaran en conjunto) aunque no detalles tus deducciones. Guarda el recibo por escrito de la organización benéfica para cualquier donación individual de $250 o más. Las donaciones a campañas, partidos o personas no son deducibles.",
  "Keep the charity's written receipt for any single gift of $250 or more. Gifts to campaigns, parties or people aren't deductible.":
    "Guarda el recibo por escrito de la organización benéfica para cualquier donación individual de $250 o más. Las donaciones a campañas, partidos o personas no son deducibles.",
  "Doctors, dentists, eye care, prescriptions and hospitals. They lower your taxes only if you itemize, and only the part above 7.5% of your adjusted gross income. A pharmacy's total is everything bought there, so count only the medicine.":
    "Médicos, dentistas, cuidado de la vista, recetas y hospitales. Bajan tus impuestos solo si detallas tus deducciones, y solo la parte que pase del 7.5% de tu ingreso bruto ajustado. El total de una farmacia es todo lo que compraste ahí, así que cuenta solo las medicinas.",
  "Payments to the IRS, your state and your county. An estimated payment counts toward the year it was for, so one made in January or April may belong to the year before. State, local and property taxes can be deducted if you itemize, up to a limit.":
    "Pagos al IRS, a tu estado y a tu condado. Un pago estimado cuenta para el año al que corresponde, así que uno hecho en enero o abril puede ser del año anterior. Los impuestos estatales, locales y a la propiedad se pueden deducir si detallas tus deducciones, hasta un límite.",
  "Only the interest can be deducted, and only if you itemize. Your lender's 1098 shows how much of these payments was interest.":
    "Solo se pueden deducir los intereses hipotecarios, y solo si detallas tus deducciones. El 1098 de tu prestamista muestra cuánto de estos pagos fue de intereses.",
  "Up to $2,500 of the interest can lower your taxable income even if you don't itemize, depending on what you earn. Your loan servicer's 1098-E shows it.":
    "Hasta $2,500 de los intereses pueden bajar tu ingreso sujeto a impuestos aunque no detalles tus deducciones, según lo que ganes. El 1098-E de la compañía que administra tu préstamo lo muestra.",
  "Care for a child under 13 while you work may qualify for the Child and Dependent Care Credit. You'll need each provider's name, address and tax ID.":
    "El cuidado de un niño menor de 13 años mientras trabajas puede calificar para el crédito por cuidado de menores y dependientes (Child and Dependent Care Credit). Necesitarás el nombre, la dirección y el número de identificación tributaria de cada proveedor.",
  "College costs may qualify for the American Opportunity or Lifetime Learning credit, and the school's 1098-T shows what counts. School before college usually doesn't.":
    "Los gastos universitarios pueden calificar para el crédito de oportunidad americana (American Opportunity) o el crédito vitalicio por aprendizaje (Lifetime Learning), y el 1098-T de la escuela muestra lo que cuenta. La escuela antes de la universidad normalmente no califica.",
};
