from pathlib import Path
import textwrap

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(r"C:\dev\dealeradmin")
OUTPUT = ROOT / "output" / "pdf" / "plan-agente-ghl-private-integration-2026-09-22.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=25, leading=31, alignment=TA_CENTER, textColor=colors.HexColor("#073B4C"),
    spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=18, alignment=TA_CENTER, textColor=colors.HexColor("#355C6D"),
    spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=17, leading=21, textColor=colors.HexColor("#073B4C"),
    spaceBefore=8, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12.5, leading=16, textColor=colors.HexColor("#087F8C"),
    spaceBefore=8, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.3, leading=13.2, textColor=colors.HexColor("#24323A"),
    spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8, leading=10.5, textColor=colors.HexColor("#40525B"),
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Bulletx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.1, leading=12.7, leftIndent=13, firstLineIndent=-8,
    textColor=colors.HexColor("#24323A"), spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Codex", parent=styles["Code"], fontName="Courier",
    fontSize=7.7, leading=10, leftIndent=8, rightIndent=8,
    backColor=colors.HexColor("#F2F6F7"), borderColor=colors.HexColor("#D3E1E5"),
    borderWidth=0.5, borderPadding=7, spaceBefore=4, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.5, leading=13.2, textColor=colors.HexColor("#073B4C"),
    backColor=colors.HexColor("#E7F5F3"), borderColor=colors.HexColor("#0E8C8C"),
    borderWidth=0.7, borderPadding=8, spaceBefore=5, spaceAfter=9,
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def bullets(items):
    return [P("- " + item, "Bulletx") for item in items]


def code(text):
    wrapped = []
    for line in text.strip("\n").splitlines():
        parts = textwrap.wrap(
            line,
            width=96,
            break_long_words=False,
            break_on_hyphens=False,
            replace_whitespace=False,
            drop_whitespace=False,
        ) or [""]
        wrapped.extend(parts)
    return Preformatted("\n".join(wrapped), styles["Codex"])


def table(rows, widths, header=True):
    converted = []
    for row_index, row in enumerate(rows):
        converted.append([
            P(str(cell), "Smallx" if row_index or not header else "Smallx")
            for cell in row
        ])
    t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C8D7DB")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        commands += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#073B4C")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ]
        for cell in converted[0]:
            cell.style = styles["Smallx"].clone("header")
            cell.style.textColor = colors.white
            cell.style.fontName = "Helvetica-Bold"
    t.setStyle(TableStyle(commands))
    return t


def footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(colors.HexColor("#D7E3E6"))
    canvas.line(0.65 * inch, 0.46 * inch, width - 0.65 * inch, 0.46 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#58717A"))
    canvas.drawString(0.65 * inch, 0.27 * inch, "dealerADMIN - Plan de transformacion GHL / Private Integration")
    canvas.drawRightString(width - 0.65 * inch, 0.27 * inch, f"Pagina {doc.page}")
    canvas.restoreState()


story = []

# Cover
story += [Spacer(1, 0.8 * inch), P("PLAN DE TRABAJO", "CoverTitle"),
          P("Sincronizacion de conversaciones GHL mediante Private Integrations", "CoverSub"),
          Spacer(1, 0.25 * inch),
          P("Rama obligatoria: codex/ghl-full-conversation-sync", "Callout"),
          Spacer(1, 0.15 * inch),
          P("Documento para el agente de desarrollo del 22 de septiembre de 2026", "CoverSub"),
          Spacer(1, 0.45 * inch),
          table([
              ["Decision", "Alcance"],
              ["Fuente nueva", "API de conversaciones de HighLevel con Private Integration read-only."],
              ["Que permanece", "Reglas de Offlease, normalizador, georouting, cola, media worker, reportes y UI."],
              ["Que cambia", "Como llegan y se actualizan los mensajes: de workflow/webhook a sincronizacion API."],
              ["Publicacion", "No hacer merge a main ni despliegue hasta que todas las pruebas esten en 100%."],
          ], [1.35 * inch, 5.9 * inch]),
          Spacer(1, 0.35 * inch),
          P("Objetivo ejecutivo: DealerADMIN debe leer la conversacion completa de GHL, conservar inbound y outbound, normalizar solo evidencia del cliente, procesar audio/attachments y continuar aplicando exactamente las reglas de cada dealer.", "Bodyx"),
          PageBreak()]

# Executive scope
story += [P("1. Alcance y restricciones", "H1x"),
          P("El agente trabajara sobre la rama existente y no debe iniciar una reescritura general. El sistema actual ya tiene cola, normalizacion, media worker, reglas por dealer, georouting, reportes y un ciclo de reconciliacion de 30 segundos. La integracion nueva debe sustituir solo la adquisicion de mensajes.", "Bodyx"),
          P("Se debe preservar", "H2x"),
          *bullets([
              "Reglas Offlease y minimos por categoria de vehiculo.",
              "Promocion de $1,000 cuando el cliente confirma financiamiento previo.",
              "Regla de no tomar prompts outbound como respuestas del cliente.",
              "Reglas especificas de cada fuente: Fred/Fred-2 siempre Fredericksburg; Easterns usa georouting; Easterns Millersville alterna Millersville/White Marsh; los demas usan destino directo normal.",
              "Georouting, asignacion por dealer, deduplicacion y estados de la cola.",
              "Proteccion de conversaciones queued contra reconciliaciones automaticas.",
              "Transcripcion/OCR como evidencia adicional sin reemplazar el mensaje original.",
          ]),
          P("No hacer", "H2x"),
          *bullets([
              "No borrar tablas, datos o conversaciones existentes.",
              "No guardar tokens en codigo, migraciones, fixtures, logs o PDFs.",
              "No enviar mensajes a GHL desde esta primera integracion.",
              "No cambiar reglas de calificacion para compensar un fallo de ingestion.",
              "No actualizar campos editados manualmente cuando la conversacion ya esta queued.",
              "No hacer merge a main, deploy ni apagar el workflow hasta tener evidencia completa.",
          ]),
          P("Rama y estado de trabajo", "H2x"),
          code("cd C:\\dev\\dealeradmin\ngit switch codex/ghl-full-conversation-sync\n# Preservar cambios no relacionados; no usar reset --hard ni clean -fd"),
          P("El agente debe revisar primero el diff y clasificar cada cambio existente antes de modificar archivos.", "Callout"),
          PageBreak()]

# Architecture
story += [P("2. Arquitectura objetivo", "H1x"),
          P("GHL continua siendo el sistema donde el bot conversa con el cliente. DealerADMIN sera el espejo operativo local: conserva el historial, deriva evidencia, normaliza, califica y administra la cola.", "Bodyx"),
          code("GHL bot / WhatsApp / Messenger\n        |\n        |  Private Integration API, solo lectura\n        v\nGHL Conversation Sync (cada 30 segundos)\n        |\n        +--> conversation_messages (inbound + outbound)\n        +--> conversation_attachments (audio, imagen, OCR, transcripcion)\n        v\nNormalizador: solo inbound como evidencia del cliente\n        v\nReglas por dealer / Down payment / financiamiento previo / georouting\n        v\nlead_dealers -> waiting_window -> queued"),
          P("Ciclo de 30 segundos", "H2x"),
          *bullets([
              "El timer existente de ConversationWebhookService sigue siendo el scheduler inicial.",
              "Procesar un lote acotado, no todas las conversaciones sin limite.",
              "Sincronizar solamente conversaciones pre-queued: partial, waiting_window y stale_phone_ignored.",
              "No recalcular ni sobrescribir una conversacion queued.",
              "Evitar ejecuciones concurrentes y aplicar backoff ante 429/5xx.",
          ]),
          P("Paginacion y actualizacion", "H2x"),
          *bullets([
              "Primera sincronizacion: leer todas las paginas usando lastMessageId hasta nextPage=false.",
              "Ciclos siguientes: leer la primera pagina reciente y hacer upsert por ghl_message_id.",
              "No depender de que el webhook haya entregado el historial completo.",
              "Si una conversacion tiene mas de una pagina nueva, continuar hasta completar el lote seguro.",
          ]),
          P("El JSON de Selvin confirma que la API entrega direction, body, attachments, message id, locationId y conversationId. Ese formato debe convertirse en fixture de regresion. Ademas, las pruebas deben generar un fixture sintetico determinista, con semilla fija y datos distintos, usando la misma estructura JSON de la API; no se acepta probar solamente con Selvin.", "Callout"),
          P("Fuentes que deben quedar cubiertas", "H2x"),
          table([
              ["Fuente", "Location ID", "Destino y regla"],
              ["stafford", "LiaoSID3nvAhad49ZpNJ", "WhatsApp; Offlease; destino Stafford directo."],
              ["fredericksburg", "MyxWNKacThim798E8KC6", "Messenger; Offlease; siempre destino Fredericksburg."],
              ["fredericksburg-2", "bAuMEQeH48xAtu9tAMFf", "Messenger; Offlease; siempre destino Fredericksburg."],
              ["easterns", "xN2LSSl62okzv9GnOJPU", "Messenger; destino mediante Easterns georouting por ciudad/estado/zona."],
              ["arlington", "9v8zH9Y5eLiiJwZTZDci", "Messenger / Instagram; destino Arlington directo."],
              ["koons-fred", "xuHo0opTO2g5edIuPJRl", "Messenger; destino Koons Fredericksburg directo."],
              ["koons-fred-eng", "ozAIEblxTjrh0PfoaHge", "Messenger; destino Koons Fredericksburg English directo."],
              ["koons-culpeper", "bTNJHpNZ8FaS1PUHkuUq", "Messenger; destino Koons Culpeper directo."],
              ["action-cars", "ZxadcudjvBz7KFCB1od4", "Messenger; destino Action Cars directo; split por idioma."],
              ["easterns-millersville", "113zMWQlhKKBUu5wOYtR", "Messenger; alterna por round-robin entre Millersville y White Marsh."],
              ["easterns-frederick", "MRHcOwdTqaN5cug3eSWW", "Messenger; destino Easterns Frederick directo."],
          ], [1.7 * inch, 2.25 * inch, 3.3 * inch]),
          P("Matriz de routing que no se puede alterar", "H2x"),
          table([
              ["Regla", "Implementacion obligatoria"],
              ["Fredericksburg", "fredericksburg y fredericksburg-2 siempre deben terminar en Fredericksburg; nunca deben caer en otro dealer por georouting."],
              ["Easterns", "easterns usa georouting existente con ciudad, estado, ZIP/zona y reglas configuradas."],
              ["Easterns Millersville", "easterns-millersville alterna entre Millersville y White Marsh usando el estado round-robin existente."],
              ["Resto de fuentes", "stafford, arlington, koons-fred, koons-fred-eng, koons-culpeper, action-cars y easterns-frederick usan destino directo normal segun su dealer configurado."],
          ], [1.8 * inch, 5.45 * inch]),
          P("El sincronizador no puede alterar estas decisiones de routing: solo debe entregar la conversacion completa al pipeline existente antes de queued.", "Callout"),
          PageBreak()]

# Data model
story += [P("3. Base de datos: conservar y agregar", "H1x"),
          table([
              ["Objeto", "Decision", "Motivo"],
              ["dealers / locations", "Conservar", "Reglas, locationId y georouting por dealer."],
              ["leads", "Conservar", "Identidad del contacto y telefono canonico."],
              ["lead_dealers", "Conservar", "Cola, asignacion, routing_status, message_text y estado enviado."],
              ["conversations", "Conservar", "Estado de calificacion, snapshot, ventana y relacion GHL."],
              ["conversation_messages", "Conservar", "Espejo completo de mensajes inbound y outbound."],
              ["conversation_attachments", "Conservar", "Audio, imagen, URLs, OCR, transcripcion y reintentos."],
              ["webhook_events", "Conservar durante migracion", "Auditoria, deduplicacion y comparacion webhook/API."],
              ["conversation_bot_pause_events", "Conservar por ahora", "Necesaria si queued debe pausar el bot para agente."],
              ["reportes / bulk ingestion", "Conservar", "No dependen de la captura GHL."],
          ], [1.65 * inch, 1.35 * inch, 4.25 * inch]),
          P("Nueva tabla sugerida: ghl_conversation_sync_state", "H2x"),
          table([
              ["Campo", "Uso"],
              ["ghl_location_id", "Relacion con la ubicacion y token configurado."],
              ["last_success_at", "Ultimo ciclo completo exitoso."],
              ["last_seen_message_id", "Observabilidad del ultimo mensaje conocido."],
              ["status", "success, failed, rate_limited o disabled."],
              ["last_error", "Error resumido sin token ni contenido sensible."],
              ["conversations_scanned", "Cantidad del ultimo lote."],
          ], [1.7 * inch, 5.55 * inch]),
          P("No guardar el token en Neon. El secreto debe vivir en variables de entorno del API y en el proveedor de despliegue.", "Callout"),
          P("Tablas candidatas a retirar en el futuro", "H2x"),
          P("Solo despues de una migracion comprobada: el workflow que unicamente enviaba mensajes a DealerADMIN y, tras un periodo de auditoria, cualquier dependencia exclusiva de webhook_events. No eliminar conversations ni conversation_messages.", "Bodyx"),
          PageBreak()]

# Env and API contract
story += [P("4. Variables de entorno y contrato de API", "H1x"),
          P("El usuario administrara y cargara los tokens. El agente implementara el codigo, validacion, errores y documentacion. Nunca debe pedir que el token se pegue en el chat o en un commit.", "Bodyx"),
          code("GHL_API_BASE_URL=https://services.leadconnectorhq.com\nGHL_API_VERSION=2021-07-28\nGHL_PRIVATE_INTEGRATION_TOKEN_STAFFORD=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_FREDERICKSBURG=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_FREDERICKSBURG_2=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_ARLINGTON=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_KOONS_FRED=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_KOONS_FRED_ENG=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_KOONS_CULPEPER=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_ACTION_CARS=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS_MILLERSVILLE=<secret>\nGHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS_FREDERICK=<secret>\nGHL_CONVERSATION_SYNC_ENABLED=false\nGHL_CONVERSATION_SYNC_INTERVAL_MS=30000\nGHL_CONVERSATION_SYNC_BATCH_SIZE=25\nGHL_CONVERSATION_SYNC_LIMIT=100\nGHL_CONVERSATION_SYNC_TIMEOUT_MS=10000\nGHL_CONVERSATION_SYNC_MAX_PAGES=20\nGHL_CONVERSATION_SYNC_MODE=shadow"),
          P("Nombres finales pueden ajustarse al patron existente del proyecto, pero cada token debe estar asociado a una sola ubicacion o tener una estrategia OAuth documentada. Si falta el token de un dealer, ese dealer debe quedar en skipped/disabled sin romper los demas.", "Bodyx"),
          P("Peticion read-only esperada", "H2x"),
          code("GET https://services.leadconnectorhq.com/conversations/{conversationId}/messages?limit=100&type=TYPE_WHATSAPP\nAuthorization: Bearer <token>\nAccept: application/json\nVersion: 2021-07-28"),
          P("Validaciones obligatorias del cliente", "H2x"),
          *bullets([
              "Timeout con AbortController.",
              "Reintentos limitados para 429, 502, 503 y 504.",
              "No reintentar 401/403/404 sin marcar el error correctamente.",
              "Verificar que locationId, contactId y conversationId coincidan con la fila local.",
              "No registrar Authorization ni el cuerpo completo de audio en logs.",
              "Upsert idempotente por conversation_id + dedupe_key basado en ghl_message_id.",
          ]),
          PageBreak()]

# Qualification and media
story += [P("5. Reglas que deben permanecer intactas", "H1x"),
          P("La unica sustitucion es la entrada de mensajes. El resultado de negocio debe continuar igual, pero con evidencia mas completa.", "Bodyx"),
          table([
              ["Evidencia", "Regla"],
              ["Inbound", "Unica evidencia que puede llenar nombre, vehiculo, down, financiamiento y telefono conversacional."],
              ["Outbound", "Contexto/auditoria; nunca cuenta como respuesta del cliente."],
              ["E financiado", "Se interpreta como previous_financing=yes."],
              ["Portugues", "Incluir ja financiei, financiei antes y afirmaciones equivalentes."],
              ["Down menor", "Si previous_financing=yes, aplicar promocion Offlease de $1,000 cuando corresponda."],
              ["Queued", "No recalcular ni sobrescribir ediciones manuales."],
              ["No califica", "No crear relacion pending ni marcar queued solo porque un outbound menciona el minimo."],
          ], [1.55 * inch, 5.7 * inch]),
          P("Audio y attachments", "H2x"),
          *bullets([
              "Guardar el mensaje original aunque body este vacio.",
              "Guardar URL, tipo, message id y metadata de GHL.",
              "Procesar audio con el media worker existente y crear evidencia derivada inbound.",
              "No reemplazar el attachment ni borrar el audio original despues de transcribir.",
              "Si GHL ofrece transcripcion por message id, guardarla como evidencia adicional y validar duplicados.",
              "Si el audio no se puede recuperar, conservar estado not_retrievable y motivo explicito.",
          ]),
          P("Descubrimiento de conversaciones", "H2x"),
          P("Si se retira el workflow de captura, la integracion debe descubrir conversaciones nuevas por locationId en las 11 fuentes. No basta con sincronizar las conversaciones que ya existen en Neon. Implementar el mismo patron para Stafford, Fredericksburg, Fredericksburg-2, Easterns, Arlington, Koons Fred, Koons Fred English, Koons Culpeper, Action Cars, Easterns Millersville y Easterns Frederick, cada uno con su token y reglas actuales. La sincronizacion no puede modificar el routing: Fred/Fred-2 siempre van a Fredericksburg; Easterns conserva georouting; Millersville alterna Millersville/White Marsh; los demas son directos.", "Bodyx"),
          PageBreak()]

# Acceptance
story += [P("6. Criterios de aceptacion 100%", "H1x"),
          P("El trabajo no se considera terminado si alguna categoria queda en rojo, aunque el endpoint responda 200.", "Callout"),
          table([
              ["Categoria", "Aceptacion"],
              ["API", "Consulta autenticada read-only, paginacion, timeout, retries y errores observables."],
              ["Cobertura", "Cada conversacion activa de la ubicacion configurada se sincroniza en el ciclo esperado."],
              ["Integridad", "Todos los ids, direction, body, fecha, attachments y locationId coinciden con GHL."],
              ["Idempotencia", "Repetir el ciclo no duplica mensajes, leads, attachments ni relaciones."],
              ["Normalizacion", "Solo inbound cambia el snapshot; outbound no inventa down, nombre o telefono."],
              ["Offlease", "Minimos, promocion de financiado, trade-in y categorias no cambian."],
              ["Audio", "Audio detectado, persistido, procesado, transcrito y usado en calificacion."],
              ["Cola", "Completo pasa por stabilization y luego queued; incompleto nunca pasa."],
              ["Queued", "Una edicion manual no vuelve al valor anterior en ciclos posteriores."],
              ["Seguridad", "Tokens fuera de codigo, logs y fixtures; se validan ubicacion y scopes."],
              ["UI", "Landing page describe la sincronizacion API sin afirmar una capacidad no probada."],
          ], [1.35 * inch, 5.9 * inch]),
          P("Casos obligatorios", "H2x"),
          *bullets([
              "Selvin Javier Banegas: Honda Civic, $1,000, E financiado, debe calificar y llegar a queued automaticamente.",
              "El Aguila Blanca/Heriberto: prompt outbound de $3,000 sin down inbound, no debe entrar.",
              "Leandro Bolzan: SUV, $1,000-$2,000, audio y confirmacion de financiamiento previo, debe normalizarse correctamente.",
              "Mensaje outbound con $1,500/$2,000/$3,000 y cliente sin monto: el monto del bot no cuenta.",
              "Attachment-only audio con body vacio y transcripcion posterior.",
              "Conversacion con mas de una pagina y repeticion del mismo ciclo.",
              "Conversacion queued con cambio manual de nombre/down: no se sobrescribe.",
              "Fixture API de Selvin: conservar el JSON representativo sin token y validar mensajes, paginacion y attachments.",
              "Fixture API sintetico aleatorio reproducible: generar con semilla fija otro locationId/conversationId/contactId, timestamps, mensajes inbound/outbound, nextPage y audio; debe recorrer el mismo pipeline y producir el resultado esperado.",
              "Routing Fred y Fred-2: ambos deben terminar en Fredericksburg, sin desviarse por georouting.",
              "Routing Easterns: un caso de zona/ciudad debe conservar el destino calculado por georouting.",
              "Routing Easterns Millersville: dos conversaciones consecutivas deben alternar entre Millersville y White Marsh usando el estado round-robin existente.",
              "Routing directo: Stafford, Arlington, Koons, Action Cars y Easterns Frederick deben conservar su dealer configurado.",
          ]),
          PageBreak()]

# Test matrix and rollout
story += [P("7. Matriz de pruebas obligatoria", "H1x"),
          table([
              ["Nivel", "Comando/evidencia", "Resultado minimo"],
              ["Unitarias", "Vitest para cliente GHL, parser, paginacion, upsert, reglas y media con fixture Selvin y fixture API sintetico reproducible.", "100% pass, cero tests skipped."],
              ["Integracion BD", "PostgreSQL local real con migraciones y ambos fixtures JSON: Selvin y caso sintetico con ids/fechas/attachments nuevos.", "Snapshots, mensajes, attachments y estados correctos."],
              ["E2E", "Playwright contra API/web local y mock de GHL que entregue ambos JSON, incluyendo paginacion y audio.", "Flujo completo hasta cola y landing actualizada."],
              ["Docker", "API + web + PostgreSQL + media worker + mock GHL con respuestas JSON realistas de ambos casos.", "Arranque limpio, health checks y suite completa."],
              ["Audio", "Fixtures de audio reales o controladas, body vacio y callback transcrito.", "Transcripcion persistida y usada sin perder original."],
              ["Smoke read-only", "Token real de Stafford, conversacion conocida, sin POST a GHL.", "Respuesta y datos coinciden con GHL."],
              ["Regresion", "Suite existente completa del repositorio.", "Sin fallos nuevos ni cambios fuera de alcance."],
          ], [1.1 * inch, 3.7 * inch, 2.45 * inch]),
          P("Secuencia de rollout", "H2x"),
          *bullets([
              "Fase 1: implementar cliente y fixture con GHL_CONVERSATION_SYNC_MODE=shadow.",
              "Fase 2: activar Stafford local y confirmar paridad con GHL.",
              "Fase 3: activar procesamiento automatico de pre-queued en local/Docker.",
              "Fase 4: smoke read-only contra token real y comparar evidencia.",
              "Fase 5: activar los demas tokens en env por dealer.",
              "Fase 6: publicar la rama y esperar aprobacion antes de retirar el workflow.",
          ]),
          PageBreak()]

# Mega prompt
story += [P("8. Mega prompt para el agente de manana", "H1x"),
          P("Copiar el bloque completo al agente. Debe ejecutar el trabajo, no limitarse a describirlo.", "Bodyx"),
          code("Eres el agente responsable de transformar dealerADMIN para que sincronice conversaciones completas de HighLevel mediante Private Integrations, trabajando exclusivamente en la rama codex/ghl-full-conversation-sync dentro de C:\\dev\\dealeradmin.\n\nOBJETIVO\nReemplazar solamente la forma de adquisicion de mensajes: GHL continuara manejando la conversacion y el bot continuara respondiendo. DealerADMIN debe leer conversaciones completas, guardar inbound y outbound, procesar attachments/audio, normalizar solo inbound y mantener intactas todas las reglas existentes de Offlease, Easterns, Stafford, Fredericksburg, Arlington, Koons, Action Cars y las demas fuentes configuradas.\n\nREGLAS DE SEGURIDAD\n- No uses git reset --hard, git clean, checkout destructivo ni borres cambios no relacionados.\n- No pongas tokens en codigo, tests, fixtures, logs, PDFs o commits.\n- No envies mensajes ni hagas mutaciones en GHL. La primera integracion es read-only.\n- No alteres una conversacion queued mediante reconciliacion automatica.\n- No hagas merge a main ni deploy hasta tener pruebas 100% verdes y evidencia escrita.\n\nIMPLEMENTACION\n1. Inspecciona el estado actual, migraciones, scheduler de 30 segundos, normalizador, media worker, cola y landing page.\n2. Implementa un cliente GHL read-only con timeout, retries para 429/5xx, manejo explicito de 401/403/404 y validacion locationId/contactId/conversationId.\n3. Implementa sincronizacion paginada: primera carga hasta nextPage=false; ciclos posteriores con mensajes recientes y upsert idempotente por ghl_message_id.\n4. Guarda direction inbound/outbound, body, fecha, raw_payload, attachments y metadata.\n5. Agrega estado observable de sync por location/conversation sin guardar tokens en BD.\n6. Integra el sync al ciclo existente de 30 segundos para las 11 fuentes configuradas, con batch acotado, lock contra solapamiento y exclusion de queued.\n7. Normaliza exclusivamente inbound. Un prompt outbound nunca puede crear nombre, down, financiamiento, telefono ni calificacion.\n8. Mantiene E financiado, ya financie, ja financiei y equivalentes. Aplica la promocion Offlease de $1,000 solo con evidencia inbound de financiamiento previo.\n9. Mantiene audio e imagen como evidencia aditiva. Body vacio con audio debe persistir y pasar por media worker/transcripcion.\n10. Actualiza la landing page para describir la sincronizacion API unicamente con capacidades probadas.\n\nDEALERS Y TOKENS\nCubre estas fuentes y sus reglas sin inventar otras: stafford, fredericksburg, fredericksburg-2, easterns, arlington, koons-fred, koons-fred-eng, koons-culpeper, action-cars, easterns-millersville y easterns-frederick. Usa un token por location en variables de entorno; el usuario cargara los secretos.\n\nENV VARS\nDocumenta y usa GHL_API_BASE_URL, GHL_API_VERSION, GHL_PRIVATE_INTEGRATION_TOKEN_STAFFORD, GHL_PRIVATE_INTEGRATION_TOKEN_FREDERICKSBURG, GHL_PRIVATE_INTEGRATION_TOKEN_FREDERICKSBURG_2, GHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS, GHL_PRIVATE_INTEGRATION_TOKEN_ARLINGTON, GHL_PRIVATE_INTEGRATION_TOKEN_KOONS_FRED, GHL_PRIVATE_INTEGRATION_TOKEN_KOONS_FRED_ENG, GHL_PRIVATE_INTEGRATION_TOKEN_KOONS_CULPEPER, GHL_PRIVATE_INTEGRATION_TOKEN_ACTION_CARS, GHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS_MILLERSVILLE, GHL_PRIVATE_INTEGRATION_TOKEN_EASTERNS_FREDERICK, GHL_CONVERSATION_SYNC_ENABLED, GHL_CONVERSATION_SYNC_INTERVAL_MS, GHL_CONVERSATION_SYNC_BATCH_SIZE, GHL_CONVERSATION_SYNC_LIMIT, GHL_CONVERSATION_SYNC_TIMEOUT_MS, GHL_CONVERSATION_SYNC_MAX_PAGES y GHL_CONVERSATION_SYNC_MODE.\n\nCASOS OBLIGATORIOS\n- Selvin Javier Banegas: Honda Civic, 1000, E financiado, debe calificar y llegar a queued.\n- El Aguila Blanca/Heriberto: outbound menciona 3000 pero cliente no da down, no debe calificar.\n- Leandro Bolzan: SUV, 1000-2000, mensajes de audio y financiamiento previo deben persistir, transcribirse y calificarse cuando corresponda.\n- Mensajes outbound de GHL deben permanecer en auditoria, nunca en evidencia del cliente.\n\nPRUEBAS\nEjecuta y documenta unitarias, integracion BD PostgreSQL local, E2E Playwright, Docker completo, media/audio y smoke read-only con Stafford y al menos un caso de cada dealer. Todas deben pasar al 100%; no aceptes skipped, flaky, warnings que oculten fallos ni fixtures que no representen el JSON real. Usa el JSON de Selvin como fixture sin token.\n\nENTREGA\nReporta archivos modificados, migraciones, variables requeridas, comandos exactos, resultados de cada suite, evidencia de Docker, evidencia de audio, evidencia de no mutacion queued, git diff --check y estado de la rama. Si algo falla, corrige y repite hasta que todo este verde. No publiques a main.") ,
          P("Fixtures JSON obligatorios para el mega prompt", "H2x"),
          *bullets([
              "Conservar el JSON de Selvin como fixture de regresion, sin tokens ni secretos.",
              "Crear un caso sintetico aleatorio pero reproducible usando una semilla fija y la estructura real de la API: lastMessageId, nextPage, me, messages, direction, body, attachments, message id, locationId y conversationId.",
              "El caso sintetico debe usar ids, timestamps, dealer/location y contenido distintos, incluir inbound/outbound, paginacion y un audio; debe probar ingestion, deduplicacion, transcripcion, normalizacion y routing.",
              "Ejecutar ambos fixtures en unitarias, PostgreSQL local, E2E y Docker; documentar que ninguno depende de un token real.",
          ]),
          P("Routing obligatorio para el mega prompt", "H2x"),
          *bullets([
              "Fredericksburg y Fredericksburg-2 siempre llegan a Fredericksburg.",
              "Easterns usa el georouting existente.",
              "Easterns Millersville alterna entre Millersville y White Marsh.",
              "Stafford, Arlington, Koons, Action Cars y Easterns Frederick usan routing directo normal.",
          ]),
          P("Definicion de terminado para el agente", "H2x"),
          *bullets([
              "Codigo implementado y documentado.",
              "Pruebas 100% verdes en unitarias, BD local, E2E y Docker.",
              "Smoke read-only de Stafford exitoso cuando el token este cargado.",
              "Landing page actualizada y validada visualmente.",
              "Sin secretos en git y sin cambios destructivos.",
              "Rama lista para revision, sin merge automatico a main.",
          ]),
          P("Referencias tecnicas", "H2x"),
          P("Endpoint documentado por HighLevel: https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages/index.html. La integracion usa Bearer token de Private Integration, Version 2021-07-28 y permisos de lectura. La decision final sobre retirar workflows requiere paridad observada y aprobacion humana.", "Smallx"),
]

doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=letter,
    rightMargin=0.65 * inch, leftMargin=0.65 * inch,
    topMargin=0.6 * inch, bottomMargin=0.65 * inch,
    title="Plan de trabajo GHL Private Integration",
    author="Codex - dealerADMIN",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
