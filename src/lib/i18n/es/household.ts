// src/lib/i18n/es/household.ts — the household (who's in it, inviting,
// joining, leaving, choosing which accounts to share), the screen where an AI
// app asks to read someone's money, and the page an alert email's "Stop these
// emails" link opens. Voice and glossary as at the top of core.ts: Household
// Hogar · invite invitar / invitación · join unirte · leave salir · shared
// compartida · Private Privada · Allow Permitir · Don't allow No permitir ·
// unsubscribe dejar de recibir. Someone else in the household is "esa
// persona" or "los demás", never a gendered word, since Prism doesn't know.

export const HOUSEHOLD: Record<string, string> = {
  "(you)": "(tú)",
  "A household has room for four people.": "Un hogar tiene espacio para cuatro personas.",
  "A household has room for four people. Cancel an invitation, or ask someone to leave, first.":
    "Un hogar tiene espacio para cuatro personas. Primero cancela una invitación o pídele a alguien que salga.",
  "Alert emails are off": "Los correos de alertas están desactivados",
  "Allow it": "Permitir",
  "Allow {name}": "Permitir a {name}",
  "An app": "Una app",
  "Can't share yet": "Aún no se puede compartir",
  "Cancel invitation": "Cancelar invitación",
  "Change or delete anything in {product} — the database itself refuses": "Cambiar ni borrar nada en {product}: la misma base de datos lo rechaza",
  "Checking the invitation": "Revisando la invitación",
  "Choose what to share": "Elegir qué compartir",
  "Choose what you share on Connections.": "Elige qué compartes en Conexiones.",
  "Connect a bank, or add something on Net worth, and you can choose to share it here.": "Conecta un banco o agrega algo en Patrimonio neto, y aquí podrás elegir si lo compartes.",
  "Connect an app": "Conectar una app",
  "Connecting AI apps needs a Prism account, and accounts aren't switched on here yet.":
    "Para conectar apps de IA necesitas una cuenta de Prism, y las cuentas todavía no están activadas aquí.",
  "Connecting…": "Conectando…",
  "Connection requests last a few minutes and work once. Go back to the app and connect Prism again.":
    "Las solicitudes de conexión duran unos minutos y sirven una sola vez. Vuelve a la app y conecta Prism de nuevo.",
  Copied: "Copiado",
  Copy: "Copiar",
  "Don't allow": "No permitir",
  "Enter their email address, like dana@example.com.": "Escribe el correo de esa persona, como dana@ejemplo.com.",
  "Go to Account": "Ir a Cuenta",
  "If you allow it, you'll go back to {host}. Only allow apps you trust, and only if you started this from that app.":
    "Si lo permites, volverás a {host}. Permite solo apps en las que confíes, y solo si empezaste esto desde esa app.",
  "Invitation declined": "Invitación rechazada",
  "Invitation link": "Enlace de invitación",
  "Invitations last seven days. Ask for a new one.": "Las invitaciones duran siete días. Pide una nueva.",
  "Invite someone": "Invitar a alguien",
  "Invited · link works until {date}": "Invitación enviada · el enlace sirve hasta el {date}",
  "It may have been cut short by your email app. Sign in and turn alert emails off from your Account page instead.":
    "Puede que tu app de correo lo haya cortado. Mejor inicia sesión y desactiva los correos de alertas desde tu página de Cuenta.",
  "It may have been used already, or cancelled. Ask for a new one.": "Puede que ya se haya usado o que lo hayan cancelado. Pide uno nuevo.",
  "It will be able to": "Podrá",
  "It will never be able to": "Nunca podrá",
  "Join a household": "Unirte a un hogar",
  "Join the household": "Unirte al hogar",
  "Joining…": "Uniéndote…",
  Leave: "Salir",
  "Leave household": "Salir del hogar",
  "Leave it from your Account page first, then open this link again.": "Primero sal de ese hogar desde tu página de Cuenta y luego vuelve a abrir este enlace.",
  "Leave your household? Everything you share stops at once, and you'll no longer see theirs.":
    "¿Salir de tu hogar? Todo lo que compartes deja de compartirse al instante, y ya no verás lo de los demás.",
  "Leaving…": "Saliendo…",
  "Let {name} read your money?": "¿Permitir que {name} vea tu dinero?",
  "Link copied.": "Enlace copiado.",
  "Make the link": "Crear el enlace",
  "Making link…": "Creando el enlace…",
  "Move money or pay anyone": "Mover dinero ni pagarle a nadie",
  "No invitation here": "Aquí no hay ninguna invitación",
  "No invitation here.": "Aquí no hay ninguna invitación.",
  "No thanks": "No, gracias",
  "Nothing was shared, and the link won't work again.": "No se compartió nada, y el enlace ya no volverá a funcionar.",
  "Open the link you were sent. It ends with a long code after a # sign.": "Abre el enlace que te enviaron. Termina con un código largo después de un signo #.",
  "Open your Account page": "Abrir tu página de Cuenta",
  Private: "Privada",
  "Saying no…": "Diciendo que no…",
  "Search your transactions": "Buscar en tus transacciones",
  "See your accounts and balances": "Ver tus cuentas y saldos",
  "See your bank or Coinbase sign-in details": "Ver tus datos para iniciar sesión en tu banco o en Coinbase",
  "See your email address": "Ver tu correo electrónico",
  "See your spending, budgets, goals and upcoming bills": "Ver tus gastos, presupuestos, metas y próximas facturas",
  "Send this link to {email} by text or email. It works once, for 7 days, and only when they're signed in to Prism with that address. Prism shows it only now.":
    "Envía este enlace a {email} por mensaje de texto o por correo. Sirve una sola vez, durante 7 días, y solo cuando esa persona inició sesión en Prism con ese correo. Prism lo muestra solo esta vez.",
  "Share chosen accounts with the people you live with. Each of you keeps your own login.":
    "Comparte las cuentas que elijas con las personas con quienes vives. Cada quien conserva su propio inicio de sesión.",
  "Share {account} with your household": "Compartir {account} con tu hogar",
  Shared: "Compartida",
  "Sign in to invite someone.": "Inicia sesión para invitar a alguien.",
  "Sign in to join.": "Inicia sesión para unirte.",
  "Sign in to see your invitation": "Inicia sesión para ver tu invitación",
  "Sign in with the email address it was sent to, then open the link again.": "Inicia sesión con el correo al que se envió y luego vuelve a abrir el enlace.",
  "Start again from the app you're connecting: add Prism there, and it will send you back here.":
    "Empieza de nuevo desde la app que estás conectando: agrega Prism ahí y te enviará de vuelta aquí.",
  Stay: "Quedarme",
  "Stop alert emails": "Dejar de recibir correos de alertas",
  "Stop alert emails?": "¿Dejar de recibir correos de alertas?",
  "That didn't cancel. Try again in a moment.": "No se pudo cancelar. Inténtalo de nuevo en un momento.",
  "That didn't change. Try again in a moment.": "No se pudo cambiar. Inténtalo de nuevo en un momento.",
  "That didn't go through": "No se pudo completar",
  "That didn't go through, so the invitation still stands. Try again in a moment.": "No se pudo completar, así que la invitación sigue en pie. Inténtalo de nuevo en un momento.",
  "That didn't go through. Try again, or start over from the app.": "No se pudo completar. Inténtalo de nuevo o vuelve a empezar desde la app.",
  "That invitation can't be used any more. Ask for a new link.": "Esa invitación ya no se puede usar. Pide un enlace nuevo.",
  "That link isn't a Prism invitation.": "Ese enlace no es una invitación de Prism.",
  "That's your own email. Invite someone else.": "Ese es tu propio correo. Invita a otra persona.",
  "The address they sign in to Prism with. They'll need to be 18 or older.": "El correo con el que esa persona inicia sesión en Prism. Debe tener 18 años o más.",
  "Their email": "Su correo",
  "They'll see only the accounts you choose to share, and you'll see only theirs.": "Esa persona verá solo las cuentas que elijas compartir, y tú verás solo las suyas.",
  "They're already in your household.": "Esa persona ya está en tu hogar.",
  "This household is full": "Este hogar está lleno",
  "This invitation is for someone else": "Esta invitación es para otra persona",
  "This link doesn't work": "Este enlace no funciona",
  "This link doesn't work any more": "Este enlace ya no funciona",
  "This link has expired": "Este enlace venció",
  "This link is missing its request": "A este enlace le falta la solicitud",
  "This request has expired": "Esta solicitud venció",
  "Try again in a minute.": "Inténtalo de nuevo en un minuto.",
  "Use the email address the invitation was sent to. New to Prism? The same code creates your account.":
    "Usa el correo al que se envió la invitación. ¿Es tu primera vez en Prism? El mismo código crea tu cuenta.",
  "We couldn't check this link just now": "Ahora mismo no pudimos revisar este enlace",
  "We couldn't reach your account just now, so your alert emails are still on. Try the link again in a minute, or turn them off from your Account page.":
    "Ahora mismo no pudimos llegar a tu cuenta, así que tus correos de alertas siguen activados. Vuelve a probar el enlace en un minuto o desactívalos desde tu página de Cuenta.",
  "You can disconnect it any time from your Account page.": "Puedes desconectarla cuando quieras desde tu página de Cuenta.",
  "You choose, account by account, what the household sees. They see balances and transactions, never a way into your bank.":
    "Tú eliges, cuenta por cuenta, qué ve el hogar. Ven saldos y transacciones, nunca una forma de entrar a tu banco.",
  "You keep your own login. Nothing of yours is shared when you join.": "Conservas tu propio inicio de sesión. Al unirte, no se comparte nada tuyo.",
  "You'll see what they share, and you can leave any time.": "Verás lo que los demás compartan, y puedes salir cuando quieras.",
  "You're already in a household": "Ya estás en un hogar",
  "You're already in this household": "Ya estás en este hogar",
  "You're invited to share a household": "Te invitaron a compartir un hogar",
  "Your household is full: four people, invitations included.": "Tu hogar está lleno: cuatro personas, contando las invitaciones.",
  "{name} invited you to share a household": "{name} te invitó a compartir un hogar",
  "{name} wants to connect to your {product} account (you) so you can ask it about your spending, bills and goals.":
    "{name} quiere conectarse a tu cuenta de {product} (tú) para que puedas preguntarle sobre tus gastos, facturas y metas.",
  "{name} wants to connect to your {product} account ({email}) so you can ask it about your spending, bills and goals.":
    "{name} quiere conectarse a tu cuenta de {product} ({email}) para que puedas preguntarle sobre tus gastos, facturas y metas.",
  "{product} will stop emailing you alerts and Monday summaries. Your accounts, budgets and goals stay exactly as they are, and you can turn emails back on from your Account page.":
    "{product} dejará de enviarte alertas y resúmenes de los lunes por correo. Tus cuentas, presupuestos y metas se quedan tal como están, y puedes volver a activar los correos desde tu página de Cuenta.",
  "{product} won't email you alerts any more. If you change your mind, turn them back on from your Account page.":
    "{product} ya no te enviará alertas por correo. Si cambias de opinión, vuelve a activarlas desde tu página de Cuenta.",
};
