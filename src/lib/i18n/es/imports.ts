// src/lib/i18n/es/imports.ts — Spanish for Import history, Venmo/PayPal/Cash App and Amazon orders, in the voice and glossary of core.ts.
//
// Words of these screens: Import Importar · history historial · file archivo ·
// column columna · row fila (a file's line is its row) · spreadsheet hoja de
// cálculo · bank line movimiento del banco · match coincidir / emparejar ·
// charge cargo · order pedido · item artículo · payment pago · note nota ·
// kept (stored) guardado · encrypted cifrado · left out queda fuera /
// omitida. Brand names, file names and other companies' menus stay as they
// are: an English menu name goes in quotes, a few Spanish words beside it
// saying what it is, since the person's Venmo, PayPal or Amazon may be in
// English.

export const IMPORTS: Record<string, string> = {
  "1 Amazon charge matched to your bank": "1 cargo de Amazon coincidió con tu banco",
  "1 Amazon charge now says what it paid for.": "1 cargo de Amazon ya dice qué pagó.",
  "1 Amazon charge says what it paid for": "1 cargo de Amazon dice qué pagó",
  "1 charge no longer matched your accounts, so it was left out.": "1 cargo ya no coincidía con tus cuentas, así que quedó fuera.",
  "1 charge was kept before it stopped": "Se guardó 1 cargo antes de que se detuviera",
  "1 item": "1 artículo",
  "1 item in the file was cancelled, free, or in another currency, and is left out.": "1 artículo del archivo estaba cancelado, era gratis o estaba en otra moneda, y queda fuera.",
  "1 line in the file wasn't a payment that went through (pending, cancelled, card purchases, other currencies) and is left out.":
    "1 fila del archivo no era un pago completado (pendientes, cancelados, compras con tarjeta, otras monedas) y queda fuera.",
  "1 line in the files wasn't a payment that went through (pending, cancelled, card purchases, other currencies) and is left out.":
    "1 fila de los archivos no era un pago completado (pendientes, cancelados, compras con tarjeta, otras monedas) y queda fuera.",
  "1 no longer matched your accounts, so it was left out.": "1 ya no coincidía con tus cuentas, así que quedó fuera.",
  "1 order": "1 pedido",
  "1 order matched no line: paid with a gift card or points, charged to a card that isn't linked, from before your bank's history, or refunded.":
    "1 pedido no coincidió con ningún movimiento: se pagó con tarjeta de regalo o puntos, se cobró a una tarjeta que no está conectada, es de antes del historial de tu banco o se reembolsó.",
  "1 payment matched to your bank": "1 pago coincidió con tu banco",
  "1 payment now says who it was for.": "1 pago ya dice para quién fue.",
  "1 payment says who it was for": "1 pago dice para quién fue",
  "1 payment should have reached a bank but no line matched: the account may not be linked, or its history may not go back that far.":
    "1 pago debió llegar a un banco, pero ningún movimiento coincidió: puede que la cuenta no esté conectada, o que su historial no llegue tan atrás.",
  "1 payment stayed in the app's own balance, so your bank never saw it. Prism doesn't count those yet.":
    "1 pago se quedó en el saldo de la app, así que tu banco nunca lo vio. Prism todavía no cuenta esos.",
  "1 row in the file couldn't be read and is left out.": "1 fila del archivo no se pudo leer y queda fuera.",
  "1 transaction imported from 1 account": "1 transacción importada de 1 cuenta",
  "1 transaction read": "1 transacción leída",
  "1 transaction read, 1 row left out": "1 transacción leída, 1 fila omitida",
  "1 transaction read, {skipped} rows left out": "1 transacción leída, {skipped} filas omitidas",
  "A Mint or Monarch export, or any spreadsheet saved as CSV with a date, a description and an amount for each transaction.":
    "Una exportación de Mint o Monarch, o cualquier hoja de cálculo guardada como CSV con fecha, descripción y monto para cada transacción.",
  "A negative number (−12.50)": "Un número negativo (−12.50)",
  "A positive number (12.50)": "Un número positivo (12.50)",
  "Account (optional)": "Cuenta (opcional)",
  "Add a newer file": "Agregar un archivo más reciente",
  "Add more files": "Agregar más archivos",
  "Add your Amazon order history": "Agrega tu historial de pedidos de Amazon",
  "Add your activity files": "Agrega tus archivos de actividad",
  "Added from your bank": "Agregado desde tu banco",
  "Amazon doesn't let other apps read your orders, but it sends you your own history when you ask.":
    "Amazon no deja que otras apps lean tus pedidos, pero te envía tu propio historial cuando lo pides.",
  "Amazon emails a download link, usually within a day or two. Download the zip and open it.":
    "Amazon te envía por correo un enlace de descarga, normalmente en uno o dos días. Descarga el zip y ábrelo.",
  "An Amazon item": "Un artículo de Amazon",
  "An account of its own": "Una cuenta propia",
  "Anything half-saved isn't shown, and is cleared within a day.": "Lo que quedó a medio guardar no se muestra y se borra en un día.",
  "Back to Connections": "Volver a Conexiones",
  "Category (optional)": "Categoría (opcional)",
  "Check the accounts": "Revisa las cuentas",
  Checking: "Cuenta de cheques",
  "Choose a CSV file": "Elegir un archivo CSV",
  "Choose a file": "Elige un archivo",
  "Choose another file": "Elegir otro archivo",
  "Choose files": "Elegir archivos",
  "Choose other files": "Elegir otros archivos",
  "Choose the file": "Elegir el archivo",
  "Choose {file}, inside its {folder} folder.": "Elige {file}, dentro de su carpeta {folder}.",
  "Column {n}": "Columna {n}",
  "Credit card": "Tarjeta de crédito",
  Date: "Fecha",
  Description: "Descripción",
  "Import 1 transaction": "Importar 1 transacción",
  "Import history": "Importar historial",
  "Import steps": "Pasos de la importación",
  "Import {n} transactions": "Importar {n} transacciones",
  "Imported account": "Cuenta importada",
  Importing: "Importando",
  "Importing needs accounts": "Para importar se necesitan cuentas",
  "Its balance isn't known, so it counts as $0 in your net worth.": "No se conoce su saldo, así que cuenta como $0 en tu patrimonio neto.",
  "Its name in Prism": "Su nombre en Prism",
  "Keep 1 charge": "Guardar 1 cargo",
  "Keep 1 note": "Guardar 1 nota",
  "Keep {n} charges": "Guardar {n} cargos",
  "Keep {n} notes": "Guardar {n} notas",
  "Keeping them": "Guardándolos",
  "Kept, encrypted, in your account. Never shown to your household.": "Guardado y cifrado en tu cuenta. Nunca se muestra a tu hogar.",
  "Line {line}: {reason}": "Fila {line}: {reason}",
  "Link a bank": "Conectar un banco",
  "Link a card": "Conectar una tarjeta",
  "Link the bank your payments come from first. Notes go on its own lines.": "Primero conecta el banco de donde salen tus pagos. Las notas van en sus propios movimientos.",
  "Link the card you pay Amazon with first. Orders go on its own lines.": "Primero conecta la tarjeta con que le pagas a Amazon. Los pedidos van en sus propios movimientos.",
  Loan: "Préstamo",
  "Match the columns": "Empareja las columnas",
  "Money out and money in are in separate columns": "Las salidas y las entradas están en columnas separadas",
  "Money out is written as": "Las salidas se escriben como",
  "Moved to your bank": "Transferido a tu banco",
  "Next: check the accounts": "Siguiente: revisar las cuentas",
  "No Amazon charges yet": "Aún no hay cargos de Amazon",
  "No Venmo, PayPal or Cash App payments yet": "Aún no hay pagos de Venmo, PayPal ni Cash App",
  "No transactions can be read with these columns yet. Choose the date, the description and the amount.":
    "Todavía no se puede leer ninguna transacción con estas columnas. Elige la fecha, la descripción y el monto.",
  "None of these apps lets another app read your account, but each lets you download your own activity. Add one file or several, from any of the three.":
    "Ninguna de estas apps deja que otra app lea tu cuenta, pero cada una te deja descargar tu propia actividad. Agrega uno o varios archivos, de cualquiera de las tres.",
  "None of those charges match a line in your accounts any more. Check the card you pay Amazon with is linked.":
    "Ninguno de esos cargos coincide ya con un movimiento de tus cuentas. Revisa que esté conectada la tarjeta con que le pagas a Amazon.",
  "None of those payments match a line in your accounts. Check the right bank is linked.":
    "Ninguno de esos pagos coincide con un movimiento de tus cuentas. Revisa que esté conectado el banco correcto.",
  "Not in this file": "No está en este archivo",
  "Nothing matched your bank": "Nada coincidió con tu banco",
  "Nothing new to add": "Nada nuevo que agregar",
  "Nothing to keep": "Nada que guardar",
  "Nothing was kept": "No se guardó nada",
  "Older history of {account}": "Historial anterior de {account}",
  "On amazon.com, open {account}, then {request}, choose {orders}, and submit the request.":
    "En amazon.com, abre “{account}” (tu cuenta), luego “{request}” (solicitar tus datos), elige “{orders}” (tus pedidos) y envía la solicitud.",
  "Only the newest {n} are kept.": "Solo se guardan los {n} más recientes.",
  "Only what's before {date} is added — {kept} of {all}. Your bank's own copy covers the rest, so nothing counts twice.":
    "Solo se agrega lo anterior al {date}: {kept} de {all}. La copia de tu banco cubre el resto, así que nada cuenta dos veces.",
  "Part of that import didn't arrive. Start it again.": "Parte de esa importación no llegó. Empiézala de nuevo.",
  "Prism can't do that right now. Try again later.": "Prism no puede hacer eso ahora. Inténtalo más tarde.",
  "Prism can't save imports right now. Try again later.": "Prism no puede guardar importaciones ahora. Inténtalo más tarde.",
  "Prism keeps up to twenty imports. Remove one on Connections first.": "Prism guarda hasta veinte importaciones. Primero quita una en Conexiones.",
  "Prism looks for each payment on a Venmo, PayPal or Cash App line in your linked accounts, for the same amount, within a few days. Check the bank or card that pays them is linked, and that the file covers months your bank's history does.":
    "Prism busca cada pago en un movimiento de Venmo, PayPal o Cash App de tus cuentas conectadas, por el mismo monto y con pocos días de diferencia. Revisa que esté conectado el banco o la tarjeta con que los pagas, y que el archivo cubra meses que también estén en el historial de tu banco.",
  "Prism looks for each shipment on an Amazon line in your linked accounts, for exactly what it cost, within a few days of shipping. Check the card you pay Amazon with is linked, and that the file covers months your bank's history does.":
    "Prism busca cada envío en un movimiento de Amazon de tus cuentas conectadas, por exactamente lo que costó y a pocos días de enviarse. Revisa que esté conectada la tarjeta con que le pagas a Amazon, y que el archivo cubra meses que también estén en el historial de tu banco.",
  "Remove them all": "Quitarlos todos",
  "Saved {done} of 1 charge to your account. Keep this page open.": "{done} de 1 cargo guardado en tu cuenta. Deja esta página abierta.",
  "Saved {done} of {n} charges to your account. Keep this page open.": "{done} de {n} cargos guardados en tu cuenta. Deja esta página abierta.",
  "Saving 1 note to your account. Keep this page open.": "Guardando 1 nota en tu cuenta. Deja esta página abierta.",
  "Saving {n} notes to your account. Keep this page open.": "Guardando {n} notas en tu cuenta. Deja esta página abierta.",
  Savings: "Cuenta de ahorros",
  "Say where each account's history belongs. Older history of an account you've linked joins it; anything else becomes an account of its own, like a card you've closed.":
    "Indica a dónde va el historial de cada cuenta. El historial anterior de una cuenta que ya conectaste se une a ella; lo demás se vuelve una cuenta propia, como una tarjeta que cerraste.",
  "See them on Spending": "Verlos en Gastos",
  "See your spending": "Ver tus gastos",
  "Sign in first.": "Primero inicia sesión.",
  "Sign in to add who your payments were for": "Inicia sesión para agregar para quién fueron tus pagos",
  "Sign in to add your Amazon orders": "Inicia sesión para agregar tus pedidos de Amazon",
  "Sign in to import history": "Inicia sesión para importar tu historial",
  "Sign in to import history. It's kept in your account.": "Inicia sesión para importar tu historial. Se guarda en tu cuenta.",
  "Sign in to remove an import.": "Inicia sesión para quitar una importación.",
  "Some rows in that file didn't check out. Start the import again.": "Algunas filas de ese archivo no cuadraron. Empieza la importación de nuevo.",
  "Someone on Cash App": "alguien en Cash App",
  "Someone on Venmo": "alguien en Venmo",
  "Something in that import didn't check out. Start it again.": "Algo en esa importación no cuadró. Empiézala de nuevo.",
  "Start again": "Empezar de nuevo",
  "That didn't go through. Try again in a minute.": "Eso no se completó. Inténtalo en un minuto.",
  "That didn't save. Try the import again in a minute.": "No se guardó. Vuelve a intentar la importación en un minuto.",
  "That didn't work.": "Eso no funcionó.",
  "That file couldn't be read. Choose it again, or save it as CSV first.": "No se pudo leer ese archivo. Elígelo de nuevo, o primero guárdalo como CSV.",
  "That file has more than {n} rows. Split it into smaller files and import each.": "Ese archivo tiene más de {n} filas. Divídelo en archivos más pequeños e importa cada uno.",
  "That file has no rows Prism can read. Choose a CSV with a header row and at least one transaction.":
    "Ese archivo no tiene filas que Prism pueda leer. Elige un CSV con una fila de encabezados y al menos una transacción.",
  "That file is over 20 MB, which is more than any transaction export. Choose the CSV of your transactions.":
    "Ese archivo pesa más de 20 MB, más que cualquier exportación de transacciones. Elige el CSV de tus transacciones.",
  "That import isn't here any more.": "Esa importación ya no está.",
  "That's more than {n} payments at once. Choose a shorter stretch of time.": "Son más de {n} pagos a la vez. Elige un periodo más corto.",
  "That's the zip Amazon sends. Open it, then choose {file} from inside the {folder} folder.":
    "Ese es el zip que envía Amazon. Ábrelo y luego elige {file} dentro de la carpeta {folder}.",
  "That's too many at once. Choose the file again and Prism sends it in smaller parts.":
    "Son demasiados a la vez. Elige el archivo de nuevo y Prism lo enviará en partes más pequeñas.",
  "The amount is in one column instead": "El monto está en una sola columna, no en dos",
  "The file is read in your browser and never uploaded. Only the transactions you import are saved, encrypted, in your account.":
    "El archivo se lee en tu navegador y nunca se sube. Solo las transacciones que importes se guardan, cifradas, en tu cuenta.",
  "The file is read in your browser and never uploaded. Only what each matching charge paid for is kept, encrypted, in your account. Your addresses in the file are never read.":
    "El archivo se lee en tu navegador y nunca se sube. Solo se guarda, cifrado en tu cuenta, lo que pagó cada cargo que coincide. Tus direcciones en el archivo nunca se leen.",
  "The files are read in your browser and never uploaded. Only who each matching payment was for, and its note, are kept, encrypted, in your account.":
    "Los archivos se leen en tu navegador y nunca se suben. Solo se guarda, cifrado en tu cuenta, para quién fue cada pago que coincide y su nota.",
  "The first transactions as Prism reads them": "Las primeras transacciones como Prism las lee",
  "The import didn't finish": "La importación no terminó",
  "The names and notes are kept, encrypted, in your account, beside the bank lines they explain.":
    "Los nombres y las notas se guardan cifrados en tu cuenta, junto a los movimientos del banco que explican.",
  "There's nothing to keep yet. Choose a file first.": "Todavía no hay nada que guardar. Primero elige un archivo.",
  "They count on every screen now. Fix any category on Spending, and remove an import on Connections whenever you like.":
    "Ya cuentan en todas las pantallas. Corrige cualquier categoría en Gastos y quita una importación en Conexiones cuando quieras.",
  "This file has more than {n} accounts, the most Prism keeps imports for. Split it and import it in parts.":
    "Este archivo tiene más de {n} cuentas, el máximo para el que Prism guarda importaciones. Divídelo e impórtalo por partes.",
  "This needs accounts": "Esto necesita cuentas",
  "Transactions saved": "Transacciones guardadas",
  "What each Amazon charge paid for, on the bank line it came from — not just “AMZN Mktp US −$86.40”.":
    "Qué pagó cada cargo de Amazon, en el movimiento del banco de donde salió; no solo “AMZN Mktp US −$86.40”.",
  "What each charge paid for is kept, encrypted, in your account, beside the bank line it explains.":
    "Lo que pagó cada cargo se guarda cifrado en tu cuenta, junto al movimiento del banco que explica.",
  "What kind of account": "Qué tipo de cuenta",
  "What you import is kept in an account, and accounts aren't set up on this site.": "Lo que importes se guarda en una cuenta, y las cuentas no están configuradas en este sitio.",
  "What you import is kept, encrypted, in your account, so you can see it on every device and remove it whenever you like.":
    "Lo que importes se guarda cifrado en tu cuenta, para que lo veas en todos tus dispositivos y lo quites cuando quieras.",
  "What your Amazon charges paid for is kept in an account, and accounts aren't set up on this site.":
    "Lo que pagaron tus cargos de Amazon se guarda en una cuenta, y las cuentas no están configuradas en este sitio.",
  "Where it belongs": "A dónde va",
  "Who each payment was really for, on the bank line it came from — not just “Venmo −$45.00”.":
    "Para quién fue en realidad cada pago, en el movimiento del banco de donde salió; no solo “Venmo −$45.00”.",
  "Who your payments were for is kept in an account, and accounts aren't set up on this site.":
    "Para quién fueron tus pagos se guarda en una cuenta, y las cuentas no están configuradas en este sitio.",
  "Why rows were left out": "Por qué se omitieron filas",
  "Years of transactions from Mint, Monarch or a spreadsheet, alongside everything else in Prism.":
    "Años de transacciones de Mint, Monarch o una hoja de cálculo, junto a todo lo demás en Prism.",
  "You'll see the items under each charge on Spending, search them by name, and split a charge by its items.":
    "Verás los artículos debajo de cada cargo en Gastos, podrás buscarlos por nombre y dividir un cargo por sus artículos.",
  "You'll see who each was for under the payment on Spending, and you can search by name or note.":
    "Verás para quién fue cada uno debajo del pago en Gastos, y puedes buscar por nombre o nota.",
  "Your Amazon charges appear here once the card or bank you pay Amazon with is linked. Then add your order history, and every charge says what it paid for.":
    "Tus cargos de Amazon aparecen aquí cuando conectes la tarjeta o el banco con que le pagas a Amazon. Luego agrega tu historial de pedidos, y cada cargo dirá qué pagó.",
  "Your Amazon orders are gone. Add the file again any time to bring them back.": "Tus pedidos de Amazon se borraron. Agrega el archivo de nuevo cuando quieras para recuperarlos.",
  "Your payment notes are gone. Add your files again any time to bring them back.":
    "Tus notas de pagos se borraron. Agrega tus archivos de nuevo cuando quieras para recuperarlas.",
  "Your payments through these apps appear here once the bank or card that pays them is linked. Then add each app's activity file, and every payment says who it was for.":
    "Tus pagos con estas apps aparecen aquí cuando conectes el banco o la tarjeta con que los pagas. Luego agrega el archivo de actividad de cada app, y cada pago dirá para quién fue.",
  "a date outside the years Prism keeps": "con una fecha fuera de los años que Prism guarda",
  "an amount of zero": "con un monto de cero",
  "no amount Prism can read": "sin un monto que Prism pueda leer",
  "no date Prism can read": "sin una fecha que Prism pueda leer",
  "no description": "sin descripción",
  "on cash.app, sign in, choose Statements at the top right, then Export CSV.":
    "en cash.app, inicia sesión, elige “Statements” (estados de cuenta) arriba a la derecha y luego “Export CSV”.",
  "on paypal.com, open Activity, choose Download, and download your activity as CSV.":
    "en paypal.com, abre “Activity” (Actividad), elige “Download” (Descargar) y descarga tu actividad como CSV.",
  "on venmo.com, choose Statements, pick a month and choose Download CSV. One file a month: choose several at once.":
    "en venmo.com, elige “Statements” (estados de cuenta), escoge un mes y elige “Download CSV”. Un archivo por mes: puedes elegir varios a la vez.",
  "on your bank {date}": "en tu banco el {date}",
  "{done} of 1 transaction saved. Keep this page open.": "{done} de 1 transacción guardada. Deja esta página abierta.",
  "{done} of {n} transactions saved. Keep this page open.": "{done} de {n} transacciones guardadas. Deja esta página abierta.",
  "{file} couldn't be read. Choose it again.": "No se pudo leer {file}. Elígelo de nuevo.",
  "{file} is over 10 MB, which is more than any of these apps' activity files. Choose the CSV of your activity.":
    "{file} pesa más de 10 MB, más que cualquier archivo de actividad de estas apps. Elige el CSV de tu actividad.",
  "{file} isn't a Venmo, PayPal or Cash App activity file. Download the CSV from the app, then choose it here.":
    "{file} no es un archivo de actividad de Venmo, PayPal ni Cash App. Descarga el CSV desde la app y luego elígelo aquí.",
  "{file} looks like a Mint export. Check each column is the right one.": "{file} parece una exportación de Mint. Revisa que cada columna sea la correcta.",
  "{file} looks like a Monarch export. Check each column is the right one.": "{file} parece una exportación de Monarch. Revisa que cada columna sea la correcta.",
  "{file} looks like a spreadsheet. Check each column is the right one.": "{file} parece una hoja de cálculo. Revisa que cada columna sea la correcta.",
  "{name} has more rows than one import holds. Split the file and import each part.":
    "{name} tiene más filas de las que caben en una importación. Divide el archivo e importa cada parte.",
  "{name} is over 40 MB, which is more than any order history. Choose {file}.": "{name} pesa más de 40 MB, más que cualquier historial de pedidos. Elige {file}.",
  "{name} isn't Amazon's order history. Choose {file} from the zip Amazon sends.": "{name} no es el historial de pedidos de Amazon. Elige {file} del zip que envía Amazon.",
  "{n} Amazon charges matched to your bank": "{n} cargos de Amazon coincidieron con tu banco",
  "{n} Amazon charges now say what they paid for.": "{n} cargos de Amazon ya dicen qué pagaron.",
  "{n} Amazon charges say what they paid for": "{n} cargos de Amazon dicen qué pagaron",
  "{n} charges no longer matched your accounts, so they were left out.": "{n} cargos ya no coincidían con tus cuentas, así que quedaron fuera.",
  "{n} charges were kept before it stopped": "Se guardaron {n} cargos antes de que se detuviera",
  "{n} files": "{n} archivos",
  "{n} items": "{n} artículos",
  "{n} items in the file were cancelled, free, or in another currency, and are left out.":
    "{n} artículos del archivo estaban cancelados, eran gratis o estaban en otra moneda, y quedan fuera.",
  "{n} lines in the file weren't payments that went through (pending, cancelled, card purchases, other currencies) and are left out.":
    "{n} filas del archivo no eran pagos completados (pendientes, cancelados, compras con tarjeta, otras monedas) y quedan fuera.",
  "{n} lines in the files weren't payments that went through (pending, cancelled, card purchases, other currencies) and are left out.":
    "{n} filas de los archivos no eran pagos completados (pendientes, cancelados, compras con tarjeta, otras monedas) y quedan fuera.",
  "{n} more items": "{n} artículos más",
  "{n} no longer matched your accounts, so they were left out.": "{n} ya no coincidían con tus cuentas, así que quedaron fuera.",
  "{n} orders": "{n} pedidos",
  "{n} orders matched no line: paid with a gift card or points, charged to a card that isn't linked, from before your bank's history, or refunded.":
    "{n} pedidos no coincidieron con ningún movimiento: se pagaron con tarjeta de regalo o puntos, se cobraron a una tarjeta que no está conectada, son de antes del historial de tu banco o se reembolsaron.",
  "{n} other items": "otros {n} artículos",
  "{n} payments matched to your bank": "{n} pagos coincidieron con tu banco",
  "{n} payments now say who each was for.": "{n} pagos ya dicen para quién fue cada uno.",
  "{n} payments say who they were for": "{n} pagos dicen para quién fueron",
  "{n} payments should have reached a bank but no line matched: the account may not be linked, or its history may not go back that far.":
    "{n} pagos debieron llegar a un banco, pero ningún movimiento coincidió: puede que la cuenta no esté conectada, o que su historial no llegue tan atrás.",
  "{n} payments stayed in the app's own balance, so your bank never saw them. Prism doesn't count those yet.":
    "{n} pagos se quedaron en el saldo de la app, así que tu banco nunca los vio. Prism todavía no cuenta esos.",
  "{n} rows in the file couldn't be read and are left out.": "{n} filas del archivo no se pudieron leer y quedan fuera.",
  "{n} transactions imported from 1 account": "{n} transacciones importadas de 1 cuenta",
  "{n} transactions imported from {accounts} accounts": "{n} transacciones importadas de {accounts} cuentas",
  "{n} transactions read": "{n} transacciones leídas",
  "{n} transactions read, 1 row left out": "{n} transacciones leídas, 1 fila omitida",
  "{n} transactions read, {skipped} rows left out": "{n} transacciones leídas, {skipped} filas omitidas",
  "…and {n} more.": "…y {n} más.",
};
