from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Table,
    TableStyle,
    KeepTogether,
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from xml.sax.saxutils import escape
from pathlib import Path


OUT = Path('C:/dev/dealeradmin/output/pdf/plan-media-ghl-dealeradmin-sin-ia-pagada-2026-09-13.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)


def font_setup():
    candidates = [
        Path('C:/Windows/Fonts/arial.ttf'),
        Path('C:/Windows/Fonts/segoeui.ttf'),
    ]
    for path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont('AppSans', str(path)))
            bold = path.with_name(path.stem + 'bd' + path.suffix)
            if bold.exists():
                pdfmetrics.registerFont(TTFont('AppSans-Bold', str(bold)))
                return 'AppSans', 'AppSans-Bold'
            return 'AppSans', 'AppSans'
    return 'Helvetica', 'Helvetica-Bold'


REG, BOLD = font_setup()
PAGE_W, PAGE_H = A4
INK = colors.HexColor('#17212B')
MUTED = colors.HexColor('#5B6875')
BLUE = colors.HexColor('#155EEF')
PALE_BLUE = colors.HexColor('#EAF1FF')
GREEN = colors.HexColor('#087443')
PALE_GREEN = colors.HexColor('#EAF8F0')
AMBER = colors.HexColor('#9A5B00')
PALE_AMBER = colors.HexColor('#FFF4DD')
LINE = colors.HexColor('#D8E0E8')
PANEL = colors.HexColor('#F6F8FA')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name='CoverKicker', parent=styles['Normal'], fontName=BOLD, fontSize=9,
    leading=12, textColor=BLUE, tracking=1.2, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name='CoverTitle', parent=styles['Title'], fontName=BOLD, fontSize=27,
    leading=32, textColor=INK, alignment=TA_LEFT, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name='CoverSub', parent=styles['Normal'], fontName=REG, fontSize=12,
    leading=18, textColor=MUTED, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name='H1x', parent=styles['Heading1'], fontName=BOLD, fontSize=19,
    leading=23, textColor=INK, spaceBefore=5, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name='H2x', parent=styles['Heading2'], fontName=BOLD, fontSize=12,
    leading=16, textColor=BLUE, spaceBefore=10, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name='Bodyx', parent=styles['BodyText'], fontName=REG, fontSize=9.4,
    leading=14, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name='Smallx', parent=styles['BodyText'], fontName=REG, fontSize=8,
    leading=11, textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name='Callout', parent=styles['BodyText'], fontName=REG, fontSize=9.5,
    leading=14, textColor=INK, leftIndent=10, rightIndent=10,
    spaceBefore=4, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name='TableHead', parent=styles['BodyText'], fontName=BOLD, fontSize=8.2,
    leading=10, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name='TableCell', parent=styles['BodyText'], fontName=REG, fontSize=8,
    leading=11, textColor=INK,
))
styles.add(ParagraphStyle(
    name='TableCellBold', parent=styles['BodyText'], fontName=BOLD, fontSize=8,
    leading=11, textColor=INK,
))
styles.add(ParagraphStyle(
    name='Codex', parent=styles['Code'], fontName='Courier', fontSize=7.4,
    leading=10, textColor=INK, backColor=PANEL, borderColor=LINE,
    borderWidth=0.5, borderPadding=7, spaceBefore=4, spaceAfter=7,
))


def P(text, style='Bodyx'):
    return Paragraph(text, styles[style])


def bullet(text):
    return P('&bull;&nbsp;&nbsp;' + text, 'Bodyx')


def box(text, color=PALE_BLUE, border=BLUE):
    t = Table([[P(text, 'Callout')]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), color),
        ('BOX', (0, 0), (-1, -1), 0.8, border),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


def table(data, widths, header=True):
    converted = []
    for r, row in enumerate(data):
        converted.append([
            Paragraph(escape(str(cell)), styles['TableHead' if header and r == 0 else 'TableCell'])
            for cell in row
        ])
    t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    commands = [
        ('GRID', (0, 0), (-1, -1), 0.4, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    if header:
        commands += [('BACKGROUND', (0, 0), (-1, 0), BLUE)]
        for row_index in range(1, len(data)):
            if row_index % 2 == 0:
                commands.append(('BACKGROUND', (0, row_index), (-1, row_index), PANEL))
    t.setStyle(TableStyle(commands))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, PAGE_W - 18 * mm, 14 * mm)
    canvas.setFont(REG, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9 * mm, 'DealerADMIN | Plan de procesamiento local de media')
    canvas.drawRightString(PAGE_W - 18 * mm, 9 * mm, f'{doc.page}')
    canvas.restoreState()


story = []

# Cover
story.append(Spacer(1, 22 * mm))
story.append(P('PLAN TECNICO PARA MAÑANA', 'CoverKicker'))
story.append(P('Audio e imágenes desde GHL hacia DealerADMIN', 'CoverTitle'))
story.append(P(
    'Cómo conservar el flujo actual, evitar Custom Code de GHL y procesar la evidencia localmente sin pagar una API de IA por cada conversación.',
    'CoverSub'))
story.append(box(
    '<b>Recomendación ejecutiva:</b> GHL debe enviar solamente el evento y los identificadores de la conversación. DealerADMIN recupera los mensajes y adjuntos con la API de Conversations, los procesa en un worker Docker local y agrega el resultado como texto de evidencia. La normalización y la decisión de cola permanecen en el backend.',
    PALE_GREEN, GREEN))
story.append(Spacer(1, 13 * mm))
story.append(table([
    ['Decisión', 'Recomendación'],
    ['Entrada desde GHL', 'Webhook nativo existente, sin Custom Code. Enviar contactId, conversationId, messageId, locationId, canal y cuerpo si viene disponible.'],
    ['Audio', 'faster-whisper local, preferiblemente CPU INT8 al principio; un worker separado del request HTTP.'],
    ['Imagen', 'PaddleOCR local para texto visible; Tesseract como fallback simple.'],
    ['Normalización', 'DealerADMIN combina texto original, transcripción OCR/ASR y qualification_memory con merge monotónico.'],
    ['Producción', 'No ejecutar ML pesado dentro de Vercel ni dentro del request de 30 segundos; usar un worker Docker persistente.'],
], [38 * mm, 132 * mm]))
story.append(Spacer(1, 8 * mm))
story.append(P('Preparado: 13 de septiembre de 2026 | Alcance: WhatsApp y Messenger | Estado: propuesta para ejecutar en local primero', 'Smallx'))
story.append(PageBreak())

# Findings
story.append(P('1. Lo que se puede y no se puede hacer', 'H1x'))
story.append(P('La mejor frontera es separar transporte, procesamiento y calificación. GHL no debe convertirse en el lugar donde se transcribe ni donde se arma el JSON final.'))
story.append(table([
    ['Opción', 'Qué resuelve', 'Coste / riesgo', 'Veredicto'],
    ['Webhook nativo de GHL + backend recupera media', 'Entrega el evento y permite que DealerADMIN busque la conversación y sus adjuntos.', 'Sin coste de IA. Requiere credenciales de backend y manejar URLs/expiración.', 'Recomendada'],
    ['API de Conversations desde DealerADMIN', 'Get messages devuelve body, direction, messageId y attachments; hay endpoints separados para recording/transcription.', 'Sin coste de modelo. Depende de scopes y de la disponibilidad del recurso.', 'Recomendada'],
    ['Conversation AI Audio Response de GHL', 'GHL transcribe audio para que su bot responda.', 'La propia documentación indica cobro bajo Conversations AI; no es una fuente garantizada de transcript persistido para DealerADMIN.', 'No para este objetivo'],
    ['Custom Code en workflow GHL', 'Podría transformar o reenviar datos.', 'Ya produjo inestabilidad en el flujo; además no puede enviar archivos con el webhook de workflow.', 'Evitar'],
    ['Zapier / Make / otro SaaS', 'Puede actuar como puente entre GHL y un worker.', 'Más puntos de fallo, coste al crecer y exposición de PII.', 'Solo contingencia'],
], [32 * mm, 53 * mm, 48 * mm, 37 * mm]))
story.append(Spacer(1, 7 * mm))
story.append(box(
    '<b>Conclusión:</b> sí se puede llevar el resultado a DealerADMIN sin API de IA pagada. La transcripción debe vivir como una nueva pieza de evidencia en la conversación, no como un reemplazo del mensaje original ni como una escritura directa de campos sin trazabilidad.',
    PALE_BLUE, BLUE))

story.append(P('2. Evidencia actual de HighLevel', 'H1x'))
story.append(P('La documentación oficial de HighLevel describe tres capacidades relevantes:'))
story.append(bullet('El webhook de InboundMessage incluye attachments, body, contactId, conversationId, messageId, dirección y canal.'))
story.append(bullet('Get messages by conversation id devuelve los mensajes y sus attachments; es la vía para reconstruir el JSON completo desde DealerADMIN.'))
story.append(bullet('Existen endpoints de recording y transcription por messageId, pero deben probarse con un audio real de WhatsApp antes de asumir que aplican igual a notas de voz entrantes.'))
story.append(bullet('El Workflow Action Webhook no envía físicamente imágenes o archivos; por eso el backend debe recuperar el recurso usando el ID/URL y procesarlo.'))
story.append(P('No conviene confundir la transcripción que WhatsApp puede mostrar al destinatario con una transcripción almacenada por HighLevel. La guía de Native WhatsApp Voice Notes dice que la transcripción del lado del destinatario no es generada ni guardada por HighLevel.', 'Smallx'))
story.append(Spacer(1, 4 * mm))
story.append(box(
    '<b>Hallazgo en el workflow en vivo revisado:</b> la acción Webhook actual solo tiene cuatro datos personalizados: message_body={{message.body}}, contact_phone={{contact.phone}}, contact_name={{contact.name}} y channel=messenger. No aparecen conversationId, messageId ni attachments. Por tanto, que el log diga Success o que el endpoint devuelva HTTP 201 solo demuestra que el request fue aceptado; no demuestra que el audio haya sido transportado. Si el audio no tiene body de texto, DealerADMIN recibe un evento prácticamente vacío.',
    PALE_AMBER, AMBER))
story.append(P('Configuración mínima que debes dejar en GHL', 'H2x'))
story.append(P('No elimines ni cambies los dos pasos de teléfono. El workflow debe quedar así:', 'Bodyx'))
story.append(P('Customer Replied -> #1 Normalize Messenger Phone -> Write normalized phone to contact.phone -> Webhook', 'Codex'))
story.append(table([
    ['Sección Webhook', 'Valor'],
    ['message_body', '{{message.body}}'],
    ['contact_phone', '{{contact.phone}}'],
    ['contact_name', '{{contact.name}}'],
    ['channel', 'messenger (mantener el valor actual por dealer)'],
    ['message_attachments', '{{message.attachments}} (agregar este único dato)'],
    ['Headers', 'Mantener X-DealerADMIN-Webhook-Secret y Content-Type application/json'],
], [58 * mm, 112 * mm]))
story.append(box(
    '<b>No agregues Custom Code para audio o imágenes.</b> El Custom Code existente se conserva solo para el teléfono. La nueva fila message_attachments permite que DealerADMIN reciba la referencia al archivo; el backend será quien lo descargue, transcriba/OCR y normalice. Antes de guardar/publicar, probar un mensaje de texto y uno con audio/imagen.',
    PALE_GREEN, GREEN))

story.append(PageBreak())

# Architecture
story.append(P('3. Arquitectura propuesta', 'H1x'))
story.append(P('La arquitectura conserva el webhook ligero y mueve el trabajo pesado a una cola local.'))
story.append(table([
    ['Paso', 'Responsable', 'Resultado'],
    ['1. Customer Replied / evento inbound', 'GHL', 'Evento JSON con locationId, contactId, conversationId, messageId, canal y body/attachments si están presentes.'],
    ['2. Captura idempotente', 'DealerADMIN API', 'Guarda el evento y crea un trabajo media_pending; responde rápido 200.'],
    ['3. Recuperación', 'DealerADMIN API o worker', 'GET de mensajes de la conversación y descarga segura del audio/imagen.'],
    ['4. Procesamiento local', 'Worker Docker', 'ASR con faster-whisper u OCR con PaddleOCR/Tesseract.'],
    ['5. Evidencia', 'DealerADMIN', 'Inserta un mensaje derivado con source=audio_transcription u image_ocr, modelo, timestamps, hash y estado.'],
    ['6. Normalización', 'Collector backend', 'Relee texto original + evidencia derivada + memoria anterior; solo agrega o mejora.'],
    ['7. Estado', 'DealerADMIN', 'Queued solo si se cumplen los hechos exigidos; de lo contrario partial/waiting_window con missing_qualification real.'],
], [28 * mm, 43 * mm, 99 * mm]))
story.append(Spacer(1, 7 * mm))
story.append(P('Flujo recomendado', 'H2x'))
story.append(P('GHL -> webhook ligero -> conversations API -> media worker Docker -> conversation_messages -> collector-normalizer -> status/queue', 'Codex'))
story.append(P('Regla de oro: la transcripción es evidencia adicional. Nunca se debe borrar el attachment, el body original ni el qualification_memory existente.', 'Bodyx'))

story.append(P('4. Opción de audio sin coste por uso', 'H1x'))
story.append(P('<b>faster-whisper</b> es la opción más compatible con lo que ya se ha usado localmente: funciona en Python, admite CPU INT8, detecta idiomas y puede procesar español e inglés. El modelo se descarga una vez y luego la inferencia es local.'))
story.append(table([
    ['Perfil', 'Modelo inicial', 'Uso'],
    ['CPU normal', 'small o base multilingüe en INT8', 'Piloto de pocas conversaciones, menor consumo, más latencia.'],
    ['CPU rápida / GPU', 'small o medium; evaluar large-v3-turbo si el hardware lo permite', 'Mejor precisión y más throughput.'],
    ['Audio corto de WhatsApp', 'small multilingüe con language auto o es/en', 'Buen punto de partida; medir antes de cambiar de modelo.'],
], [35 * mm, 55 * mm, 80 * mm]))
story.append(P('El worker debe aceptar OGG/Opus, AAC, M4A, MP3 y WAV, limitar duración/tamaño, eliminar el archivo temporal al terminar y registrar el hash para que un mismo adjunto no se transcriba dos veces. La salida mínima debe incluir texto, idioma, segmentos/timestamps, modelo, duración, confidence disponible y error si falló.', 'Bodyx'))
story.append(box('<b>Importante:</b> una transcripción local puede equivocarse en nombres, modelos de vehículos y números. Para calificación, el extractor debe tratar el texto como evidencia con confianza; no debe convertir automáticamente una lectura dudosa en identificación, comprobante de ingresos o teléfono válido.', PALE_AMBER, AMBER))

story.append(PageBreak())

# Image and implementation
story.append(P('5. Opción de imagen sin coste por uso', 'H1x'))
story.append(P('<b>PaddleOCR</b> es la primera opción para OCR local porque ofrece modelos multilingües y ejecución CPU. <b>Tesseract</b> es un fallback más simple, abierto y fácil de instalar, especialmente para texto impreso limpio.'))
story.append(table([
    ['Tipo de imagen', 'Procesamiento', 'Resultado esperado'],
    ['Documento con texto impreso', 'PaddleOCR; si falla, Tesseract con eng/spa', 'Texto con cajas y confidence.'],
    ['Captura de pantalla de datos', 'PaddleOCR con resize/contraste', 'Texto bruto para el collector.'],
    ['Foto de vehículo sin texto', 'No prometer OCR', 'Mantener como attachment; pedir caption/texto o evaluar CV local después.'],
    ['ID o comprobante', 'OCR + clasificación de tipo de documento', 'Marcar evidencia candidata, no afirmar validación legal automática.'],
], [42 * mm, 58 * mm, 70 * mm]))
story.append(P('Para una primera versión, el OCR debe extraer texto y no tomar decisiones legales. Los campos pueden mejorar si el parser encuentra patrones claros, pero la regla de queue debe seguir exigiendo evidencia suficiente y conservar los valores anteriores.', 'Bodyx'))

story.append(P('6. Cambios mínimos sugeridos en DealerADMIN', 'H1x'))
story.append(P('No hace falta reescribir el collector. Los puntos de integración naturales del repositorio actual son:'))
story.append(bullet('Extender el contrato de captura para aceptar messageId, attachments y media metadata sin depender de Custom Code.'))
story.append(bullet('Añadir una tabla media_processing o equivalente con message_id, attachment_hash, media_type, status, extracted_text, model, confidence, error y processed_at.'))
story.append(bullet('Crear un worker Docker separado. El API recibe y encola; el worker procesa.'))
story.append(bullet('Persistir cada resultado como conversation_messages derivado, con source y raw_payload, sin modificar el mensaje original.'))
story.append(bullet('Reusar normalizeCollectorInput y el merge monotónico que ya se corrigió para que una segunda pasada nunca empeore la memoria.'))
story.append(bullet('Agregar métricas: media_pending, media_done, media_failed, duración, bytes, idioma, OCR/ASR confidence y número de promociones a queued.'))
story.append(P('Ubicación actual relevante: apps/api/src/features/webhooks/application/conversation-webhook.service.ts, apps/api/src/features/webhooks/application/ghl-outbound-payload.ts y apps/api/src/features/leads/domain/collector-normalizer.ts.', 'Smallx'))

story.append(P('6.1. Tabla de attachments (sin storage de archivos)', 'H2x'))
story.append(P(
    'Sí conviene crear una tabla propia, pero únicamente para registrar la URL recibida y la metadata. No se contratará ni habilitará Neon Object Storage, S3, MinIO persistente ni otro storage de archivos. conversation_messages ya conserva raw_payload, pero esta tabla permite consultar, reintentar, deduplicar y auditar cada audio o imagen.',
    'Bodyx'))
story.append(table([
    ['Campo', 'Tipo / ejemplo', 'Propósito'],
    ['id', 'UUID PK', 'Identificador interno del attachment.'],
    ['conversation_id', 'UUID FK conversations', 'Relaciona el archivo con la conversación de DealerADMIN.'],
    ['conversation_message_id', 'UUID FK conversation_messages', 'Relaciona el archivo con el mensaje original.'],
    ['ghl_location_id / ghl_conversation_id', 'VARCHAR', 'Identidad del subaccount y conversación en GHL.'],
    ['ghl_message_id', 'VARCHAR', 'ID del mensaje que contiene el attachment.'],
    ['source_url', 'TEXT', 'URL recibida desde GHL; se registra tal como llega y puede expirar.'],
    ['source_url_expires_at', 'TIMESTAMPTZ nullable', 'Caducidad conocida de la URL, si GHL la proporciona.'],
    ['content_type / media_kind', 'audio/ogg / audio / image', 'Tipo MIME y clasificación para seleccionar ASR u OCR.'],
    ['original_filename / byte_size', 'TEXT / BIGINT', 'Metadata del archivo original y límites operativos.'],
    ['sha256', 'VARCHAR UNIQUE por mensaje', 'Idempotencia y deduplicación de descargas/procesamiento.'],
    ['processing_status', 'pending / processing / done / failed', 'Estado de la cola del worker y reintentos.'],
    ['extracted_text', 'TEXT nullable', 'Transcripción de audio u OCR de imagen, como evidencia derivada.'],
    ['processing_metadata', 'JSONB', 'Idioma, modelo, confidence, segmentos, cajas, duración y errores.'],
    ['created_at / updated_at', 'TIMESTAMPTZ', 'Auditoría temporal del registro.'],
], [43 * mm, 49 * mm, 78 * mm]))
story.append(P('Relaciones y restricciones recomendadas', 'H2x'))
story.append(bullet('conversation_attachments.conversation_id referencia conversations(id) con ON DELETE CASCADE.'))
story.append(bullet('conversation_message_id referencia conversation_messages(id) y conserva el mensaje original sin modificarlo.'))
story.append(bullet('Indice por conversation_id, processing_status y expires_at para el worker y la reconciliación.'))
story.append(bullet('Restricción única por ghl_message_id + sha256 para que los reintentos de GHL no dupliquen el attachment.'))
story.append(bullet('No guardar tokens ni credenciales; la URL se conserva solo como evidencia de entrada y puede dejar de funcionar cuando expire.'))
story.append(box(
    '<b>Decisión de costo:</b> Neon se usará solo como base de datos para esta tabla. No se guardarán binarios ni copias persistentes de audio/imágenes. En Docker, las pruebas pueden usar fixtures temporales en disco que se eliminan al terminar; eso no es storage de producción. Si una URL de GHL expira, el sistema debe marcar el attachment como no_retrievable y conservar el motivo, sin intentar subirlo a otro servicio.',
    PALE_BLUE, BLUE))
story.append(P('Flujo local obligatorio: JSON real anonimizado -> inserción de URL y metadata en conversation_attachments -> descarga temporal a disco para la prueba -> worker faster-whisper/PaddleOCR -> eliminación del fixture -> actualización de processing_status y extracted_text -> collector monotónico -> pruebas de status. Solo después de aprobar estas pruebas se evalúa crear la misma tabla en Neon/producción; no se evalúa contratar storage.', 'Bodyx'))

story.append(PageBreak())
story.append(P('7. Contrato JSON recomendado', 'H1x'))
json_text = '''{
  "event_type": "ghl.customer_replied",
  "ghl_location_id": "...",
  "ghl_contact_id": "...",
  "ghl_conversation_id": "...",
  "ghl_message_id": "...",
  "channel": "whatsapp",
  "message_body": "...",
  "attachments": [{"url": "...", "content_type": "audio/ogg", "kind": "audio"}]
}'''
story.append(P(escape(json_text).replace('\n', '<br/>'), 'Codex'))
story.append(P('Si el webhook de workflow no entrega attachments, el mismo contrato puede llegar con message_body vacío y los IDs presentes. DealerADMIN debe consultar GET /conversations/{conversationId}/messages y completar la captura antes de procesar.', 'Bodyx'))

story.append(PageBreak())

# Tomorrow checklist and risks
story.append(P('8. Plan operativo para mañana', 'H1x'))
story.append(table([
    ['Orden', 'Acción', 'Criterio de salida'],
    ['1', 'Capturar en GHL un JSON real de una conversación con audio y otro con imagen. No modificar workflow todavía.', 'Tenemos IDs, canal, direction, messageId y attachments o confirmamos qué falta.'],
    ['2', 'Consultar desde local la conversación y sus mensajes con las credenciales inyectadas por el usuario.', 'El backend reconstruye un JSON completo sin imprimir tokens.'],
    ['3', 'Reproducir en Docker con un audio y una imagen copiados a un fixture local.', 'El worker produce texto y metadata, con retry e idempotencia.'],
    ['4', 'Pasar el texto derivado por el collector.', 'Se conservan los campos anteriores y solo aparecen mejoras justificadas.'],
    ['5', 'Probar 3 casos: solo audio, solo imagen, audio + texto.', 'No hay duplicados ni regresión a partial por pérdida de memoria.'],
    ['6', 'Ejecutar shadow mode en un dealer antes de activar cola automática.', 'Se comparan resultados y se revisan errores humanos.'],
    ['7', 'Activar producción gradualmente.', 'Solo se promueve a queued cuando el criterio existente se cumple; si no, queda waiting_window/partial.'],
], [15 * mm, 92 * mm, 63 * mm]))

story.append(P('9. Pruebas de aceptación', 'H1x'))
for item in [
    'Un mensaje de texto sigue exactamente igual que hoy.',
    'Un audio genera una sola evidencia derivada, incluso si GHL reintenta el webhook.',
    'Una imagen genera OCR una sola vez por attachment_hash.',
    'Un audio tardío mejora purchase_timeline o vehicle_type si el texto lo contiene, pero nunca borra identificación, documentos, banco, nombre o teléfono ya válidos.',
    'Si la transcripción falla o llega vacía, la conversación conserva el attachment y queda en el estado que corresponde, sin inventar campos.',
    'Stafford WhatsApp conserva la regla de teléfono nativo; Messenger conserva la regla de teléfono explícito reciente inbound.',
    'No se envían mensajes automáticos al cliente durante el piloto.',
    'Se puede auditar qué texto vino de customer, audio_transcription o image_ocr y qué modelo lo produjo.',
]:
    story.append(bullet(item))

risk_table = table([
    ['Riesgo', 'Mitigación'],
    ['La URL de media expira o requiere autorización.', 'Descargar inmediatamente; guardar solo hash y metadata; aplicar retry corto y registrar fallo.'],
    ['Vercel corta el proceso pesado.', 'Mantener API rápida y correr ASR/OCR en worker Docker persistente, fuera del request de 30 segundos.'],
    ['CPU lenta o muchos audios.', 'Cola con concurrencia 1 al principio, límites de duración y prioridad para leads activos.'],
    ['OCR/ASR inventa o confunde datos.', 'Guardar texto bruto, confidence y fuente; no usar evidencia dudosa para marcar requisitos críticos como cumplidos.'],
    ['PII en archivos temporales.', 'Volumen local protegido, TTL corto, no subir a SaaS, no imprimir URLs/tokens en logs.'],
], [60 * mm, 110 * mm])
story.append(KeepTogether([P('10. Riesgos y mitigaciones', 'H1x'), risk_table]))

story.append(PageBreak())

# Final decision and references
story.append(P('11. Decisión recomendada', 'H1x'))
story.append(box(
    '<b>Ruta a ejecutar:</b> mantener el webhook GHL sin Custom Code, incorporar los IDs de conversación/mensaje, recuperar media en DealerADMIN, procesar con faster-whisper + PaddleOCR en Docker, guardar evidencia derivada y reutilizar el collector monotónico. Primero local, luego shadow mode con un dealer y finalmente activación gradual.',
    PALE_GREEN, GREEN))
story.append(Spacer(1, 6 * mm))
story.append(P('No recomiendo comenzar activando Conversation AI Audio Response de GHL: su documentación indica cobro bajo Conversations AI y su transcripción está orientada al bot/respuesta, no a entregar una fuente estable y controlada para nuestro collector. Tampoco recomiendo volver a Custom Code para intentar transportar archivos.', 'Bodyx'))
story.append(P('12. Fuentes consultadas', 'H1x'))
sources = [
    ('HighLevel - Workflow Action Webhook (Outbound)', 'https://help.gohighlevel.com/support/solutions/articles/155000003299'),
    ('HighLevel API - InboundMessage webhook', 'https://marketplace.gohighlevel.com/docs/2023-02-21/webhook/InboundMessage/'),
    ('HighLevel API - Get messages by conversation id', 'https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages/index.html'),
    ('HighLevel API - Get recording by Message ID', 'https://marketplace.gohighlevel.com/docs/2023-02-21/ghl/conversations/get-message-recording/'),
    ('HighLevel API - Get transcription by Message ID', 'https://marketplace.gohighlevel.com/docs/ghl/conversations/get-message-transcription/'),
    ('HighLevel - Conversations AI audio response', 'https://help.gohighlevel.com/support/solutions/articles/155000006650-conversations-ai-bots-can-now-respond-to-audio'),
    ('HighLevel - Native WhatsApp voice notes with transcriptions', 'https://help.gohighlevel.com/support/solutions/articles/155000007324-native-whatsapp-voice-notes-with-transcriptions'),
    ('SYSTRAN - faster-whisper', 'https://github.com/SYSTRAN/faster-whisper'),
    ('PaddlePaddle - PaddleOCR', 'https://github.com/PaddlePaddle/PaddleOCR'),
    ('Tesseract OCR - README', 'https://github.com/tesseract-ocr/tesseract'),
]
for label, url in sources:
    story.append(P(f'<b>{escape(label)}</b><br/><font color="#155EEF">{escape(url)}</font>', 'Smallx'))

story.append(PageBreak())
story.append(P('APENDICE A. MEGA PROMPT PARA EJECUTAR LA TAREA', 'H1x'))
story.append(P(
    'Copia el siguiente prompt completo en el agente que vaya a ejecutar el trabajo. Obliga a separar auditoria, prueba local, cambio de codigo, publicacion y evidencia real para reducir errores.',
    'Bodyx'))
mega_prompt = '''Actua como ingeniero senior de backend, QA y operaciones de HighLevel para DealerADMIN. Ejecuta esta tarea de forma conservadora y verificable.

OBJETIVO
Investiga por que los audios e imagenes que llegan a GHL no siempre se transportan ni mejoran la normalizacion. Implementa una ruta sin APIs de IA pagadas: GHL envia el evento y la referencia al attachment; DealerADMIN recupera la conversacion; un worker Docker local procesa audio con faster-whisper e imagenes con PaddleOCR/Tesseract; el resultado se guarda como evidencia adicional; el collector normaliza sin perder informacion y solo promueve el lead cuando los hechos requeridos estan demostrados.

REGLAS NO NEGOCIABLES
1. Repositorio: C:\\\\dev\\\\dealeradmin. Revisa primero el worktree y conserva cambios ajenos.
2. Conserva exactamente: Customer Replied -> #1 Normalize Messenger Phone -> Write normalized phone to contact.phone -> Webhook.
3. No elimines, reemplaces ni reescribas el Custom Code existente de normalizacion telefonica. En Stafford, WhatsApp ya aporta el numero por el canal.
4. Conserva headers y datos actuales. El webhook debe aceptar como minimo message_body, contact_phone, contact_name, channel y message_attachments={{message.attachments}}. Agrega IDs solo de forma aditiva.
5. No uses APIs de IA pagadas, SaaS externos ni procesamiento pesado dentro de Vercel o del workflow GHL.
6. No inventes mensajes, attachments, timestamps ni resultados. Usa JSON/archivos reales o fixtures identificados como fixtures.
7. Nunca solicites, imprimas ni guardes credenciales. El usuario inyecta tokens y cookies; redacta PII y URLs firmadas en logs.
8. La normalizacion es monotona: una pasada puede agregar o mejorar evidencia, pero nunca borrar ni degradar datos validos.
9. No envies mensajes, no borres conversaciones, no cambies Neon manualmente y no publiques codigo sin mostrar primero evidencia local y pedir autorizacion para el deploy.

FASE 1 - AUDITORIA DE SOLO LECTURA
1. Inspecciona README, package.json, Docker, migraciones, webhooks, collector-normalizer, estados y pruebas.
2. Localiza endpoint customer-replied, contrato, persistencia, reconciliacion de 30 segundos y decision partial/waiting_window/queued.
3. En Chrome audita cada cuenta autorizada. Por cada workflow Capture Customer Replied registra nombre, estado, secuencia, URL, datos personalizados, headers y ultima actualizacion.
4. No toques workflows de marketing, bots, WhatsApp IA, llamadas IA ni automatizaciones ajenas.
5. Antes de cada edicion refresca el DOM y verifica que inputs dinamicos no tengan sufijos de prueba. Al final confirma Published.
6. Entrega diagnostico, causa probable, riesgo, cambio minimo y prueba esperada antes de modificar codigo.

FASE 2 - JSON REAL
1. Captura una conversacion real autorizada de Stafford por WhatsApp con audio, otra con imagen y, si existe, otra con audio mas texto. Captura un caso equivalente de Messenger.
2. Consulta el JSON de conversacion y mensajes sin exponer secretos. Conserva messageId, conversationId, contactId, locationId, channel, direction, body, messageType y attachments.
3. Comprueba si message_attachments llega en el webhook. Si no llega, prueba recuperarlo con Conversations API y documenta exactamente donde se pierde.
4. Crea fixtures anonimizados con procedencia y hash. Nunca trates un fixture inventado como evidencia de produccion.
5. Acepta attachments como array, objeto, string URL o ausente; normaliza internamente a url, content_type, kind, filename, size y source_message_id.

FASE 3 - REPRODUCCION LOCAL CON DOCKER
1. Reutiliza primero los contenedores existentes. Crea y elimina solo infraestructura temporal propia.
2. Reproduce el webhook real anonimizado; verifica persistencia, idempotencia y respuesta rapida.
3. Separa API y worker: el API encola media_pending y responde; el worker procesa con retry y backoff.
4. Audio: acepta OGG/Opus, AAC, M4A, MP3 y WAV; limita tamano/duracion; limpia temporales; calcula attachment_hash.
5. Usa faster-whisper local, empezando con CPU INT8 y modelo multilingue. Registra texto, idioma, segmentos/timestamps, duracion, modelo, confianza y error.
6. Imagen: usa PaddleOCR local y Tesseract como fallback. Registra texto, cajas/confianza si existen, tipo, hash y error. Una foto de vehiculo sin texto no es evidencia OCR.
7. Si el recurso expira, requiere autorizacion o no descarga, registra fallo recuperable y conserva attachment y estado.

FASE 4 - EVIDENCIA Y NORMALIZACION
1. Guarda source=audio_transcription o image_ocr junto con mensaje original, attachment, raw_payload, hash, modelo, confidence y processed_at.
2. Reutiliza el collector y merge monotono. No uses asignaciones ciegas que puedan borrar campos.
3. Evidencia con baja confianza no puede cumplir por si sola identificacion, documentos, banco, telefono ni requisitos criticos.
4. Audio/imagen puede completar vehicle_type, purchase_timeline, down_payment u otros campos solo si el contenido es claro y trazable.
5. Stafford/WhatsApp: el telefono del canal no bloquea por ausencia de telefono. Messenger: acepta solo telefono explicito y reciente del inbound del cliente; nunca telefono viejo o texto saliente del bot.
6. La pasada de 30 segundos debe mejorar la informacion. Si falla el worker, no borres valores ni empeores el estado por falta temporal de media.
7. Promueve a queued solo cuando se cumplan los requisitos reales del dealer; de lo contrario conserva partial o waiting_window con missing_qualification correcto.

FASE 5 - PRUEBAS OBLIGATORIAS
Ejecuta y reporta unitarias, integracion y E2E/local:
1. Texto sin attachment: comportamiento identico al actual.
2. Solo audio; solo imagen; audio mas texto: una evidencia y merge sin perdida.
3. Webhook repetido o attachment repetido: una sola transcripcion/OCR por hash.
4. Media fallida: retry, error trazable, conversacion conservada y sin invencion.
5. Audio tardio: mejora vehicle_type o purchase_timeline sin borrar datos validos.
6. Dos pasadas de 30 segundos: la segunda nunca empeora memoria ni estado.
7. Stafford con vehiculo y WhatsApp: queued si todos los requisitos del dealer estan presentes.
8. Messenger con numero reciente y vehiculo: misma condicion sin datos stale.
9. Logs sin tokens, URLs firmadas completas ni PII innecesaria.
10. Workflow: Custom Code telefonico intacto, message_attachments={{message.attachments}}, headers intactos y Published.

FASE 6 - ENTREGA
No declares terminado hasta entregar:
1. Causa raiz con evidencia de JSON y codigo.
2. Archivos modificados y motivo de cada cambio.
3. Comandos Docker y pruebas ejecutadas con resultado.
4. Matriz por dealer y estado antes/despues, sin telefonos completos.
5. Separacion de evidencia inspeccionada, guardada en GHL, publicada y probada realmente en produccion.
6. Workflows modificados y cuentas sin workflow de captura, dejando estas ultimas intactas.
7. Riesgos pendientes: scopes, URLs, CPU, idiomas, confidence y fallos.
8. Piloto, rollback seguro y siguiente paso.
9. Si hay login, MFA, QR, token o permiso, detente en esa pantalla, pide solo esa autorizacion y continua despues.

REGLA FINAL
Prioriza exactitud sobre velocidad. Ante cualquier duda, vuelve al JSON real, compara contra el estado anterior y demuestra que la nueva normalizacion agrega evidencia sin empeorarla.'''
story.append(P(escape(mega_prompt).replace('\n', '<br/>'), 'Codex'))

story.append(Spacer(1, 7 * mm))
story.append(P('Nota de alcance: las fuentes web describen capacidades públicas de HighLevel y de los proyectos open source. La disponibilidad exacta de attachments, scopes, URLs y transcripciones debe confirmarse con un JSON real de cada canal antes de activar producción.', 'Smallx'))

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
    topMargin=17 * mm, bottomMargin=19 * mm,
    title='Plan de media GHL a DealerADMIN sin IA pagada',
    author='DealerADMIN',
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
