// src/app/privacy/policy-es.tsx — Prism's privacy policy in Spanish: a
// translation of policy-en.tsx, which governs. Held until a lawyer approves
// it against the English in force (legal-languages.ts); until then nobody is
// shown it, and /privacy reads in English in either language.
//
// It mirrors the English line for line: the same sections, with the same
// anchors, the same lists, and the same sentences turned on and off by the
// same switches. legal-spanish.test.ts renders both under every combination
// of switches and fails when they stop matching, so a change to the English
// has to come here too. The Spanish of the lists privacy.ts keeps as data is
// in lib/legal-es.ts.

import Link from "next/link";
import { Ban, KeyRound, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { Bullets, legalLink as link, Section, ShortVersion } from "@/components/legal";
import { Card, PageHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { governingNote, listEs, longDateEs } from "@/lib/legal-es";
import { POLICY_UPDATED, PRIVACY_CONTACT, providers, PUSH_SERVICES, STORED_ON_DEVICE, type PrivacySwitches } from "@/lib/privacy";

const EN_RESUMEN: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Prism puede leer tus cuentas, pero nunca puede mover dinero." },
  { icon: Ban, text: "No vendemos tus datos, no te mostramos anuncios ni usamos los datos de tu dinero para entrenar IA." },
  { icon: KeyRound, text: "Tu contraseña del banco va a tu banco a través de Plaid. Prism nunca la ve." },
  { icon: ShieldCheck, text: "Las claves de acceso a tus bancos y tus transacciones se cifran antes de guardarse." },
  { icon: Trash2, text: "Borra tu cuenta cuando quieras. Primero desconectamos todos tus bancos y luego borramos tus datos." },
];

/** The Spanish privacy policy, as the operator's switches have it: the same switches as the English. */
export function PoliticaDePrivacidad({ liabilities, homeValues, alchemy, alerts, billing }: PrivacySwitches) {
  const p = BRAND.product;
  const mail = <a href={`mailto:${PRIVACY_CONTACT}`} className={link}>{PRIVACY_CONTACT}</a>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Política de privacidad"
        subtitle={`Última actualización: ${longDateEs(POLICY_UPDATED)}. Cómo maneja ${p} los datos de tu dinero, en palabras sencillas.`}
      />

      <Card id="translation" as="div" className="mb-5 p-5 text-sm leading-relaxed text-ink-2 sm:p-6">
        {governingNote("la política de privacidad", POLICY_UPDATED)}
      </Card>

      <ShortVersion items={EN_RESUMEN} title="En resumen" />

      <Card as="article" className="mt-5 space-y-6 p-5 sm:p-8">
        <Section id="who" title="Quiénes somos">
          <p>
            {p} es una app de finanzas personales hecha por {BRAND.company} ({BRAND.companyShort}), a quien aquí llamamos &ldquo;nosotros&rdquo;. Esta política
            cubre el sitio web y la app de {p}. Preguntas o solicitudes: escribe a {mail}.
          </p>
        </Section>

        <Section id="collect" title="Qué recopilamos">
          <p className="font-semibold text-ink-1">Tu cuenta</p>
          <Bullets>
            <li>Tu dirección de correo, para que inicies sesión con un código de un solo uso. No hay contraseña.</li>
            <li>Tu nombre, si nos lo das, para que Prism te salude.</li>
            <li>Tu zona horaria, para que &ldquo;hoy&rdquo; y &ldquo;este mes&rdquo; coincidan con los tuyos.</li>
            <li>El idioma en que usaste {p} por última vez (inglés o español), para que sus correos y sus alertas en el teléfono lleguen en ese idioma.</li>
            <li>
              Si activas el inicio de sesión en dos pasos, el secreto que tu app de autenticación comparte con nosotros. Nuestro proveedor de inicio de sesión lo
              guarda para comprobar tus códigos.
            </li>
          </Bullets>
          <p className="font-semibold text-ink-1">El dinero que decides conectar</p>
          <Bullets>
            <li>
              Bancos, tarjetas, préstamos e inversiones, a través de Plaid: los nombres de las cuentas, los últimos cuatro dígitos de los números de cuenta, los
              saldos, las transacciones (comercio, monto, fecha y categoría) y las inversiones que tienes. Inicias sesión en tu banco a través de Plaid; {p} nunca
              ve tu usuario ni tu contraseña del banco.
              {liabilities ? (
                <>
                  {" "}
                  Con tu permiso, que Plaid te pide al conectar, {p} también lee los detalles de tus préstamos: la fecha de pago, el pago mínimo, el saldo del
                  estado de cuenta y la tasa de interés de cada tarjeta o préstamo, como máximo una vez al día. Los usa para mostrar cuándo vence cada pago, en
                  Futuro, en Patrimonio neto, en tus recordatorios del calendario y a las apps de IA que conectes, y los guarda cifrados con el resto de la copia
                  de ese banco. No se le muestran a tu hogar.
                </>
              ) : (
                <>
                  {" "}
                  Plaid también te pide permiso para los detalles de tus préstamos, como la fecha de pago, el pago mínimo y la tasa de interés de una tarjeta,
                  para que una función futura no te obligue a conectar de nuevo. {p} todavía no los lee, y esta página lo dirá antes de que lo haga.
                </>
              )}
            </li>
            <li>Coinbase, si lo conectas: tus saldos de cripto, solo para lectura.</li>
            <li>
              Conectar cualquiera de los dos requiere una cuenta de {p}. La conexión se guarda en tu cuenta, donde la protege tu inicio de sesión (y el inicio
              de sesión en dos pasos, si lo activas), y borrar tu cuenta la elimina.
            </li>
          </Bullets>
          <p className="font-semibold text-ink-1">Lo que configuras</p>
          <Bullets>
            <li>Tus presupuestos y metas.</li>
            <li>
              Tu hogar, si te unes a uno: quién está en él, cuáles de tus cuentas compartes con esas personas, y los presupuestos y metas que llevan juntos, con
              quién los cambió por última vez.
            </li>
            <li>Lo que agregas a mano, como tu casa, un auto o un préstamo, y lo que dices que vale, guardado cifrado.</li>
            {homeValues ? (
              <li>
                Si le pides a {p} que mantenga al día el valor de una vivienda, su dirección, guardada cifrada y nunca compartida con tu hogar, y las
                estimaciones mensuales de RentCast sobre su valor.
              </li>
            ) : null}
            <li>
              El historial que importas de un archivo, como una exportación de Mint o Monarch: las transacciones que eliges importar (la fecha, la descripción,
              el monto y la categoría de cada una), guardadas cifradas en tu cuenta. El archivo en sí se lee en tu dispositivo y nunca se envía a {p}.
            </li>
            <li>
              Si agregas un archivo de actividad de Venmo, PayPal o Cash App: por cada pago que coincide con una línea de tu banco, a quién se le pagó o de quién
              vino (el nombre de otra persona, tal como lo muestra esa app) y la nota que lleva, guardados cifrados en tu cuenta y nunca mostrados a tu hogar. El
              archivo en sí se lee en tu dispositivo y nunca se envía a {p}, y los pagos que no coinciden con una línea de tu banco no se guardan.
            </li>
            <li>
              Si agregas tu historial de pedidos de Amazon: por cada cargo de Amazon que coincide con una línea de tu banco, el número de pedido, el día en que lo
              hiciste, y el nombre, la cantidad y el costo de cada artículo, guardados cifrados en tu cuenta y nunca mostrados a tu hogar. El archivo en sí se lee
              en tu dispositivo y nunca se envía a {p}; las direcciones que contiene nunca se leen, y los pedidos que no coinciden con una línea de tu banco no se
              guardan.
            </li>
            <li>
              La dirección pública de cada billetera de cripto que agregues o, para una billetera de Bitcoin completa, su clave pública extendida, y lo último que
              tenía, guardadas cifradas y nunca compartidas con tu hogar. Una dirección pública es la que le darías a alguien para que te pague, y una clave
              pública extendida muestra todas las direcciones de una billetera: {p} puede ver lo que tienen y nunca puede moverlo, y nunca te pide una frase de
              recuperación ni una clave privada.
            </li>
            <li>
              Las categorías que corriges, como &ldquo;todo lo de esta tienda es supermercado&rdquo;, para que Prism archive tus compras donde las pusiste. Nombran
              las tiendas, así que se guardan cifradas, como tus transacciones.
            </li>
            <li>
              Lo que le agregas a una transacción: cómo la divides entre categorías (o cada compra en una tienda, lo que nombra la tienda), tus etiquetas, quién
              te debe por ella (el nombre que escribes y el monto), y qué transacciones y cuentas dejas fuera de tus totales, guardado cifrado en tu cuenta y nunca
              mostrado a tu hogar. Un recordatorio de lo que alguien te debe se escribe en tu dispositivo y va a donde lo envíes; {p} nunca lo envía.
            </li>
            <li>Tus próximas facturas y días de pago, si activas el enlace de calendario.</li>
            {alerts ? (
              <li>
                Si activas las alertas por correo: lo que elegiste que cubran; lo que tu última visita encontró que merecía una, como una factura que puede no
                estar cubierta, y las cifras de tus resúmenes (los de la semana pasada y los del mes pasado), guardados cifrados; y una huella de cada alerta
                enviada, para que ninguna se envíe dos veces. Una huella es un código del que no se puede sacar ningún banco, comercio ni monto.
              </li>
            ) : null}
            {alerts ? (
              <li>
                Si activas las alertas en un teléfono u otro dispositivo: lo que su navegador le da a {p} para llegar a él (una dirección en su servicio de
                notificaciones y las claves para cifrar los mensajes que recibe), guardado cifrado, y qué tipo de dispositivo es, como &ldquo;iPhone&rdquo;, para
                que puedas distinguir tus dispositivos.
              </li>
            ) : null}
            {alerts ? (
              <li>
                Si además dejas activado &ldquo;Revisar mis bancos cada mañana&rdquo;, {p} lee los saldos y las transacciones nuevas de tus bancos una vez cada
                mañana, aunque no lo hayas abierto, para que un correo de alerta hable de ese día. Los guarda cifrados como lo demás, y nunca lo hace con Coinbase
                conectado. Desactívalo en la página de Cuenta y solo tus propias visitas volverán a leer tus bancos.
              </li>
            ) : null}
            <li>Qué apps de IA has permitido que lean tu dinero, si hay alguna.</li>
            {billing ? (
              <li>
                Si te suscribes a {BRAND.plus}: qué plan tienes, si está en sus días gratis, pagado o terminado, las fechas en que se renueva o termina, y los
                números de referencia de Stripe para ti y para tu suscripción. Tu tarjeta y tu dirección de facturación van a Stripe, en su propia página,
                nunca a {p}.
              </li>
            ) : null}
          </Bullets>
          <p className="font-semibold text-ink-1">Detalles técnicos</p>
          <p>
            Como cualquier sitio web, nuestros proveedores de alojamiento y de inicio de sesión guardan registros técnicos por poco tiempo (dirección IP, tipo de
            navegador y la hora de cada solicitud) para mantener {p} seguro y funcionando. No usamos rastreadores de publicidad ni de analítica.
          </p>
        </Section>

        <Section id="use" title="Cómo lo usamos">
          <Bullets>
            <li>Para mostrarte tu dinero: saldos, gastos, presupuestos, metas, facturas y observaciones.</li>
            <li>Para mantener tus conexiones al día y avisarte cuando una necesita atención.</li>
            <li>Para iniciar tu sesión y enviarte tus códigos para iniciar sesión.</li>
            {alerts ? <li>Para enviarte alertas y resúmenes por correo, y las mismas alertas a tus dispositivos, si los activas.</li> : null}
            {billing ? <li>Para darte lo que incluye tu plan, y para cancelar {BRAND.plus} cuando borras tu cuenta.</li> : null}
            <li>Para responder las preguntas de las apps de IA que aprobaste, solo para lectura.</li>
            <li>Para mantener {p} seguro, evitar abusos y arreglar problemas.</li>
          </Bullets>
          <p>No vendemos tus datos, no los usamos para publicidad ni usamos tus datos financieros para entrenar modelos de IA.</p>
        </Section>

        <Section id="share" title="Quién más lo ve">
          <p>Solo las empresas que operan {p} por nosotros, y solo lo que cada una necesita:</p>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-ctl border border-line">
            {providers(homeValues, alchemy, alerts, billing).map((c) => (
              <li key={c.name} className="flex flex-col gap-1 bg-surface-2 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="w-24 shrink-0 font-semibold text-ink-1">{c.name}</span>
                <span className="min-w-0 flex-1">
                  {listEs(c.does)}{" "}
                  <a href={c.policy} className={link} target="_blank" rel="noopener noreferrer">
                    Su política de privacidad
                  </a>
                </span>
              </li>
            ))}
          </ul>
          <p>Y, solo cuando tú lo decides:</p>
          <Bullets>
            <li>
              <span className="font-semibold text-ink-1">Las apps de IA que conectes</span>, como Claude o ChatGPT. Leen tus cuentas, transacciones,
              presupuestos y metas solo para responder tus preguntas, nunca pueden cambiar nada, y la propia política de privacidad de esa empresa cubre lo que
              reciben. Desconéctalas cuando quieras en la página de{" "}
              <Link href="/account" className={link}>
                Cuenta
              </Link>
              .
            </li>
            <li>
              <span className="font-semibold text-ink-1">Las personas de tu hogar</span>, si te unes a uno. Ven los saldos y las transacciones de las cuentas que
              decides compartir, y nada más: ni tus otras cuentas, ni el inicio de sesión de tu banco, y nunca una forma de entrar a tu banco. Puedes dejar de
              compartir una cuenta, o salir del hogar, en cualquier momento, y surte efecto de inmediato. Si compartes Coinbase, solo ven su valor total según tu
              última visita, y {p} guarda ese único número, sellado, solo mientras lo compartes. Los presupuestos y las metas del hogar le pertenecen al hogar:
              todos los que están en él los ven y pueden cambiarlos, y se quedan con el hogar si sales. El historial que importas nunca se comparte con esas
              personas, ni siquiera el de una cuenta que compartes.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Tu app de calendario</span>, si te suscribes al calendario de facturas. Lee tus próximas facturas y
              días de pago, y los montos solo si eliges incluirlos.
            </li>
            {alerts ? (
              <li>
                <span className="font-semibold text-ink-1">El servicio de notificaciones de tu navegador</span>, si activas las alertas en un dispositivo. Lleva
                cada alerta a ese dispositivo, y lo opera la empresa que hace tu navegador:{" "}
                {PUSH_SERVICES.map((s, i) => (
                  <span key={s.name}>
                    {i ? "; " : null}
                    <a href={s.policy} className={link} target="_blank" rel="noopener noreferrer">
                      {s.name}
                    </a>{" "}
                    para {listEs(s.does).replace(/\.$/, "")}
                  </span>
                ))}
                . Cada alerta se cifra para tu dispositivo antes de salir de {p}, así que el servicio no puede leerla: solo ve que se envió un mensaje a tu
                dispositivo, de qué tamaño y cuándo.
              </li>
            ) : null}
          </Bullets>
          <p>
            También podemos compartir información cuando la ley lo exige, para proteger la seguridad de alguien, o si {BRAND.companyShort} llega a fusionarse o
            venderse. En ese caso te lo diríamos, y esta política seguiría protegiendo tus datos. Nunca vendemos ni alquilamos tu información personal.
          </p>
        </Section>

        <Section id="protect" title="Cómo lo protegemos">
          <Bullets>
            <li>Todo viaja por conexiones cifradas (HTTPS).</li>
            <li>
              Las claves que le permiten a {p} leer tus bancos y Coinbase, tus transacciones sincronizadas y tu calendario de facturas se cifran (AES-256) antes de
              guardarse.
            </li>
            <li>Nuestra base de datos está cifrada en reposo, y cada cuenta solo puede llegar a sus propios datos.</li>
            <li>Las apps de IA que conectes son solo de lectura. La propia base de datos rechaza cualquier cambio que intenten hacer.</li>
            <li>Para iniciar sesión se usa un código de un solo uso que se envía a tu correo, así que no hay contraseña que robar.</li>
            <li>
              Puedes agregar el inicio de sesión en dos pasos con una app de autenticación. Así tu correo por sí solo no puede abrir tu cuenta: hasta que se
              escriba el segundo código, la base de datos se niega a mostrar o cambiar cualquiera de tus datos.
            </li>
          </Bullets>
          <p>Ningún sistema es perfectamente seguro. Si alguna vez una filtración afecta tu información, te lo diremos como lo exige la ley.</p>
        </Section>

        <Section id="keep" title="Cuánto tiempo lo guardamos">
          <Bullets>
            <li>Mientras tengas una cuenta, guardamos tus datos para que {p} pueda mostrártelos.</li>
            <li>Las transacciones de tu banco de hace más de unos dos años salen de la copia que guarda {p}.</li>
            <li>El historial que importas se queda hasta que lo quitas en Conexiones o borras tu cuenta.</li>
            {homeValues ? <li>La dirección de una vivienda se queda hasta que desactivas sus estimaciones, quitas la vivienda o borras tu cuenta.</li> : null}
            <li>La dirección o la clave pública extendida de una billetera se queda hasta que quitas la billetera en Conexiones o borras tu cuenta.</li>
            {alerts ? (
              <li>
                Lo que se guarda para tus alertas por correo, y cada dispositivo en el que recibes alertas, se borra en el momento en que las desactivas. Un
                dispositivo también se borra cuando detienes las alertas en él, o cuando su servicio de notificaciones dice que ya no existe. Las huellas de las
                alertas ya enviadas se borran a los 120 días.
              </li>
            ) : null}
            {billing ? (
              <li>
                Lo que guardamos de una suscripción a {BRAND.plus} se queda mientras tengas una cuenta, para poder mostrarte lo que pagaste. Stripe guarda su
                propio registro de tus pagos, como lo exigen las leyes fiscales y de pagos, bajo su propia política de privacidad.
              </li>
            ) : null}
            <li>
              Cuando borras tu cuenta, primero desconectamos cada banco y cada vínculo con Coinbase, y luego borramos tu cuenta y todo lo que contiene. Las copias
              de seguridad cifradas de la base de datos desaparecen poco después.
            </li>
            <li>
              Si usas {p} sin una cuenta, tus presupuestos y metas se guardan en tu dispositivo, en las cookies que se enumeran abajo. Al borrar los datos de este
              sitio, se eliminan. Un banco o Coinbase conectado en un dispositivo antes de que conectar requiriera una cuenta se queda ahí, cifrado, hasta que
              inicies sesión, lo que lo pasa a tu cuenta, o hasta que caduque.
            </li>
          </Bullets>
        </Section>

        <Section id="choices" title="Tus opciones">
          <Bullets>
            <li>
              Desconecta cualquier banco, Coinbase o app de IA en cualquier momento desde{" "}
              <Link href="/connections" className={link}>
                Conexiones
              </Link>{" "}
              o{" "}
              <Link href="/account" className={link}>
                Cuenta
              </Link>
              .
            </li>
            <li>Cambia tu nombre, y desactiva el enlace de calendario, cuando quieras.</li>
            {billing ? <li>Cambia tu tarjeta, consulta tus recibos, cambia de plan o cancela {BRAND.plus} en la página de Cuenta.</li> : null}
            {alerts ? (
              <li>
                Activa o desactiva las alertas por correo, y elige qué cubren, en la página de Cuenta, o detenlas con el enlace que trae cualquiera de ellas. Ahí
                también puedes activar o desactivar las alertas en cada uno de tus dispositivos.
              </li>
            ) : null}
            <li>
              Borra tu cuenta para siempre en la página de{" "}
              <Link href="/account" className={link}>
                Cuenta
              </Link>
              .
            </li>
            <li>
              Descarga una copia de todo lo que {p} te muestra, cuando quieras, desde la página de{" "}
              <Link href="/account#data" className={link}>
                Cuenta
              </Link>
              : hojas de cálculo de tus transacciones, cuentas y saldos, presupuestos y metas, y un archivo con todo. Se hace solo con tus propias cuentas, nunca
              con las de otra persona de tu hogar.
            </li>
            <li>Pídenos una copia de cualquier otra cosa que tengamos sobre ti, o que la corrijamos, en {mail}.</li>
          </Bullets>
          <p>
            Según dónde vivas, como en California, puedes tener más derechos sobre tu información. Atendemos estas solicitudes vivas donde vivas, y nunca te
            tratamos de forma distinta por hacer una.
          </p>
        </Section>

        <Section id="device" title="Cookies y lo que se guarda en tu dispositivo">
          <p>{p} guarda solo lo que necesita para funcionar. No hay cookies de publicidad ni de rastreo. Aquí está todo, y lo que hace cada una:</p>
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-ctl border border-line">
            {STORED_ON_DEVICE.map((c) => {
              const lasts = listEs(c.lasts);
              return (
                <li key={c.name} className="bg-surface-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <code className="font-mono text-xs font-semibold text-ink-1">{c.name}</code>
                    <span className="text-xs text-ink-3">
                      {listEs(c.kind)} · se guarda {lasts.charAt(0).toLowerCase()}
                      {lasts.slice(1)}
                    </span>
                  </div>
                  <p className="mt-1">{listEs(c.what)}</p>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section id="children" title="Menores de edad">
          <p>
            {p} es para adultos de 18 años o más. No está pensado para menores, y si nos enteramos de que recopilamos información de un menor de 13 años, la
            borraremos.
          </p>
        </Section>

        <Section id="changes" title="Cambios a esta política">
          <p>
            Cuando esta política cambia, la fecha de arriba también cambia. Si un cambio importa, como un nuevo tipo de dato o una nueva empresa que lo ve, te lo
            diremos en la app o por correo antes de que entre en vigor.
          </p>
        </Section>

        <Section id="contact" title="Contáctanos">
          <p>
            Preguntas, solicitudes o inquietudes: escribe a {mail}. {BRAND.company}.
          </p>
        </Section>
      </Card>
    </div>
  );
}
