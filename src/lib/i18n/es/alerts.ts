// src/lib/i18n/es/alerts.ts — what Prism sends while the person is away: the
// alert email (a bank that needs them, a bill that may not be covered, a
// price that went up), the Monday summary, the recap of last month early in
// the next, and the phone notification that goes with each. Sent in Spanish
// to whoever reads Prism in Spanish (profiles.language, kept in step by
// their visits). Voice and glossary as at the top of core.ts, and as the
// Account page words the same things (account.ts): email correo · summary
// resumen · Account page página de Cuenta · came in / went out entró / salió
// · kept ahorraste · the week before la semana anterior · the end of last
// month el cierre del mes pasado. A change is words, never an arrow, and
// stands in for the amount when amounts are off.

export const ALERTS: Record<string, string> = {
  "1 bill in the next 30 days": "1 factura en los próximos 30 días",
  "Account page": "Página de Cuenta",
  "Against {month}": "Frente a {month}",
  "And {n} more in today's email.": "Y {n} más en el correo de hoy.",
  "Bills, prices and figures are as of your visit to {product} on {date}; a bank's warning is as it reached {product}.":
    "Las facturas, los precios y las cifras son los de tu visita a {product} del {date}; el aviso de un banco es tal como le llegó a {product}.",
  "Bills, prices and figures are from {product}'s check of your banks on {date}; a bank's warning is as it reached {product}.":
    "Las facturas, los precios y las cifras son de la revisión de tus bancos que hizo {product} el {date}; el aviso de un banco es tal como le llegó a {product}.",
  "In and out": "Entradas y salidas",
  "Nothing {product} knows of is due in the next 30 days.": "{product} no sabe de nada que venza en los próximos 30 días.",
  "Nothing {product} knows of is due in the next seven days.": "{product} no sabe de nada que venza en los próximos siete días.",
  "Open Connections": "Abrir Conexiones",
  "Open {product}": "Abrir {product}",
  "Open {product} and next Monday's summary will have them.": "Abre {product} y el resumen del próximo lunes las tendrá.",
  "Open {product} for this week's figures.": "Abre {product} para ver las cifras de esta semana.",
  "Open {product} to see it on Cash flow.": "Abre {product} para verlo en Flujo de efectivo.",
  "Stop these emails": "Dejar de recibir estos correos",
  "Until you do, {product} can't see anything new from it.": "Hasta que lo hagas, {product} no puede ver nada nuevo de ese banco.",
  "You asked {product} for these emails. Choose what they cover on your Account page, or stop them with one click.":
    "Pediste estos correos a {product}. Elige qué incluyen en tu página de Cuenta, o deja de recibirlos con un clic.",
  "You kept some of what came in": "Ahorraste parte de lo que entró",
  "You spent more than came in": "Gastaste más de lo que entró",
  "Your Account page": "Tu página de Cuenta",
  "Your week": "Tu semana",
  "Your {month}": "Tu mes de {month}",
  "about level over the month": "casi sin cambios en el mes",
  "about the same as the week before": "casi lo mismo que la semana anterior",
  "about the same spent as in {month}": "gastaste casi lo mismo que en {month}",
  "and {n} more": "y {n} más",
  "down over the month": "bajó en el mes",
  "down since the end of last month": "bajó desde el cierre del mes pasado",
  "down {amount} over the month": "bajó {amount} en el mes",
  "less spent than in {month}": "gastaste menos que en {month}",
  "less than the week before": "menos que la semana anterior",
  "level with the end of last month": "igual que al cierre del mes pasado",
  "more spent than in {month}": "gastaste más que en {month}",
  "more than the week before": "más que la semana anterior",
  "up over the month": "subió en el mes",
  "up since the end of last month": "subió desde el cierre del mes pasado",
  "up {amount} over the month": "subió {amount} en el mes",
  "{Change}, {from} to {to}": "{Change}, del {from} al {to}",
  "{amount} at the end of {month}, {change}": "{amount} al cierre de {month}, {change}",
  "{amount} down since the end of last month": "bajó {amount} desde el cierre del mes pasado",
  "{amount} from {from} to {to}, {change}": "{amount} del {from} al {to}, {change}",
  "{amount} less spent than in {month}": "gastaste {amount} menos que en {month}",
  "{amount} less than the week before": "{amount} menos que la semana anterior",
  "{amount} more spent than in {month}": "gastaste {amount} más que en {month}",
  "{amount} more than the week before": "{amount} más que la semana anterior",
  "{amount} up since the end of last month": "subió {amount} desde el cierre del mes pasado",
  "{bills}, about {amount} in all": "{bills}, unos {amount} en total",
  "{income} came in and {spent} went out, so you kept {kept}": "Entraron {income} y salieron {spent}, así que ahorraste {kept}",
  "{income} came in and {spent} went out, so you spent {kept} more than came in": "Entraron {income} y salieron {spent}, así que gastaste {kept} más de lo que entró",
  "{name} on {date}": "{name} el {date}",
  "{name} {amount} on {date}": "{name} {amount} el {date}",
  "{n} bills in the next 30 days": "{n} facturas en los próximos 30 días",
  "{percent} used so far this month": "{percent} usado en lo que va del mes",
  "{product} hasn't looked at your accounts lately, so it can't sum up {month} here.": "{product} no ha revisado tus cuentas últimamente, así que no puede resumir {month} aquí.",
  "{product} hasn't looked at your accounts lately, so there are no new figures this week.": "{product} no ha revisado tus cuentas últimamente, así que esta semana no hay cifras nuevas.",
  "{product} hasn't looked at your accounts since {date}, so it can't sum up {month} here.": "{product} no ha revisado tus cuentas desde el {date}, así que no puede resumir {month} aquí.",
  "{product} hasn't looked at your accounts since {date}, so there are no new figures this week.":
    "{product} no ha revisado tus cuentas desde el {date}, así que esta semana no hay cifras nuevas.",
  "{spent} of {limit} used so far this month": "{spent} de {limit} usados en lo que va del mes",
  "{title} in {product}": "{title} en {product}",
  "{title}, and {n} more": "{title}, y {n} más",
};
