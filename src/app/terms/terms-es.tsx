// src/app/terms/terms-es.tsx — Prism's Terms of Service in Spanish: a
// translation of terms-en.tsx, which governs. Held until a lawyer approves it
// against the English in force (legal-languages.ts); until then nobody is
// shown it, and /terms reads in English in either language.
//
// It mirrors the English line for line: the same sections, with the same
// anchors, the same lists and the same links. legal-spanish.test.ts renders
// both and fails when they stop matching, so a change to the English has to
// come here too.

import Link from "next/link";
import { Info, KeyRound, Lock, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { Bullets, legalLink as link, Section, ShortVersion } from "@/components/legal";
import { Card, PageHeader } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { governingNote, longDateEs } from "@/lib/legal-es";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { LIABILITY_FLOOR_USD, MINIMUM_AGE, PRICE_NOTICE_DAYS, SECURITY_POLICY_URL, SHUTDOWN_NOTICE_DAYS, TERMS_CONTACT, TERMS_UPDATED, type TermsSwitches } from "@/lib/terms";

const EN_RESUMEN: { icon: LucideIcon; text: string }[] = [
  { icon: Lock, text: "Prism te muestra tu dinero. Puede leer tus cuentas, pero nunca puede mover dinero." },
  { icon: Info, text: "Es información, no asesoría financiera. Las decisiones son tuyas." },
  { icon: KeyRound, text: "Tu correo es la llave de tu cuenta. Mantenlo seguro y activa el inicio de sesión en dos pasos para tener más protección." },
  { icon: ShieldCheck, text: "Tus datos siguen siendo tuyos. Nunca los vendemos." },
  { icon: Trash2, text: "Puedes irte cuando quieras. Borrar tu cuenta desconecta todo y luego borra tus datos." },
];

/** The Spanish Terms of Service, as the operator's switches have them: the same switches as the English. */
export function TerminosDelServicio({ billing }: TermsSwitches) {
  const p = BRAND.product;
  const mail = (
    <a href={`mailto:${TERMS_CONTACT}`} className={link}>
      {TERMS_CONTACT}
    </a>
  );
  const privacy = (
    <Link href="/privacy" className={link}>
      política de privacidad
    </Link>
  );
  const account = (
    <Link href="/account" className={link}>
      Cuenta
    </Link>
  );
  const pricing = (
    <Link href="/pricing" className={link}>
      planes
    </Link>
  );
  const term = (words: string) => <span className="font-semibold text-ink-1">{words}</span>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Legal"
        title="Términos del servicio"
        subtitle={`Última actualización: ${longDateEs(TERMS_UPDATED)}. El acuerdo para usar ${p}, en palabras sencillas.`}
      />

      <Card id="translation" as="div" className="mb-5 p-5 text-sm leading-relaxed text-ink-2 sm:p-6">
        {governingNote("los términos del servicio", TERMS_UPDATED)}
      </Card>

      <ShortVersion items={EN_RESUMEN} title="En resumen" />

      <Card as="article" className="mt-5 space-y-6 p-5 sm:p-8">
        <Section id="agree" title="Aceptar estos términos">
          <p>
            Estos términos son un acuerdo entre tú y {BRAND.company} ({BRAND.companyShort}, &ldquo;nosotros&rdquo;) sobre el uso de {p}. Al crear una cuenta, o
            al usar {p} de cualquier forma, los aceptas. Si no estás de acuerdo, por favor no uses {p}.
          </p>
          <p>Nuestra {privacy} explica qué recopilamos, cómo lo usamos y quién más lo ve. Forma parte de este acuerdo.</p>
        </Section>

        <Section id="who" title="Quién puede usar Prism">
          <Bullets>
            <li>
              Para crear una cuenta o conectar cuentas, debes tener al menos {MINIMUM_AGE} años y vivir en los Estados Unidos. Cualquiera puede explorar el hogar
              de ejemplo.
            </li>
            <li>{p} es para tu uso personal, no para llevar un negocio ni para manejar el dinero de otras personas a cambio de un pago.</li>
            <li>Conecta solo cuentas que sean tuyas o que tengas permiso de ver.</li>
          </Bullets>
        </Section>

        <Section id="what" title="Qué es Prism, y qué no es">
          <p>
            {p} te muestra tus saldos, gastos, presupuestos, metas, facturas y pronósticos en un solo lugar. Solo lee tus cuentas. Nunca puede mover dinero,
            pagar facturas, abrir cuentas ni hacer operaciones de inversión.
          </p>
          <p>
            {p} no es un banco, una casa de bolsa, un asesor financiero ni una agencia de crédito. Lo que te muestra es información, no asesoría financiera, de
            inversión, fiscal ni legal. Los pronósticos, las observaciones y los presupuestos sugeridos son estimaciones basadas en tus transacciones pasadas, y
            pueden estar equivocados. Para decisiones importantes, habla con un profesional calificado.
          </p>
          <p>
            Tus números vienen de tus bancos y de otras empresas, a través de los proveedores que se nombran abajo. Pueden llegar tarde, estar incompletos o
            equivocados. Antes de confiar en uno, como un saldo antes de hacer un pago, confírmalo con tu banco.
          </p>
        </Section>

        <Section id="account" title="Tu cuenta">
          <Bullets>
            <li>
              Inicias sesión con un código de un solo uso que se envía a tu correo. Eso convierte tu correo en la llave de tu cuenta: cualquiera que pueda leerlo
              puede iniciar sesión, a menos que actives el inicio de sesión en dos pasos en la página de {account}. Mantén segura tu cuenta de correo.
            </li>
            <li>Eres responsable de lo que pasa en tu cuenta. Si crees que alguien más entró, escribe a {mail} de inmediato.</li>
            <li>
              Para protegerte, podemos pedirte que demuestres que la cuenta es tuya antes de atender una solicitud, como quitar el inicio de sesión en dos pasos,
              y podemos decir que no si no puedes hacerlo.
            </li>
          </Bullets>
        </Section>

        <Section id="connect" title="Conectar tus cuentas">
          <p>Tú eliges qué conectar, y puedes desconectar cualquier cosa en cualquier momento.</p>
          <Bullets>
            <li>
              Para conectar un banco o Coinbase necesitas una cuenta de {p}, así que cada conexión se guarda en tu cuenta, protegida por tu inicio de sesión, y se
              elimina cuando borras la cuenta.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Bancos, tarjetas, préstamos e inversiones</span> se conectan a través de Plaid. Al conectar uno,
              autorizas a {p} y a Plaid a obtener tu información de esa institución en tu nombre, y aceptas que Plaid la maneje según la{" "}
              <a href="https://plaid.com/legal/#end-user-privacy-policy" className={link} target="_blank" rel="noopener noreferrer">
                Política de privacidad para usuarios finales de Plaid
              </a>
              . Inicias sesión en tu banco a través de Plaid, y {p} nunca ve tu contraseña del banco.
            </li>
            <li>
              <span className="font-semibold text-ink-1">Coinbase</span>, si lo conectas, le da a {p} permiso para leer tus saldos, y nada más. Puedes retirar
              ese permiso en {p} o en Coinbase.
            </li>
            <li>
              Tus propios acuerdos con tus bancos y con Coinbase siguen aplicando. {p} no controla esas empresas, y no es responsable de sus servicios ni de una
              conexión que dejen de ofrecer.
            </li>
          </Bullets>
        </Section>

        <Section id="household" title="Compartir con tu hogar">
          <Bullets>
            <li>
              Puedes invitar a hasta otros tres adultos a un hogar. Cada persona conserva su propia cuenta de {p}, y nada de lo que hayas conectado se comparte
              hasta que decidas compartirlo.
            </li>
            <li>
              Comparte solo las cuentas que tengas derecho a compartir. Una cuenta que tienes con otra persona, compártela solo si esa persona está de acuerdo. Las
              personas con quienes compartes ven los saldos y las transacciones de esa cuenta; nunca obtienen una forma de entrar a tu banco.
            </li>
            <li>
              Un hogar puede llevar presupuestos y metas en común. Todos los que están en él los ven y pueden cambiarlos, y {p} muestra quién cambió cada lista por
              última vez. Le pertenecen al hogar, así que se quedan con él cuando alguien sale, y desaparecen cuando sale su último miembro.
            </li>
            <li>Puedes dejar de compartir una cuenta, o salir del hogar, en cualquier momento. Al salir, todo lo que compartías deja de compartirse de inmediato.</li>
          </Bullets>
        </Section>

        <Section id="apps" title="Apps de IA y tu calendario">
          <Bullets>
            <li>
              Si conectas una app de IA, como Claude o ChatGPT, la autorizas a leer tu información de {p} para responder tus preguntas. Nunca puede cambiar nada.
              Los términos y la política de privacidad de esa empresa cubren lo que hace con lo que lee. Las respuestas de una IA pueden estar equivocadas, así que
              confirma cualquier cosa importante. Desconecta una app cuando quieras en la página de {account}.
            </li>
            <li>
              Si activas el enlace de calendario, cualquiera que tenga ese enlace privado puede ver lo que incluye. No lo compartas, y restablécelo si se filtra.
            </li>
          </Bullets>
        </Section>

        <Section id="use" title="Usar Prism de forma justa">
          <p>Por favor, no:</p>
          <Bullets>
            <li>entres, ni intentes entrar, a la cuenta o a los datos de otra persona;</li>
            <li>sobrecargues, interrumpas o extraigas datos de {p} de forma automatizada, ni evadas sus límites o su seguridad;</li>
            <li>copies {p} para crear un servicio que compita con él, ni revendas el acceso a él;</li>
            <li>uses {p} para algo ilegal, ni para dañar o engañar a nadie.</li>
          </Bullets>
          <p>
            ¿Encontraste un problema de seguridad? Agradecemos los reportes hechos de buena fe y dentro de los límites de nuestra{" "}
            <a href={SECURITY_POLICY_URL} className={link} target="_blank" rel="noopener noreferrer">
              política de seguridad
            </a>
            .
          </p>
        </Section>

        <Section id="data" title="Tus datos">
          <p>
            Tus datos son tuyos. Nos permites manejarlos solo para operar {p} para ti, como lo describe nuestra {privacy}, y ese permiso termina cuando borras tu
            cuenta. Nunca vendemos tus datos. Si nos envías ideas o comentarios, podemos usarlos sin deberte nada por ellos.
          </p>
        </Section>

        <Section id="cost" title="Cuánto cuesta">
          {billing ? (
            <>
              <p>
                {p} tiene un plan gratis y uno de pago, {BRAND.plus}, para una persona o para todas las personas de un hogar. Lo que incluye y cuesta cada uno
                está en la página de {pricing}, y el precio se te muestra otra vez antes de pagar. Los precios están en dólares estadounidenses, más el impuesto
                sobre las ventas donde aplique.
              </p>
              <Bullets>
                <li>
                  {term("El pago.")} Stripe cobra tu pago en su propia página; {p} nunca ve tu tarjeta. Una primera suscripción empieza con {TRIAL_DAYS} días
                  gratis, y si cancelas antes de que terminen, no se te cobra.
                </li>
                <li>
                  {term("La renovación.")} {BRAND.plus} se renueva solo cada mes o cada año, como lo elegiste, y se cobra a tu tarjeta al inicio de cada periodo,
                  hasta que lo canceles. Puedes cancelar cuando quieras, en línea, en la página de {account}: conservas {BRAND.plus} hasta el final del tiempo que
                  pagaste, y no se te vuelve a cobrar.
                </li>
                <li>
                  {term("Reembolsos.")} Salvo que la ley diga otra cosa, los pagos no se reembolsan, tampoco por parte de un periodo. Si algo salió mal, escribe a{" "}
                  {mail} y lo revisaremos.
                </li>
                <li>
                  {term("Cambios de precio.")} Si cambiamos un precio, te avisaremos al menos {PRICE_NOTICE_DAYS} días antes de que se te aplique, y puedes
                  cancelar antes. Un precio de fundador se queda contigo mientras tu suscripción siga sin interrupción.
                </li>
                <li>
                  {term("Un pago que falla.")} Stripe lo intenta de nuevo durante un tiempo. Si el pago sigue sin procesarse, {BRAND.plus} termina y tu cuenta
                  vuelve al plan gratis.
                </li>
                <li>
                  {term(`Cuando ${BRAND.plus} termina.`)} No se borra nada de lo que agregaste. El plan gratis mantiene al día tu primera conexión; las demás, y
                  Coinbase, quedan en pausa y muestran lo último que dijeron hasta que vuelvas a suscribirte o las desconectes, y se detienen los correos de
                  alertas, tu enlace de calendario y las apps de IA conectadas. Un plan para el hogar cubre a las personas del hogar de quien lo paga, mientras
                  estén en él.
                </li>
              </Bullets>
            </>
          ) : (
            <p>
              {p} no te cobra nada hoy. Si algún día ofrecemos funciones de pago, primero te mostraremos el precio, y solo pagarás si así lo decides.
            </p>
          )}
        </Section>

        <Section id="ours" title="Prism en sí">
          <p>
            {p}, su nombre, su diseño y su software le pertenecen a {BRAND.companyShort}. Te damos un permiso personal para usar {p} según estos términos, que no
            puedes transferir a nadie más. El código fuente de {p} es público para que cualquiera pueda ver cómo protege tus datos, pero publicarlo no da permiso
            para copiarlo ni reutilizarlo.
          </p>
        </Section>

        <Section id="changes" title="Cambios, y mantener Prism funcionando">
          <Bullets>
            <li>
              Seguimos mejorando {p}, así que algunas funciones pueden cambiar o desaparecer. Trabajamos para mantenerlo funcionando, pero a veces puede no estar
              disponible, por ejemplo por mantenimiento o cuando un proveedor tiene una falla.
            </li>
            <li>
              Si algún día cerramos {p}, te avisaremos con al menos {SHUTDOWN_NOTICE_DAYS} días de anticipación cuando podamos, y tus datos se borrarán como lo
              describe nuestra {privacy}.
            </li>
            <li>
              Cuando estos términos cambian, la fecha de arriba también cambia. Si un cambio importa, te lo diremos en la app o por correo antes de que entre en
              vigor. Seguir usando {p} después significa que aceptas los nuevos términos. Si no los aceptas, puedes borrar tu cuenta.
            </li>
          </Bullets>
        </Section>

        <Section id="ending" title="Cerrar tu cuenta">
          <p>
            Puedes borrar tu cuenta cuando quieras en la página de {account}.{" "}
            {billing
              ? `Primero cancelamos ${BRAND.plus}, para que no se te vuelva a cobrar, y luego desconectamos cada banco y cada vínculo con Coinbase y borramos tu cuenta y todo lo que contiene.`
              : "Primero desconectamos cada banco y cada vínculo con Coinbase, y luego borramos tu cuenta y todo lo que contiene."}
          </p>
          <p>
            Podemos suspender o cerrar una cuenta que incumpla estos términos, que ponga en riesgo a otras personas o a {p}, o cuando la ley lo exija. Te diremos
            por qué cuando podamos. Las partes de estos términos que deben seguir vigentes, como los límites de abajo, siguen aplicando después.
          </p>
        </Section>

        <Section id="warranty" title="Exención de garantías">
          <p>
            Trabajamos mucho para que {p} sea preciso y confiable, pero lo ofrecemos &ldquo;tal cual&rdquo; y &ldquo;según disponibilidad&rdquo;. En la medida
            en que la ley lo permita, no prometemos que siempre esté disponible, que no tenga errores, que sea exacto ni que sirva para un propósito en
            particular. En algunos lugares no se permiten estas exenciones, así que es posible que algunas no apliquen en tu caso.
          </p>
        </Section>

        <Section id="liability" title="Límites de nuestra responsabilidad">
          <p>
            En la medida en que la ley lo permita, {BRAND.companyShort} no es responsable de pérdidas indirectas, incidentales, especiales, consecuentes ni
            punitivas, ni de la pérdida de ganancias o de datos. Eso incluye las pérdidas por decisiones tomadas con la información de {p}, y por lo que hagan o
            dejen de hacer tus bancos, Plaid, Coinbase o las apps de IA que conectes.
          </p>
          <p>
            En la medida en que la ley lo permita, nuestra responsabilidad total por cualquier reclamo se limita a la cantidad mayor entre lo que nos pagaste en
            los 12 meses anteriores al reclamo y ${LIABILITY_FLOOR_USD}. Nada en estos términos limita la responsabilidad por fraude, negligencia grave o mala
            conducta intencional, ni por cualquier otra cosa que la ley no nos permita limitar.
          </p>
        </Section>

        <Section id="disputes" title="Si algo sale mal">
          <p>
            Por favor, habla primero con nosotros: escribe a {mail}, y trataremos de resolverlo en un plazo de 30 días. Estos términos se rigen por las leyes de
            Texas y de los Estados Unidos. Una disputa que no se resuelva se lleva a los tribunales estatales o federales de Texas, a menos que la ley del lugar
            donde vives te dé derecho a llevarla ahí. Cualquiera de las dos partes también puede acudir a un tribunal de reclamos menores.
          </p>
        </Section>

        <Section id="notices" title="Cómo nos comunicamos contigo">
          <p>
            Aceptas que podemos enviarte avisos, incluidos los códigos para iniciar sesión, las alertas de seguridad y los cambios a estos términos, por correo a
            la dirección de tu cuenta o dentro de {p}, y que cuentan como avisos por escrito.
          </p>
        </Section>

        <Section id="general" title="Lo demás">
          <Bullets>
            <li>Estos términos y nuestra {privacy} son todo el acuerdo entre tú y nosotros sobre {p}.</li>
            <li>Si una parte de estos términos no se puede hacer cumplir, el resto sigue aplicando.</li>
            <li>Si no hacemos cumplir un término de inmediato, no hemos renunciado a él.</li>
            <li>No puedes transferir tu cuenta ni estos términos a otra persona. Nosotros podemos transferirlos si {BRAND.companyShort} se fusiona o se vende.</li>
          </Bullets>
        </Section>

        <Section id="contact" title="Contáctanos">
          <p>
            Preguntas sobre estos términos: escribe a {mail}. {BRAND.company}.
          </p>
        </Section>
      </Card>
    </div>
  );
}
