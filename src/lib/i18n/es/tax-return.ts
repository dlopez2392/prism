// src/lib/i18n/es/tax-return.ts — Spanish for a filed return: adding it from
// its PDF, checking its figures, and the returns on Taxes. In the voice and
// glossary of core.ts. Form names stay as the IRS writes them (Form 1040 is
// "el Formulario 1040" in a sentence, as the IRS's Spanish pages say it), and
// each figure follows the IRS's Spanish edition of the form. Filing statuses
// avoid gendered words for the reader: "Persona soltera", "Matrimonio que
// presenta…", "Cabeza de familia", "Cónyuge sobreviviente…".

export const TAX_RETURN: Record<string, string> = {
  "Add a filed return": "Agrega una declaración presentada",
  "Add your return": "Agrega tu declaración",
  "Add your {year} return": "Agrega tu declaración de {year}",
  "Adjusted gross income": "Ingreso bruto ajustado",
  "Amount you owed": "Monto que debías",
  "Business income or loss": "Ingreso o pérdida del negocio",
  "Check the figures": "Revisa las cifras",
  "Check the year and the figures, and add at least your adjusted gross income or your total tax.":
    "Revisa el año y las cifras, y agrega al menos tu ingreso bruto ajustado o tu impuesto total.",
  "Choose a PDF": "Elige un PDF",
  "Choose the PDF your tax software saved, and Prism puts last year's figures beside this year's: the tax, the refund or the bill, and what paying enough this year looks like. The file never leaves your device.":
    "Elige el PDF que guardó tu programa de impuestos, y Prism pone las cifras del año pasado junto a las de este año: el impuesto, el reembolso o lo que debías, y cuánto sería pagar lo suficiente este año. El archivo nunca sale de tu dispositivo.",
  "Choose your return": "Elige tu declaración",
  "Effective rate": "Tasa efectiva",
  "Estimated tax payments": "Pagos de impuesto estimado",
  "Filing status": "Estado civil para la declaración",
  "Filing status not given": "Estado civil no indicado",
  "For {year}, paying at least {amount} through withholding and estimated payments, 110% of your {last} total tax since your income was over $150,000, generally avoids an underpayment penalty.":
    "Para {year}, pagar al menos {amount} entre retenciones y pagos estimados, el 110% de tu impuesto total de {last} porque tu ingreso pasó de $150,000, por lo general evita una multa por pago insuficiente.",
  "For {year}, paying at least {amount} through withholding and estimated payments, your {last} total tax, generally avoids an underpayment penalty.":
    "Para {year}, pagar al menos {amount} entre retenciones y pagos estimados, tu impuesto total de {last}, por lo general evita una multa por pago insuficiente.",
  "From {file}. Check each one against your return: change any that's wrong, and leave blank any your return doesn't have.":
    "De {file}. Compara cada una con tu declaración: cambia la que esté mal y deja en blanco la que tu declaración no tenga.",
  "Head of household": "Cabeza de familia",
  "Information, not tax advice. The figures are what you saved from your return; Prism doesn't check them with the IRS.":
    "Información, no asesoría de impuestos. Las cifras son las que guardaste de tu declaración; Prism no las verifica con el IRS.",
  "Its figures are kept, encrypted, in your account, and you can remove them whenever you like.": "Sus cifras se guardan cifradas en tu cuenta, y puedes quitarlas cuando quieras.",
  "Last year's figures beside this year's money: what you earned, the tax, the refund or the bill, and what paying enough this year looks like.":
    "Las cifras del año pasado junto al dinero de este año: lo que ganaste, el impuesto, el reembolso o lo que debías, y cuánto sería pagar lo suficiente este año.",
  "Line {line}": "Línea {line}",
  "Link a bank or import your history first, and your return's figures sit beside them on Taxes.":
    "Primero conecta un banco o importa tu historial, y las cifras de tu declaración quedan junto a ellos en Impuestos.",
  "Link a bank or import your history first: your return sits beside your own money.": "Primero conecta un banco o importa tu historial: tu declaración va junto a tu propio dinero.",
  "Married filing jointly": "Matrimonio que presenta una declaración conjunta",
  "Married filing separately": "Matrimonio que presenta declaraciones por separado",
  "Not sure": "No lo sé",
  "Only the figures on a few lines of your Form 1040 are kept, after you check them: never your name, Social Security number, address, dependents or bank details.":
    "Solo se guardan las cifras de algunas líneas de tu Formulario 1040, después de que las revises: nunca tu nombre, tu número de Seguro Social, tu dirección, tus dependientes ni tus datos bancarios.",
  "Open it": "Abrirlo",
  "PDF password": "Contraseña del PDF",
  "Prism couldn't find a Form 1040 in that file. Type the figures in from your return, or choose another file.":
    "Prism no encontró un Formulario 1040 en ese archivo. Escribe las cifras de tu declaración, o elige otro archivo.",
  "Put back.": "De vuelta.",
  "Qualifying surviving spouse": "Cónyuge sobreviviente que reúne los requisitos",
  "Reading your return…": "Leyendo tu declaración…",
  "Remove your {year} return": "Quitar tu declaración de {year}",
  "Save these figures": "Guardar estas cifras",
  "Schedule 1, line {line}": "Schedule 1, línea {line}",
  "Sign in to add your return": "Inicia sesión para agregar tu declaración",
  Single: "Persona soltera",
  "Tax withheld": "Impuesto retenido",
  "Taxable income": "Ingreso tributable",
  "That file couldn't be opened as a PDF. Choose the PDF of your return, or type the figures in yourself.":
    "Ese archivo no se pudo abrir como PDF. Elige el PDF de tu declaración, o escribe tú las cifras.",
  "That file is over 20 MB. Choose the PDF of your return as your tax software saved it.": "Ese archivo pasa de 20 MB. Elige el PDF de tu declaración tal como lo guardó tu programa de impuestos.",
  "That password didn't open it. Try again.": "Esa contraseña no lo abrió. Inténtalo de nuevo.",
  "The PDF your tax software saved when you filed: TurboTax, H&R Block, FreeTaxUSA or any other. It's opened on this device and never uploaded.":
    "El PDF que guardó tu programa de impuestos cuando presentaste: TurboTax, H&R Block, FreeTaxUSA o cualquier otro. Se abre en este dispositivo y nunca se sube.",
  "There's no {year} return to remove.": "No hay una declaración de {year} que quitar.",
  "This PDF has a password": "Este PDF tiene contraseña",
  "Total income": "Ingreso total",
  "Total payments": "Pagos totales",
  "Total tax": "Impuesto total",
  "Type each one from your Form 1040. Leave blank any your return doesn't have.": "Escribe cada una de tu Formulario 1040. Deja en blanco la que tu declaración no tenga.",
  "Type the figures in yourself": "Escribir las cifras yo",
  "Type the password you set when you saved it. It's used on this device to open the file, and never sent or kept.":
    "Escribe la contraseña que pusiste al guardarlo. Se usa en este dispositivo para abrir el archivo, y nunca se envía ni se guarda.",
  "You owed": "Debías",
  "Your return goes beside your own money": "Tu declaración va junto a tu propio dinero",
  "Your returns": "Tus declaraciones",
  "Your {last} return had {amount} of business income. Your business accounts show {now} so far in {year}.":
    "Tu declaración de {last} tenía {amount} de ingreso del negocio. Tus cuentas de negocio muestran {now} en lo que va de {year}.",
  "Your {year} return": "Tu declaración de {year}",
  "Your {year} return is removed.": "Se quitó tu declaración de {year}.",
  "Your {year} return is saved. It's on Taxes beside this year's money.": "Se guardó tu declaración de {year}. Está en Impuestos junto al dinero de este año.",
  "Your {year} return, as filed": "Tu declaración de {year}, tal como la presentaste",
  "{figure} isn't an amount. Use digits, like 85,432.": "{figure} no es un monto. Usa números, como 85,432.",
};
