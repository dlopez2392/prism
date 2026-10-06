// src/lib/legal-es.ts
//
// What the Spanish legal pages share: the dates they show, the note that the
// English governs, and the Spanish of the lists privacy.ts keeps as data
// (what's stored on a device, the companies that handle people's data, the
// push services), keyed by their English, the way the app's own Spanish is
// (i18n/t.ts). legal-spanish.test.ts fails when an English line has no
// Spanish here, or a Spanish line no longer has its English, so a cookie or a
// provider can't be added to the policy without its translation.
//
// Held until a lawyer approves it (legal-languages.ts). Written in "tú", in
// the plain voice the English uses and the rest of Prism speaks in Spanish.

const MONTHS: Record<string, string> = {
  January: "enero",
  February: "febrero",
  March: "marzo",
  April: "abril",
  May: "mayo",
  June: "junio",
  July: "julio",
  August: "agosto",
  September: "septiembre",
  October: "octubre",
  November: "noviembre",
  December: "diciembre",
};

/** "October 5, 2026" as Spanish writes it: "5 de octubre de 2026". */
export function longDateEs(english: string): string {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(english);
  const month = m ? MONTHS[m[1]!] : undefined;
  if (!m || !month) throw new Error(`Not a date the legal pages write: ${english}`);
  return `${Number(m[2])} de ${month} de ${m[3]}`;
}

/** The note at the top of a Spanish legal page. */
export function governingNote(document: "la política de privacidad" | "los términos del servicio", englishDate: string): string {
  return (
    `Esta es una traducción de ${document} en inglés del ${longDateEs(englishDate)}, para tu comodidad. ` +
    "La versión en inglés es la que rige: si las dos dicen algo distinto, vale lo que dice la versión en inglés. Para leerla en inglés, elige EN arriba."
  );
}

/** The Spanish of every line privacy.ts lists, keyed by its English. */
export const PRIVACY_LISTS_ES: Record<string, string> = {
  // What's stored on a device: what each is for, and how long it's kept.
  Cookie: "Cookie",
  "Browser storage": "Almacenamiento del navegador",
  "Keeps you signed in to your Prism account.": "Mantiene abierta tu sesión en tu cuenta de Prism.",
  "Until you sign out, or 400 days": "Hasta que cierres sesión, o 400 días",
  "Makes the link in your sign-in email work only in the browser that asked for it.":
    "Hace que el enlace del correo para iniciar sesión funcione solo en el navegador que lo pidió.",
  "Until you finish signing in": "Hasta que termines de iniciar sesión",
  "Remembers what you were doing when sign-in interrupted it, such as approving an AI app.":
    "Recuerda lo que estabas haciendo cuando el inicio de sesión lo interrumpió, como aprobar una app de IA.",
  "15 minutes": "15 minutos",
  "A bank connected on this device before connecting one needed an account, encrypted so only Prism's server can read it. Signing in moves it into your account.":
    "Un banco conectado en este dispositivo antes de que conectar uno requiriera una cuenta, cifrado para que solo el servidor de Prism pueda leerlo. Al iniciar sesión, pasa a tu cuenta.",
  "30 days": "30 días",
  "Holds your connection in place while your bank signs you in on its own website.":
    "Mantiene tu conexión en espera mientras tu banco te hace iniciar sesión en su propio sitio web.",
  "Up to 1 hour": "Hasta 1 hora",
  "A Coinbase connection made on this device before connecting one needed an account, encrypted. Signing in moves it into your account.":
    "Una conexión con Coinbase hecha en este dispositivo antes de que conectar una requiriera una cuenta, cifrada. Al iniciar sesión, pasa a tu cuenta.",
  "400 days": "400 días",
  "Keeps a Coinbase sign-in secure while it's in progress.": "Mantiene seguro un inicio de sesión en Coinbase mientras está en curso.",
  "10 minutes": "10 minutos",
  "Remembers the language you chose for Prism, English or Spanish.": "Recuerda el idioma que elegiste para Prism, inglés o español.",
  "1 year": "1 año",
  "Budgets you set on this device without an account.": "Los presupuestos que defines en este dispositivo sin una cuenta.",
  "Goals you set on this device without an account.": "Las metas que defines en este dispositivo sin una cuenta.",
  "Remembers that you chose to decide later about moving this device's budgets and goals into your account.":
    "Recuerda que elegiste decidir más tarde si pasas a tu cuenta los presupuestos y las metas de este dispositivo.",
  "Whether you're looking at your own money or your household's.": "Si estás viendo tu propio dinero o el de tu hogar.",
  "Holds a household invitation you opened while you sign in to accept it, in that tab only.":
    "Guarda una invitación a un hogar que abriste mientras inicias sesión para aceptarla, solo en esa pestaña.",
  "Until you accept it or close the tab": "Hasta que la aceptes o cierres la pestaña",
  "Your time zone, so days and months line up with yours.": "Tu zona horaria, para que los días y los meses coincidan con los tuyos.",
  "Whether you picked light or dark.": "Si elegiste el modo claro o el oscuro.",
  "Until you clear it": "Hasta que lo borres",

  // The companies that handle people's data, and what each does.
  "Connects your bank, card, loan and investment accounts. You sign in to your bank through Plaid, and Prism never sees your bank username or password.":
    "Conecta tus cuentas de banco, tarjetas, préstamos e inversiones. Inicias sesión en tu banco a través de Plaid, y Prism nunca ve tu usuario ni tu contraseña del banco.",
  "Shares your crypto balances, read-only, if you connect Coinbase.": "Comparte tus saldos de cripto, solo para lectura, si conectas Coinbase.",
  "Runs Prism's database and sign-in, in the United States.": "Opera la base de datos y el inicio de sesión de Prism, en los Estados Unidos.",
  "Hosts the Prism website and servers, in the United States.": "Aloja el sitio web y los servidores de Prism, en los Estados Unidos.",
  "Sends your sign-in codes by email.": "Envía por correo tus códigos para iniciar sesión.",
  "Sends your sign-in codes by email, and your alert emails if you turn them on. For an alert it receives your email address and the email itself, which can name a bank or a shop and, if you allow it, amounts.":
    "Envía por correo tus códigos para iniciar sesión, y tus correos de alertas si los activas. Para una alerta recibe tu dirección de correo y el correo mismo, que puede nombrar un banco o un comercio y, si lo permites, montos.",
  "Estimates the value of a home you ask Prism to keep up to date. It receives the home's address, and nothing else about you, about once a month, and is asked not to keep it in its logs.":
    "Estima el valor de una vivienda cuyo valor le pides a Prism mantener al día. Recibe la dirección de la vivienda, y nada más sobre ti, más o menos una vez al mes, y se le pide no guardarla en sus registros.",
  "Reads the balance of a Bitcoin wallet you add. It receives the wallet's public address, and nothing else about you, about every 15 minutes while you use Prism. For a whole wallet it receives each of the wallet's addresses, which Prism works out itself, never the extended public key, about every 30 minutes.":
    "Lee el saldo de una billetera de Bitcoin que agregues. Recibe la dirección pública de la billetera, y nada más sobre ti, más o menos cada 15 minutos mientras usas Prism. Para una billetera completa recibe cada una de sus direcciones, que Prism calcula por su cuenta, nunca la clave pública extendida, más o menos cada 30 minutos.",
  "Takes payment for Prism Plus if you subscribe. You give your card to Stripe on its own page, and Prism never sees it. Stripe receives your email address, and your billing address to work out sales tax.":
    "Cobra el pago de Prism Plus si te suscribes. Le das tu tarjeta a Stripe en su propia página, y Prism nunca la ve. Stripe recibe tu dirección de correo, y tu dirección de facturación para calcular el impuesto sobre las ventas.",
  "Reads the balance of an Ethereum or Solana wallet you add. It receives the wallet's public address, and nothing else about you, about every 15 minutes while you use Prism.":
    "Lee el saldo de una billetera de Ethereum o Solana que agregues. Recibe la dirección pública de la billetera, y nada más sobre ti, más o menos cada 15 minutos mientras usas Prism.",

  // The push services, by the browsers each carries alerts for.
  "Safari, on an iPhone, iPad or Mac.": "Safari, en un iPhone, iPad o Mac.",
  "Chrome, and Android.": "Chrome y Android.",
  "Firefox.": "Firefox.",
  "Edge on Windows.": "Edge en Windows.",
};

/** A listed line in Spanish; the English stays when there's none, and the test names it. */
export function listEs(english: string): string {
  return PRIVACY_LISTS_ES[english] ?? english;
}
