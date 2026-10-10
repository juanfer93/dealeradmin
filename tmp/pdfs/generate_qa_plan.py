from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


OUTPUT = r"C:\dev\dealeradmin\output\pdf\dealeradmin-plan-qa-e2e-local-2026-09-11.pdf"

NAVY = colors.HexColor("#102A43")
TEAL = colors.HexColor("#0B8F87")
LIGHT_TEAL = colors.HexColor("#E8F4F2")
PALE_BLUE = colors.HexColor("#EEF4F8")
INK = colors.HexColor("#243B53")
MUTED = colors.HexColor("#627D98")
LINE = colors.HexColor("#D9E2EC")
WARN = colors.HexColor("#FFF4D6")
WHITE = colors.white

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=9, leading=12, textColor=TEAL, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=28, leading=33, textColor=NAVY, alignment=TA_LEFT, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=18, textColor=INK, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=17, leading=21, textColor=NAVY, spaceBefore=8, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11, leading=14, textColor=TEAL, spaceBefore=10, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.2, leading=13.5, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.7, leading=10.4, textColor=MUTED, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=7.5, leading=9.2, textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["Normal"], fontName="Helvetica",
    fontSize=7.35, leading=9.3, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableCellBold", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=7.35, leading=9.3, textColor=INK,
))
styles.add(ParagraphStyle(
    name="Prompt", parent=styles["Normal"], fontName="Courier",
    fontSize=6.75, leading=8.3, textColor=INK,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9, leading=13, textColor=NAVY, leftIndent=6, rightIndent=6,
    spaceBefore=3, spaceAfter=3,
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def table(data, widths, header=True, padding=6):
    converted = []
    for row_index, row in enumerate(data):
        converted.append([
            item if hasattr(item, "wrap") else P(str(item), "TableHead" if header and row_index == 0 else "TableCell")
            for item in row
        ])
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), padding),
        ("RIGHTPADDING", (0, 0), (-1, -1), padding),
        ("TOPPADDING", (0, 0), (-1, -1), padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ]
        for row_index in range(1, len(converted)):
            if row_index % 2 == 0:
                commands.append(("BACKGROUND", (0, row_index), (-1, row_index), PALE_BLUE))
    else:
        for row_index in range(len(converted)):
            if row_index % 2 == 1:
                commands.append(("BACKGROUND", (0, row_index), (-1, row_index), PALE_BLUE))
    result = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    result.setStyle(TableStyle(commands))
    return result


def bullet(text):
    return P("<font color='#0B8F87'>-</font> " + text, "Bodyx")


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(0.65 * inch, 0.54 * inch, 7.85 * inch, 0.54 * inch)
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.65 * inch, 0.35 * inch, "dealerADMIN | QA E2E local | Documento de preparacion")
    canvas.drawRightString(7.85 * inch, 0.35 * inch, f"Pagina {doc.page}")
    canvas.restoreState()


class QAPlanDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=letter, leftMargin=0.65 * inch, rightMargin=0.65 * inch,
                         topMargin=0.58 * inch, bottomMargin=0.72 * inch, title="Plan de QA E2E local dealerADMIN")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=footer)])


story = []

# Cover
story += [Spacer(1, 0.7 * inch), P("PLAN DE PRUEBAS | SESION DE MANANA", "CoverKicker")]
story += [P("QA E2E general<br/>dealerADMIN en local", "CoverTitle")]
story += [P("Simulacion de webhooks por conversacion, persistencia en PostgreSQL de Docker, normalizacion, reparacion automatica, ventanas horarias y ruteo de todos los dealers.", "CoverSub")]
story += [Spacer(1, 0.16 * inch)]
story += [table([
    ["Documento", "Plan de QA E2E local"],
    ["Fecha de preparacion", "11 de septiembre de 2026"],
    ["Ejecucion", "Local; el tiempo de negocio se simula"],
    ["Persistencia", "Base de datos PostgreSQL en Docker"],
    ["Integraciones externas", "No se usan GHL, Neon ni webhooks reales"],
], [1.55 * inch, 5.05 * inch], header=False)]
story += [Spacer(1, 0.22 * inch)]
story += [Table([[P("OBJETIVO DE SALIDA", "TableHead")], [P("No se cierra la sesion hasta que todos los criterios de aceptacion pasen con evidencia en la BD local y en las respuestas del API. Si aparece un fallo, se agrega el caso, se corrige, se repite y se registra en el reporte final.", "Callout")]], colWidths=[6.6 * inch], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), TEAL), ("BACKGROUND", (0, 1), (-1, -1), LIGHT_TEAL), ("BOX", (0, 0), (-1, -1), 0.7, TEAL), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))]
story += [Spacer(1, 0.35 * inch), P("Nota de interpretacion", "H2x"), P("Hay dos relojes diferentes: el proceso tecnico de reconciliacion se intenta cada 30 segundos; la ventana comercial para una cualificacion incompleta es de 30 minutos entre 03:00 y 15:00, y de 3 horas entre 15:00 y 03:00. Ambos se prueban con tiempo simulado, sin esperar en tiempo real.", "Bodyx")]
story += [PageBreak()]

# 1. Scope and architecture
story += [P("1. Alcance y modelo de prueba", "H1x")]
story += [P("Cada conversacion representa una accion nueva del webhook Customer Replied. El arnes local enviara un evento firmado al endpoint del source, insertara o reutilizara la conversacion correcta y agregara mensajes entrantes uno a uno. Las aserciones se haran contra la BD de Docker y contra las respuestas del API; una prueba de HTTP 200 por si sola no sera suficiente.", "Bodyx")]
story += [P("Flujo que se debe observar", "H2x")]
story += [table([
    ["Paso", "Evidencia esperada"],
    ["1. Simular evento", "Firma HMAC valida; source, canal, contacto, conversacion, mensaje y nombre presentes."],
    ["2. Persistir", "webhook_events y conversation_messages reciben el evento/mensaje de forma idempotente."],
    ["3. Reunir contexto", "La conversacion conecta todos sus mensajes; el snapshot conserva campos por categoria."],
    ["4. Normalizar", "Nombre, telefono, vehiculo, down, plazo, idioma, documentos e identificacion se asignan solo con evidencia."],
    ["5. Resolver", "Se calcula estado, next_attempt_at, dealer y razon de ruteo sin mezclar fuentes."],
    ["6. Reconciliar", "La revision de 30 segundos relee la misma conversacion y corrige campos vacios o fuera de lugar."],
    ["7. Exponer", "El frontend local muestra el dealer correcto, estado, contexto y etiquetas de cualificacion."],
], [1.25 * inch, 5.35 * inch])]
story += [P("Reglas que se fijan para esta sesion", "H2x")]
story += [bullet("La hora de negocio siempre es America/Bogota, incluso cuando el dealer tenga otra configuracion operativa."), bullet("No se esperan 30 minutos ni 3 horas: se avanza el reloj de prueba o se inyecta now en el servicio."), bullet("Un numero aislado como 1000, 2000 o 3000 es candidato a down; un año como 2018, 2019 o 2025 nunca es down."), bullet("‘Financiar un auto’ y botones publicitarios no se clasifican como vehiculo; ‘busco un Mustang’, ‘tengo un truck’ o ‘quiero tal carro’ si son evidencia de vehiculo."), bullet("En Messenger, real_name nace del nombre del contacto; en WhatsApp, solo se reemplaza cuando la persona declara explicitamente su nombre. Preguntas del bot, botones y respuestas irrelevantes permanecen fuera de real_name."), bullet("ID, cuenta bancaria y prueba de ingresos solo se consideran verdaderos cuando la persona los declara explicitamente; no bloquean la cualificacion core en esta version."), bullet("Si una respuesta no puede atribuirse con seguridad a la pregunta correspondiente, el campo queda vacio/null y se registra como ambiguedad."), bullet("Si ya existe otra conversacion queued con el mismo nombre normalizado y telefono normalizado, la nueva no entra en cola."), bullet("Una correccion manual a waiting_window con next_attempt_at null recibe una fecha calculada por el backend en la siguiente revision."), bullet("El estado sent/routing enviado no se debe reabrir por una reconciliacion tardia."),]
story += [PageBreak()]

# 2. Dealer matrix
story += [P("2. Matriz de dealers, fuentes y endpoints", "H1x")]
story += [P("Cada fila de esta tabla tendra al menos un caso de entrada. En Action Cars se usa un solo endpoint y el backend separa idioma. En Millersville se usa un solo endpoint y el backend alterna los dos destinos.", "Bodyx")]
story += [table([
    ["Familia / dealer", "Canal", "Source / webhook local", "Validacion principal"],
    ["Stafford", "WhatsApp", "/webhooks/ghl/customer-replied/stafford", "El telefono ya viene registrado; nombre declarado solo si existe."],
    ["Fredericksburg", "Messenger", "/webhooks/ghl/customer-replied/fredericksburg", "Nombre de contacto y normalizacion sin contaminacion."],
    ["Fredericksburg 2", "Messenger", "/webhooks/ghl/customer-replied/fredericksburg-2", "Source independiente y canal correcto."],
    ["Easterns general", "Messenger", "/webhooks/ghl/customer-replied/easterns", "Rosedale/Laurel/Sterling y prioridad geografica."],
    ["Arlington Motors of Woodbridge", "Messenger / Instagram", "/webhooks/ghl/customer-replied/arlington", "No cae en Easterns; locationId y nombre independientes."],
    ["Koons de Fredericksburg", "Messenger / Instagram", "/webhooks/ghl/customer-replied/koons-fred", "Dealer separado, workflow y URL propios."],
    ["Koons Automotive of Fredericksburg", "Messenger / Instagram", "/webhooks/ghl/customer-replied/koons-fred-eng", "Dealer separado; no compartir cola con el anterior."],
    ["Koons Automotive of Culpeper", "Messenger", "/webhooks/ghl/customer-replied/koons-culpeper", "Dealer separado y source independiente."],
    ["Action Pre Owned Cars", "Messenger", "/webhooks/ghl/customer-replied/action-cars", "Idioma es -> Action Cars Espanol; en -> Action Cars English."],
    ["Easterns Millersville / Nissan White Marsh", "Messenger", "/webhooks/ghl/customer-replied/easterns-millersville", "Alternancia estricta entre ambos dealers."],
    ["Easterns Frederick", "Messenger", "/webhooks/ghl/customer-replied/easterns-frederick", "Dealer independiente."],
], [1.55 * inch, 1.0 * inch, 2.22 * inch, 1.83 * inch], padding=4)]
story += [P("Precondiciones de entorno", "H2x")]
story += [bullet("PostgreSQL local levantado con Docker y migraciones aplicadas. La prueba debe imprimir el nombre del contenedor y la cadena de conexion sin secretos."), bullet("API local levantada en el puerto usado por el proyecto y frontend local apuntando a esa API."), bullet("Secret HMAC de prueba inyectado solo en el proceso de test; nunca usar el secreto real ni imprimirlo."), bullet("Reloj controlable: fecha fija y helper para avanzar 15 segundos, 30 segundos, 30 minutos y 3 horas."), bullet("Datos de prueba con IDs deterministas por escenario, para que cada conversacion pueda auditarse sin depender del orden accidental."),]
story += [PageBreak()]

# 3. Scenarios
story += [P("3. Escenarios E2E obligatorios", "H1x")]
scenario_rows = [
    ["ID", "Escenario", "Pasos resumidos", "Resultado"],
    ["E2E-01", "Messenger incremental", "Crear conversacion; responder vehiculo; numero; down; plazo; revisar cada paso en BD.", "Campos correctos; no se contaminan con preguntas."],
    ["E2E-02", "WhatsApp incremental", "Telefono inicial; declarar nombre; responder vehiculo, down y plazo.", "Se conserva telefono; nombre declarado reemplaza solo si es explicito."],
    ["E2E-03", "Normalizacion tardia", "Guardar respuesta nueva no normalizada; avanzar 30 s; forzar poll; verificar snapshot.", "La misma conversacion se reconsulta y se corrige."],
    ["E2E-04", "Ventana diurna", "Cualificacion incompleta a las 10:00 Bogota; avanzar 30 min.", "waiting_window usa +30 min; al vencer puede pasar a queued."],
    ["E2E-05", "Ventana nocturna", "Cualificacion incompleta a las 20:00 Bogota; avanzar 3 h.", "waiting_window usa +3 h; no usa hora del servidor ni del dealer."],
    ["E2E-06", "Manual sin fecha", "Cambiar manualmente a waiting_window con next_attempt_at null; poll.", "Backend calcula next_attempt_at automaticamente."],
    ["E2E-07", "Action Cars idioma", "Dos conversaciones, una en espanol y otra en ingles, mismo endpoint.", "Cada una llega al dealer Action correcto; nunca al otro."],
    ["E2E-08", "Millersville alternado", "Enviar dos o mas conversaciones elegibles al endpoint compartido.", "Millersville, White Marsh, Millersville... sin saltos."],
    ["E2E-09", "Easterns geografico", "Casos con Rosedale, Laurel, Sterling y municipio ambiguo.", "Consulta BD, prioridad y rotacion aplicadas; estado auditable."],
    ["E2E-10", "Duplicado queued", "Reenviar mismo nombre + telefono cuando existe queued.", "Nueva entrada queda duplicate_ignored; no crea nueva cola."],
    ["E2E-11", "Contaminacion de nombre", "Mensajes: ‘Que requisitos necesito’, ‘financiar un auto’, ‘Mustang’ como respuestas aisladas.", "No se guardan como real_name o vehiculo salvo evidencia contextual valida."],
    ["E2E-12", "Correccion de telefono", "Enviar primer numero y despues un numero corregido.", "canonical_phone y snapshot usan el numero valido mas reciente, con auditoria."],
    ["E2E-13", "Documentos explicitos", "Decir ‘tengo identificacion’, ‘tengo cuenta bancaria’ y ‘tengo prueba de ingresos’.", "Se marca la evidencia correspondiente sin mezclarla con vehiculo/down."],
    ["E2E-14", "Proteccion sent", "Reconciliar una conversacion ya enviada.", "No reabre ni duplica el despacho."],
]
story += [table(scenario_rows, [0.55 * inch, 1.25 * inch, 2.75 * inch, 2.05 * inch], padding=4)]
story += [Spacer(1, 0.08 * inch), P("Para cada escenario se guardaran: conversation_id, event_id, message_ids, estado antes/despues, qualification_snapshot, location_snapshot, dealer asignado, next_attempt_at, razon de ruteo y consulta SQL de evidencia.", "Smallx")]
story += [PageBreak()]

# 4. acceptance criteria
story += [P("4. Criterios de aceptacion", "H1x")]
story += [P("Un criterio solo es PASS cuando existe evidencia reproducible en la BD local, respuesta del API o captura del frontend local. ‘Parece correcto’ no cuenta como aprobado.", "Bodyx")]
acceptance_rows = [
    ["#", "Criterio", "Evidencia minima"],
    ["AC-01", "Cada conversacion genera un evento de webhook trazable.", "event_id, source y ghl_conversation_id relacionados sin colision."],
    ["AC-02", "Firma simulada y payload invalido se comportan correctamente.", "Valido acepta; firma ausente, alterada o body alterado rechaza."],
    ["AC-03", "Todos los mensajes entrantes se guardan una sola vez.", "conversation_messages conserva orden, cuerpo y occurred_at; reintento no duplica."],
    ["AC-04", "La identidad se normaliza por canal.", "Messenger usa contacto; WhatsApp usa declaracion explicita o fallback de contacto."],
    ["AC-05", "real_name no se contamina.", "Preguntas, botones y respuestas sin nombre quedan fuera; nombres declarados si entran."],
    ["AC-06", "Vehiculo solo usa evidencia de vehiculo.", "Financiar/boton no entra; marca/modelo en contexto si entra; años no son down."],
    ["AC-07", "Down y plazo se separan.", "1000/2000/3000 se detectan como down; 2018/2019/2025 no; fechas no se guardan como down."],
    ["AC-08", "Documentos e identificacion no bloquean el core.", "Core completo puede pasar a queued aunque estos falten; evidencia explicita se refleja."],
    ["AC-09", "La reconciliacion real corre cada 30 s.", "Fake timers o reloj de integracion demuestran invocacion; se relee la BD y el transcript."],
    ["AC-10", "La reconciliacion no mezcla campos.", "Cada correccion solo actualiza el campo respaldado; incertidumbre queda null/vacia."],
    ["AC-11", "Ventanas usan Bogota.", "10:00 -> +30 min; 20:00 -> +3 h; DST/zone del servidor no cambia resultado."],
    ["AC-12", "waiting_window manual sin fecha se repara.", "next_attempt_at pasa de null a una fecha calculada sin borrar correcciones manuales."],
    ["AC-13", "Action Cars divide idioma.", "es y en llegan a dealers separados desde el mismo endpoint."],
    ["AC-14", "Millersville rota.", "Secuencia esperada A/B/A/B persistida en dealer_round_robin_state y lead_dealers."],
    ["AC-15", "Easterns consulta/rutea ubicacion.", "Ciudad encontrada en BD; prioridad MD/VA ante colision de nombres salvo estado explicito."],
    ["AC-16", "Duplicado queued no se publica.", "Mismo nombre + mismo telefono + queued => duplicate_ignored y cero nueva cola."],
    ["AC-17", "Estados son coherentes.", "partial, waiting_window, queued y sent respetan transiciones y timestamps."],
    ["AC-18", "No hay fuga entre dealers.", "Cada source/locationId solo ve su cola; no se mezcla Easterns con Arlington/Koons/Action."],
    ["AC-19", "Reprocesamiento es seguro.", "Poll concurrente no duplica eventos ni reasigna sent; errores permiten siguiente reintento."],
    ["AC-20", "Frontend refleja la BD.", "Dealer, nombre, telefono, vehiculo, etiquetas y estado coinciden con snapshot persistido."],
]
story += [table(acceptance_rows, [0.52 * inch, 2.35 * inch, 3.73 * inch], padding=4)]
story += [PageBreak()]

# 5. QA mega prompt
story += [P("5. Mega prompt de QA", "H1x")]
story += [P("Copiar y pegar este prompt al agente que ejecute la sesion. El agente no debe dar PASS por inferencia visual: cada resultado debe conectar webhook, mensaje, snapshot, estado y dealer en la BD local.", "Bodyx")]
prompt = """Actua como QA senior de dealerADMIN. Ejecuta un E2E GENERAL completamente local.

REGLAS DE ENTORNO
- Usa PostgreSQL de Docker y la API/frontend locales. No uses GHL, Neon ni cuentas reales.
- Usa un secreto HMAC simulado inyectado por variables de prueba. Nunca imprimas secretos.
- Cada conversacion es una accion nueva de webhook: usa un conversation_id y event_id deterministas por caso.
- Controla el reloj. No esperes 30 minutos ni 3 horas reales. Simula 15 s, 30 s, 30 min y 3 h.
- La hora de negocio es America/Bogota para todos los dealers.
- Antes de empezar, registra commit, contenedor, migracion, URL local y esquema. No borres datos de usuario fuera del namespace de pruebas.

QUE DEBES EJECUTAR
1. Levanta DB, API y frontend locales; verifica salud y migraciones.
2. Envia payloads Customer Replied firmados a cada source configurado:
   stafford, fredericksburg, fredericksburg-2, easterns, arlington,
   koons-fred, koons-fred-eng, koons-culpeper, action-cars,
   easterns-millersville y easterns-frederick.
3. Para Messenger simula nombre de contacto y respuestas incrementales.
4. Para WhatsApp entrega telefono inicial y prueba declaracion explicita de nombre.
5. En cada paso consulta la BD y confirma que conversation_messages,
   webhook_events, conversations, leads y lead_dealers se conectan por los IDs correctos.
6. Prueba respuestas contaminantes: preguntas del bot, botones de publicidad,
   ‘financiar un auto’, ‘Mustang’ aislado, años y respuestas ambiguas.
7. Prueba respuestas validas: ‘busco un Mustang’, ‘tengo un truck’, 1000/2000/3000,
   plazo, nombre declarado, identificacion, cuenta bancaria y prueba de ingresos.
8. Prueba correccion de telefono: primer numero invalido y segundo numero valido.
9. Deja una conversacion incompleta, agrega despues un mensaje entrante que falte,
   avanza 30 s y ejecuta/observa el poll; verifica que la misma conversacion se repare.
10. Cambia manualmente una conversacion a waiting_window con next_attempt_at null;
    ejecuta el proceso debido y confirma fecha calculada.
11. Prueba 10:00 Bogota y 20:00 Bogota: espera simulada de 30 min y 3 h.
12. Action Cars: un caso es y otro en por el mismo endpoint; verifica dealers separados.
13. Millersville: varios casos; verifica Millersville, White Marsh, Millersville, White Marsh.
14. Easterns: Rosedale, Laurel, Sterling, estados explicitos y nombre ambiguo;
    consulta ubicaciones y valida prioridad MD/VA ante colisiones salvo estado explicito.
15. Reenvia un mismo nombre normalizado + telefono cuando ya existe queued;
    debe quedar duplicate_ignored y no crear cola nueva.
16. Reprocesa una conversacion sent y una con poll concurrente; no debe duplicar ni reabrir.

CRITERIO DE EVIDENCIA POR CASO
Guarda: case_id, payload hash, event_id, conversation_id, message_ids,
estado antes/despues, snapshot antes/despues, location_snapshot,
dealer asignado, next_attempt_at, routing_reason, SQL de verificacion,
y resultado del frontend local si aplica.

REGLA DE NORMALIZACION
Si el bot pregunta algo y la respuesta no tiene evidencia suficiente para una categoria,
deja ese campo null/vacio. No adivines y no mezcles real_name, vehicle_type,
down_payment, purchase_timeline, documents, identification o bank_account.

SALIDA OBLIGATORIA
- Matriz PASS/FAIL por AC-01 a AC-20.
- Lista de fallos con causa raiz y archivo/consulta involucrada.
- Correccion aplicada solo despues de capturar evidencia del fallo.
- Reejecucion de cada caso fallido y regresion de los casos relacionados.
- No cierres con PASS global hasta que todos los criterios pasen.
- Si algo queda bloqueado por infraestructura, marca BLOCKED y explica exactamente la dependencia; no lo llames PASS."""
prompt_lines = [P(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") or " ", "Prompt") for line in prompt.splitlines()]
prompt_box = Table([[p] for p in prompt_lines], colWidths=[6.6 * inch], style=TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F5F7FA")),
    ("BOX", (0, 0), (-1, -1), 0.7, LINE),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 1.5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
]))
story += [prompt_box]
story += [PageBreak()]

# 6. runbook and final report
story += [P("6. Orden de ejecucion y reporte final", "H1x")]
story += [P("La sesion seguira este orden para que un fallo temprano no oculte un fallo de ruteo o de ventana:", "Bodyx")]
story += [table([
    ["Fase", "Accion", "Salida"],
    ["A. Arranque", "Docker, migraciones, salud API/frontend, reloj de prueba.", "Baseline reproducible."],
    ["B. Captura", "Eventos individuales por source y canal.", "Eventos y mensajes persistidos."],
    ["C. Recoleccion", "Responder pregunta por pregunta y observar snapshots.", "Normalizacion incremental."],
    ["D. Reparacion", "Agregar datos tardios; ejecutar poll de 30 s y proceso debido.", "Correccion automatica demostrada."],
    ["E. Tiempo", "Simular 30 min/3 h usando Bogota.", "next_attempt_at y transicion correctos."],
    ["F. Ruteo", "Action Cars, Millersville/White Marsh, Easterns y todos los dealers.", "Dealer y razon de ruteo correctos."],
    ["G. Regresion", "Duplicados, sent, firmas, concurrencia y frontend.", "Sin regresiones."],
    ["H. Cierre", "Repetir fallos, limpiar solo fixtures y exportar evidencia.", "Matriz final y reporte PDF."],
], [0.75 * inch, 3.8 * inch, 2.05 * inch], padding=5)]
story += [P("Plantilla del reporte PDF final", "H2x")]
story += [bullet("Resumen ejecutivo: que paso, que se corrigio y si se cumplieron todos los criterios."), bullet("Version exacta probada: commit, migraciones, imagen/servicio Docker y configuracion no secreta."), bullet("Matriz AC-01 a AC-20 con PASS/FAIL/BLOCKED, evidencia y timestamp."), bullet("Detalle de cada conversacion: payload, mensajes, snapshots, estados, dealer, ventanas y queries."), bullet("Incidentes de normalizacion: real_name, vehiculo, down, telefono, documentos, identificacion y bank account."), bullet("Resultados de Action Cars por idioma y de alternancia Millersville/White Marsh."), bullet("Resultados de ruteo Easterns por ciudad/estado y prioridad geografica."), bullet("Pruebas de 30 segundos y de ventanas simuladas, diferenciadas explicitamente."), bullet("Regresiones ejecutadas despues de cada correccion y pendientes reales, si existen."),]
story += [Spacer(1, 0.1 * inch)]
story += [Table([[P("LIMITACION IMPORTANTE", "TableHead")], [P("Este documento es el plan y la especificacion de aceptacion. El reporte final solo se debe emitir despues de ejecutar las pruebas contra Docker y recopilar evidencia. Una prueba local no demuestra por si sola que GHL/Neon en produccion se comporten igual.", "Callout")]], colWidths=[6.6 * inch], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#9A6700")), ("BACKGROUND", (0, 1), (-1, -1), WARN), ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#C58B00")), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))]

doc = QAPlanDoc(OUTPUT)
doc.build(story)
print(OUTPUT)
