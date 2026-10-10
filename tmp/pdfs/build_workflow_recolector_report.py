from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    Image, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from pathlib import Path


ROOT = Path(r"C:\dev\dealeradmin")
OUT = ROOT / "output" / "pdf" / "informe-recolector-qualification-memory-y-custom-fields-2026-09-08.pdf"
IMG1 = Path(r"C:\Users\Dell\AppData\Local\Temp\codex-clipboard-3a6f8edb-5265-4b3c-8687-05b08719b1ae.png")
IMG2 = Path(r"C:\Users\Dell\AppData\Local\Temp\codex-clipboard-a44d4874-08fb-4089-b577-2e601df003b6.png")

for font_path in [
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]:
    if Path(font_path).exists():
        pdfmetrics.registerFont(TTFont("AppFont", font_path))
        pdfmetrics.registerFont(TTFont("AppFont-Bold", font_path.replace(".ttf", "b.ttf")))
        BODY_FONT = "AppFont"
        BOLD_FONT = "AppFont-Bold"
        break
else:
    BODY_FONT = "Helvetica"
    BOLD_FONT = "Helvetica-Bold"


TEAL = colors.HexColor("#087F7B")
NAVY = colors.HexColor("#102A43")
INK = colors.HexColor("#243B53")
MUTED = colors.HexColor("#627D98")
PALE = colors.HexColor("#E8F4F3")
PALE_BLUE = colors.HexColor("#EDF3F8")
RED = colors.HexColor("#B42318")
AMBER = colors.HexColor("#B54708")
GREEN = colors.HexColor("#027A48")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", fontName=BOLD_FONT, fontSize=9, leading=12,
    textColor=TEAL, spaceAfter=8, tracking=1.1,
))
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=BOLD_FONT, fontSize=25, leading=30,
    textColor=NAVY, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="CoverSub", fontName=BODY_FONT, fontSize=12, leading=17,
    textColor=INK, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="H1x", fontName=BOLD_FONT, fontSize=17, leading=21,
    textColor=NAVY, spaceBefore=5, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="H2x", fontName=BOLD_FONT, fontSize=11.5, leading=15,
    textColor=TEAL, spaceBefore=8, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Bodyx", fontName=BODY_FONT, fontSize=9.2, leading=13.4,
    textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Smallx", fontName=BODY_FONT, fontSize=7.6, leading=10.5,
    textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Cell", fontName=BODY_FONT, fontSize=7.5, leading=10.3,
    textColor=INK,
))
styles.add(ParagraphStyle(
    name="CellBold", fontName=BOLD_FONT, fontSize=7.6, leading=10.4,
    textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="Callout", fontName=BODY_FONT, fontSize=9, leading=13,
    textColor=NAVY, leftIndent=8, rightIndent=8, spaceBefore=2, spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="Code", fontName="Courier", fontSize=7.5, leading=10.2,
    textColor=INK, backColor=PALE_BLUE, leftIndent=7, rightIndent=7,
    borderPadding=6, spaceBefore=4, spaceAfter=6,
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def bullet(text):
    return P("&#8226;&nbsp; " + text, "Bodyx")


def table(data, widths, header=True, extra=None):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9E2EC")),
    ]
    if header:
        cmds += [
            ("BACKGROUND", (0, 0), (-1, 0), TEAL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
        ]
    for row in range(1 if header else 0, len(data)):
        if row % 2 == (1 if header else 0):
            cmds.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#F7FAFC")))
    if extra:
        cmds.extend(extra)
    t.setStyle(TableStyle(cmds))
    return t


def image_fit(path, max_w=17.2 * cm, max_h=8.2 * cm):
    im = Image(str(path))
    iw, ih = ImageReader(str(path)).getSize()
    scale = min(max_w / iw, max_h / ih)
    im.drawWidth = iw * scale
    im.drawHeight = ih * scale
    im.hAlign = "CENTER"
    return im


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    if doc.page > 1:
        canvas.setStrokeColor(colors.HexColor("#D9E2EC"))
        canvas.setLineWidth(0.5)
        canvas.line(1.7 * cm, h - 1.25 * cm, w - 1.7 * cm, h - 1.25 * cm)
        canvas.setFont(BOLD_FONT, 7.5)
        canvas.setFillColor(TEAL)
        canvas.drawString(1.7 * cm, h - 0.95 * cm, "dealerADMIN | INFORME DE DECISION")
        canvas.setFont(BODY_FONT, 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(w - 1.7 * cm, h - 0.95 * cm, "08 sep 2026")
    canvas.setStrokeColor(colors.HexColor("#D9E2EC"))
    canvas.line(1.7 * cm, 1.25 * cm, w - 1.7 * cm, 1.25 * cm)
    canvas.setFont(BODY_FONT, 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(1.7 * cm, 0.82 * cm, "Documento de analisis - no modifica workflows ni produccion")
    canvas.drawRightString(w - 1.7 * cm, 0.82 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


story = []

# Cover
story += [Spacer(1, 2.0 * cm), P("INFORME DE DECISION | WORKFLOW RECOLECTOR", "CoverKicker")]
story += [P("Cuando el lead llega incompleto o contaminado", "CoverTitle")]
story += [P("Qualification memory, custom fields y la ruta segura hacia dealerADMIN", "CoverSub")]
story += [HRFlowable(width="100%", thickness=2, color=TEAL, spaceBefore=3, spaceAfter=16)]
story += [P("Fecha de corte: 8 de septiembre de 2026", "H2x")]
story += [P("Alcance: Fredericksburg, Fredericksburg 2, Stafford y Easterns. Este documento registra el problema, compara dos enfoques y deja una recomendacion para ejecutar manana. No autoriza cambios externos.", "Bodyx")]
story += [Spacer(1, 10)]
cover_data = [
    [P("Resumen ejecutivo", "CellBold"), P("El disparador parece llegar, pero el recolector no conserva de forma confiable el conjunto completo de respuestas. Carmen Sara Rivera es el caso visible: la conversacion tiene ubicacion, telefono, interes inmediato, identificacion y comprobante de ingresos; la `qualification_memory` muestra solo `20; vehicle: Suv; down payment: trade:in`.", "Cell")],
    [P("Estado confirmado por el usuario", "CellBold"), P("Los workflows estan Published. Eso es estado de configuracion, no prueba de que cada ejecucion guarde el telefono, preserve el transcript y entregue un payload correcto a dealerADMIN.", "Cell")],
    [P("Recomendacion", "CellBold"), P("Adoptar una arquitectura hibrida: transcript completo como evidencia, extraccion estructurada a JSON con schema, validacion determinista en dealerADMIN y custom fields solo como campos operativos/indices, no como fuente unica de verdad.", "Cell")],
]
story += [table(cover_data, [4.0 * cm, 13.1 * cm], header=False, extra=[("BACKGROUND", (0, 0), (0, -1), PALE)])]
story += [Spacer(1, 9), P("Decision propuesta: no borrar los custom fields indiscriminadamente manana. Primero separar la captura raw de la normalizacion operativa; luego retirar solo los campos que no tengan una funcion clara y comprobada.", "Callout")]
story += [PageBreak()]

# Problem
story += [P("1. Que esta pasando", "H1x")]
story += [P("La evidencia apunta a una falla en el workflow recolector, no necesariamente en el disparador. El trigger puede activarse y aun asi una accion intermedia puede leer un valor equivocado, sobrescribirlo, truncarlo, no retornarlo o enviar a la siguiente etapa solo una parte de la informacion.", "Bodyx")]
story += [P("P0 - Regla obligatoria para el telefono", "H2x"), P("Si el contacto escribe un numero en cualquier punto de la conversacion, el recolector debe detectarlo, normalizarlo y escribirlo en el campo estandar `contact.phone` antes de evaluar el workflow disparador. El disparador puede seguir siendo `contact.phone` no vacio; lo que no puede ocurrir es que el numero quede solo dentro del texto o de una memoria parcial. Si el numero no pasa validacion, se conserva la evidencia y se bloquea el envio automatico en vez de inventar o descartar silenciosamente.", "Callout")]
problem_data = [
    [P("Sintoma", "CellBold"), P("Evidencia / impacto", "CellBold"), P("Hipotesis de causa", "CellBold")],
    [P("Fredericksburg no saca toda la informacion", "Cell"), P("La cola muestra leads con telefono pero varios campos como down, ID, documentos y tiempo quedan como no indicado.", "Cell"), P("Salida incompleta del bloque Normalize, mapeo asimetrico entre ramas o lectura de un campo viejo en vez del valor dinamico.", "Cell")],
    [P("Easterns no envio un lead que tenia numero", "Cell"), P("El numero existia en la conversacion, pero nunca se guardo como telefono util para la condicion de envio.", "Cell"), P("El recolector no detecto, normalizo y escribio `contact.phone` antes del trigger; por tanto la condicion pudo evaluar Phone vacio.", "Cell")],
    [P("Informacion contaminada", "Cell"), P("Ejemplo conocido: `20` termina interpretado como down payment aunque no sea un enganche confirmado; `trade:in` aparece mezclado con otros datos.", "Cell"), P("El workflow trata texto libre o respuestas aisladas como si fueran hechos finales, sin schema, evidencia ni reglas de confianza.", "Cell")],
    [P("Carmen queda incompleta", "Cell"), P("La memoria visible contiene solo tres fragmentos y omite telefono, ciudad, timeline, ID y comprobante.", "Cell"), P("El campo de memoria esta funcionando como resumen parcial, no como transcript completo ni como objeto acumulativo validado.", "Cell")],
]
story += [table(problem_data, [4.1 * cm, 6.3 * cm, 6.7 * cm])]
story += [Spacer(1, 7), P("Correccion de estado", "H2x"), P("Todos los workflows se consideran Published segun la correccion del usuario. El informe no afirma que alguno este Draft. La conclusion funcional permanece: Published no garantiza ejecucion correcta ni persistencia completa.", "Bodyx")]
story += [P("El caso Carmen Sara Rivera", "H2x")]
story += [P("La conversacion aportada contiene, al menos, estas señales: objecion de credito, ubicacion en Virginia/Maryland, intencion de comprar ya, identificacion valida y comprobante de ingresos. En otro tramo visible aparece una ciudad de Pennsylvania, Harrisburg, y un telefono `2232848722`. Sin embargo, el valor guardado mostrado en GHL es: `20; vehicle: Suv; down payment: trade:in`. Esa diferencia es suficiente para declarar que la captura no es confiable aunque el workflow este Published.", "Bodyx")]
if IMG2.exists():
    story += [image_fit(IMG2, max_w=16.9 * cm, max_h=7.1 * cm), P("Figura 1. Evidencia aportada: la conversacion y el valor parcial de `qualification_memory` se ven en la misma pantalla.", "Smallx")]
story += [PageBreak()]

# Evidence
story += [P("2. Que confirma la memoria previa y que no confirma", "H1x")]
story += [P("La memoria de trabajo recuperada de auditorias anteriores es util, pero debe mantenerse separada de la evidencia live actual.", "Bodyx")]
mem_data = [
    [P("Confirmado por auditorias previas", "CellBold"), P("Limite que sigue vigente", "CellBold")],
    [P("El backend/webhook tiene normalizacion para fusionar mensaje, historial y `qualification_memory`; tambien rechaza contaminacion vacia y telefonos tratados como down payment.", "Cell"), P("Eso solo demuestra capacidad de codigo y pruebas locales. No demuestra que el workflow entregue el input completo en cada dealer.", "Cell")],
    [P("Se identificaron problemas previos en Fredericksburg: bloques Normalize sin un `return { ... }` visible y mapeos primario/fallback no simetricos.", "Cell"), P("Ahora el usuario afirma que todos estan Published; el informe no usa la observacion anterior de Draft como estado actual.", "Cell")],
    [P("Fredericksburg 2 habia mostrado riesgo de priorizar `current_phone` en vez del `inputData.phone` mapeado.", "Cell"), P("Debe probarse con un lead real y con el log de ejecucion; el nombre del campo no es prueba de que el valor viajo.", "Cell")],
    [P("La secuencia esperada es trigger -> update -> complete information -> normalize -> AI -> save.", "Cell"), P("La posicion correcta no evita por si sola truncamiento, overwrite, tipo incorrecto o salida mal conectada.", "Cell")],
]
story += [table(mem_data, [8.5 * cm, 8.6 * cm])]
story += [Spacer(1, 8), P("Regla para manana", "H2x"), P("No declarar solucion por ver Published, Saved, un HTTP 201 o una fila en dealerADMIN. La prueba de cierre debe seguir un lead real desde la conversacion hasta: transcript/memory, campos estructurados, `dealeradmin_send_now`, webhook, `processed` en Neon, dealer correcto y una sola fila en la cola.", "Callout")]
if IMG1.exists():
    story += [Spacer(1, 8), image_fit(IMG1, max_w=16.9 * cm, max_h=6.5 * cm), P("Figura 2. Evidencia aportada: la cola de Fredericksburg muestra telefono en algunos leads, pero calificaciones incompletas.", "Smallx")]
story += [PageBreak()]

# User solution
story += [P("3. Opcion A - tu propuesta: solo qualification memory", "H1x")]
story += [P("La idea es quitar definitivamente los custom fields usados para calificacion, guardar toda la conversacion en `qualification_memory`, hacer que esa memoria identifique cada dato, producir un JSON con la conversacion completa y dejar que dealerADMIN normalice el resultado.", "Bodyx")]
story += [P("Flujo conceptual", "H2x")]
story += [P("Conversacion completa -> qualification_memory -> paso de interpretacion -> JSON completo + datos detectados -> webhook -> normalizacion en dealerADMIN -> persistencia/routing.", "Code")]
opt_a = [
    [P("Ventajas", "CellBold"), P("Riesgos", "CellBold")],
    [P("Un solo lugar visible para el contexto; menos campos que mantener; el backend recibe el raw y conserva control sobre la normalizacion; reduce discrepancias entre campos duplicados.", "Cell"), P("`Conversation Memory` de HighLevel no equivale necesariamente a transcript completo: la documentacion lo describe como rolling summary opcional. Un campo largo puede ser sobrescrito, resumido o quedarse incompleto.", "Cell")],
    [P("Permite re-procesar la misma conversacion si el JSON incluye mensajes, timestamps, direccion y canal.", "Cell"), P("Si el paso de IA debe adivinar que significa un `Si`, puede asignarlo al ID o al comprobante equivocado; la ambiguedad de contexto no desaparece por usar un unico campo.", "Cell")],
    [P("Es compatible con el normalizador de dealerADMIN si el contrato JSON es estricto y versionado.", "Cell"), P("Quitar todos los custom fields puede romper condiciones, `Skip if Already Filled`, reportes, reglas de Phone y rutas ya existentes. Tambien elimina indices utiles para operaciones.", "Cell")],
]
story += [table(opt_a, [8.5 * cm, 8.6 * cm])]
story += [P("Mi veredicto sobre tu propuesta", "H2x"), P("La conservaria como parte del diseño, pero no como `solo memory` sin una fuente raw de transcript y sin un schema con evidencia. Es una buena correccion del problema de duplicar la misma respuesta en muchos campos, pero deja demasiado poder en un resumen libre.", "Bodyx")]
story += [PageBreak()]

# Web-based solution
story += [P("4. Opcion B - recomendada: arquitectura hibrida documentada", "H1x")]
story += [P("La alternativa se basa en separar tres capas: evidencia completa, extraccion estructurada y datos operativos. HighLevel aporta transcript/Conversation AI y acciones de campo; dealerADMIN conserva la autoridad para normalizar, validar, enrutar y guardar.", "Bodyx")]
opt_b = [
    [P("Capa", "CellBold"), P("Que guardar", "CellBold"), P("Regla", "CellBold")],
    [P("1. Raw evidence", "Cell"), P("Transcript completo con cada mensaje, direccion, timestamp, canal y contacto.", "Cell"), P("Inmutable o append-only. No usarlo para decidir directamente el envio.", "Cell")],
    [P("2. Extraction", "Cell"), P("JSON con `phone`, `real_name`, `vehicle_type`, `vehicle_make`, `vehicle_model`, `vehicle_year`, `down_payment`, `has_trade_in`, `has_valid_id`, `has_income_proof`, `purchase_timeline`, `city`, `state`, `zip`, `source` y `confidence/evidence`.", "Cell"), P("AI Extract Data o AI Agent con output JSON; cada campo tiene tipo, descripcion y regla de null cuando no hay evidencia.", "Cell")],
    [P("3. Operational index", "Cell"), P("Solo los campos necesarios para filtros, `Skip if Already Filled`, routing, `dealeradmin_send_now` y reportes.", "Cell"), P("Custom fields no son la fuente maestra. Se actualizan desde el JSON validado, no desde respuestas sueltas.", "Cell")],
    [P("4. Backend authority", "Cell"), P("Payload raw + JSON extraido + campos normalizados + trazabilidad.", "Cell"), P("dealerADMIN valida tipos, telefono, down payment, estados, completitud, idempotencia y dealer de origen.", "Cell")],
]
story += [table(opt_b, [3.2 * cm, 7.1 * cm, 6.8 * cm])]
story += [P("Como debe tratar respuestas ambiguas", "H2x")]
amb_data = [
    [P("Respuesta", "CellBold"), P("Interpretacion segura", "CellBold")],
    [P("Si", "Cell"), P("No se asigna sola. Se vincula a la pregunta inmediatamente anterior o al objetivo activo. Si hay dos preguntas consecutivas, se marca `ambiguous` y se conserva la evidencia.", "Cell")],
    [P("Quiero comprar ya", "Cell"), P("`purchase_timeline = immediate` solo si el parser reconoce la respuesta como tiempo de compra; nunca crear down payment por un numero sin etiqueta.", "Cell")],
    [P("20", "Cell"), P("No es down payment sin etiqueta como down, down payment, enganche o inicial. Puede ser ano, edad, parte de telefono o ruido.", "Cell")],
    [P("2232848722", "Cell"), P("Extraer como telefono solo si cumple formato y procede del mensaje del cliente o del campo Phone; guardar la evidencia original.", "Cell")],
]
story += [table(amb_data, [4.5 * cm, 12.6 * cm])]
story += [P("Por que esta opcion es mejor", "H2x"), P("Evita que la memoria libre sea el unico punto de fallo, conserva la conversacion para auditoria, permite que el JSON sea re-procesable y mantiene los custom fields donde aportan valor operativo. Tambien hace visible el motivo de cada valor: fuente, mensaje y confianza.", "Bodyx")]
story += [PageBreak()]

# Official research
story += [P("5. Lo que dice la documentacion actual de HighLevel", "H1x")]
story += [P("La busqueda se hizo el 8 de septiembre de 2026. Para la recomendacion use documentacion oficial de HighLevel, porque ofrece contratos y limites mas verificables que un tutorial de terceros. No se encontro en la busqueda una URL de YouTube oficial, fechada y suficientemente especifica para usarla como autoridad; por eso la opcion B se apoya en documentacion actual.", "Bodyx")]
research = [
    [P("Fuente oficial", "CellBold"), P("Hallazgo relevante para este caso", "CellBold")],
    [P("AI Extract Data Workflow Action", "Cell"), P("Convierte texto no estructurado en campos estructurados para pasos posteriores; permite definir nombre, tipo y descripcion de cada dato. Es la pieza mas cercana a extraer el JSON por schema.", "Cell")],
    [P("Conversation Summary and Transcript", "Cell"), P("Distingue summary de transcript. El transcript es el registro mas completo y puede enviarse a un workflow; por defecto el resumen esta apagado y no se guarda si no se conecta explicitamente.", "Cell")],
    [P("AI Agent Action", "Cell"), P("La Conversation Memory es un rolling summary opcional. El output JSON existe como formato estructurado; la accion tambien puede recuperar historial de conversaciones, pero eso debe probarse en el workflow concreto.", "Cell")],
    [P("Bot Goals / Update Contact Field", "Cell"), P("El mapeo de cada pregunta a un campo es explicito. Si una pregunta no se mapea, puede contestarse sin actualizar el campo esperado. Los tipos deben coincidir y Update Contact Field reemplaza el valor incluido.", "Cell")],
]
story += [table(research, [6.0 * cm, 10.1 * cm])]
story += [P("Consecuencia practica", "H2x"), P("No conviene llamar `qualification_memory` a un mecanismo de transcript si en realidad guarda un resumen rolling o un texto que se actualiza. Debemos nombrar y probar por separado: `raw_transcript`, `qualification_json`, `qualification_memory` resumida y campos operativos.", "Callout")]
story += [P("Fuentes consultadas", "H2x")]
sources = [
    "HighLevel, Workflow Action - Update Contact Field: https://help.gohighlevel.com/support/solutions/articles/155000002688-workflow-action-update-contact-field",
    "HighLevel, AI Extract Data Workflow Action: https://help.gohighlevel.com/support/solutions/articles/155000007992-workflow-action-ai-extract-data",
    "HighLevel, Conversation Summary and Transcript: https://help.gohighlevel.com/support/solutions/articles/155000006597",
    "HighLevel, AI Agent Action in Workflows: https://help.gohighlevel.com/support/solutions/articles/155000007600-workflow-action-ai-agent",
    "HighLevel, Bot Goals and field mapping: https://help.gohighlevel.com/support/solutions/articles/155000004095-bot-goals-feature-complete-guide",
    "HighLevel, How to Use Custom Fields: https://help.gohighlevel.com/support/solutions/articles/155000008031-how-to-use-custom-fields",
]
for s in sources:
    story.append(P(s, "Smallx"))
story += [PageBreak()]

# Recommendation and tomorrow plan
story += [P("6. Recomendacion final y plan de manana", "H1x")]
story += [P("Escogeria la Opcion B, pero incorporando la intuicion central de tu Opcion A: reducir duplicacion y hacer que dealerADMIN sea quien normaliza. La diferencia decisiva es que la Opcion B no confunde un resumen de memoria con la conversacion completa y no le pide al modelo resolver ambiguedades sin evidencia.", "Bodyx")]
decision = [
    [P("Criterio", "CellBold"), P("Opcion A: solo memory", "CellBold"), P("Opcion B: hibrida", "CellBold")],
    [P("Conservar transcript completo", "Cell"), P("Solo si se implementa aparte; memory no lo garantiza.", "Cell"), P("Si, como raw evidence separado.", "Cell")],
    [P("Evitar contaminacion", "Cell"), P("Depende mucho de prompt y resumen.", "Cell"), P("Schema + tipos + null + reglas backend.", "Cell")],
    [P("Phone para envio", "Cell"), P("Puede perderse si el resumen omite el mensaje.", "Cell"), P("Se detecta y normaliza antes de escribir `contact.phone`; despues se evalua el trigger.", "Cell")],
    [P("Mantenimiento", "Cell"), P("Menos campos, pero mas responsabilidad en IA.", "Cell"), P("Algo mas de configuracion, pero limites claros y auditable.", "Cell")],
    [P("Riesgo operativo", "Cell"), P("Alto si solo existe un texto mutable.", "Cell"), P("Medio y medible por logs, schema y pruebas.", "Cell")],
]
story += [table(decision, [4.0 * cm, 6.0 * cm, 6.1 * cm])]
story += [P("Secuencia de trabajo propuesta", "H2x")]
for text in [
    "Congelar cambios en los cuatro workflows hasta capturar evidencia de una prueba controlada; no borrar campos antes de inventariar dependencias.",
    "Definir el contrato JSON y los nombres exactos: raw transcript, campos extraidos, evidencia por campo y estado de completitud.",
    "Probar primero con Carmen y con un caso Easterns que ya tenga telefono; despues repetir en Fredericksburg, Fredericksburg 2 y Stafford.",
    "Verificar el log de cada accion: entrada, salida, campo escrito, valor final, trigger de envio y webhook recibido.",
    "Validar dealerADMIN: payload completo, normalizacion, routing, idempotencia, `processed` y una sola fila correcta.",
    "Solo despues decidir que custom fields se eliminan, cuales se conservan como indices y cuales se actualizan desde JSON validado.",
]:
    story.append(bullet(text))
story += [P("Criterio de aprobacion", "H2x"), P("No se aprueba por un lead feliz. Deben pasar casos: memoria/transcript completo, telefono en mensaje, respuesta `Si` a ID y comprobante, numero no etiquetado que no se vuelva down payment, dos respuestas consecutivas ambiguas, informacion parcial y reingreso/duplicado. Cualquier perdida del telefono o del transcript bloquea la publicacion del cambio.", "Callout")]
story += [Spacer(1, 12), HRFlowable(width="100%", thickness=1, color=TEAL, spaceBefore=4, spaceAfter=8)]
story += [P("Conclusión", "H2x"), P("El desastre descrito es coherente con una frontera de captura defectuosa: el trigger puede funcionar, pero el recolector no entrega un registro fiel y completo. La salida mas segura es dejar de usar campos sueltos como verdad primaria, conservar el transcript completo, extraer un JSON con schema y dejar la normalizacion final en dealerADMIN.", "Bodyx")]

doc = SimpleDocTemplate(
    str(OUT), pagesize=A4, rightMargin=1.7 * cm, leftMargin=1.7 * cm,
    topMargin=1.65 * cm, bottomMargin=1.65 * cm,
    title="Informe recolector qualification memory y custom fields",
    author="dealerADMIN",
)
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(OUT)
