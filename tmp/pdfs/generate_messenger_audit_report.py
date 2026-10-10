from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor
from xml.sax.saxutils import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "pdf" / "informe-auditoria-correccion-messenger-2026-09-09.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = HexColor("#123047")
TEAL = HexColor("#0C8B87")
MINT = HexColor("#EAF6F4")
PALE = HexColor("#F4F7F8")
INK = HexColor("#1C2A33")
MUTED = HexColor("#5F6E78")
RED = HexColor("#B33A3A")
GOLD = HexColor("#B47D24")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=27, leading=32, textColor=NAVY, alignment=TA_LEFT, spaceAfter=12
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=12, leading=18, textColor=MUTED, spaceAfter=8
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=17, leading=21, textColor=NAVY, spaceBefore=6, spaceAfter=9
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, textColor=TEAL, spaceBefore=8, spaceAfter=5
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.4, leading=13.5, textColor=INK, spaceAfter=6
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8, leading=10.5, textColor=MUTED, spaceAfter=3
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=10, leading=14, textColor=NAVY, backColor=MINT,
    borderColor=TEAL, borderWidth=0.8, borderPadding=9, spaceBefore=5, spaceAfter=10
))
styles.add(ParagraphStyle(
    name="RuleBad", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.2, leading=13, textColor=RED, backColor=HexColor("#FFF1F1"),
    borderColor=RED, borderWidth=0.7, borderPadding=8, spaceAfter=7
))
styles.add(ParagraphStyle(
    name="RuleGood", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.2, leading=13, textColor=NAVY, backColor=PALE,
    borderColor=TEAL, borderWidth=0.7, borderPadding=8, spaceAfter=7
))
styles.add(ParagraphStyle(
    name="Prompt", parent=styles["BodyText"], fontName="Courier",
    fontSize=6.7, leading=8.5, textColor=INK, backColor=PALE,
    borderColor=HexColor("#CCD9DE"), borderWidth=0.6, borderPadding=9,
    spaceBefore=3, spaceAfter=6, wordWrap="LTR"
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=8, leading=10, textColor=colors.white, spaceAfter=0
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 0.18 * inch, width, 0.18 * inch, fill=1, stroke=0)
    canvas.setStrokeColor(HexColor("#D6E0E4"))
    canvas.line(0.62 * inch, 0.54 * inch, width - 0.62 * inch, 0.54 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.62 * inch, 0.34 * inch, "dealerADMIN | Auditoria Messenger")
    canvas.drawRightString(width - 0.62 * inch, 0.34 * inch, f"Pagina {doc.page}")
    canvas.restoreState()


doc = BaseDocTemplate(
    str(OUT), pagesize=letter, leftMargin=0.62 * inch, rightMargin=0.62 * inch,
    topMargin=0.62 * inch, bottomMargin=0.72 * inch,
    title="Auditoria y correccion de workflows Messenger - dealerADMIN",
    author="dealerADMIN"
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=header_footer)])

story = []

# Cover
story += [Spacer(1, 0.55 * inch), P("AUDITORIA OPERATIVA", "Smallx"),
          P("Correccion de workflows Messenger", "CoverTitle"),
          P("Prevencion de envios prematuros y limpieza de datos en dealerADMIN", "CoverSub"),
          Spacer(1, 0.18 * inch)]

cover_data = [
    [P("Fecha", "Smallx"), P("9 de septiembre de 2026", "Bodyx")],
    [P("Alcance", "Smallx"), P("Correccion live previa: Fredericksburg 1, Fredericksburg 2 y Easterns; cambio de enfoque manana: todos los dealers", "Bodyx")],
    [P("Stafford", "Smallx"), P("No se modifico en la correccion previa; si se incluye manana en el cambio de enfoque, respetando su logica WhatsApp", "Bodyx")],
    [P("Objetivo", "Smallx"), P("Evitar cualquier envio a dealerADMIN antes de completar la cualificacion", "Bodyx")],
]
cover_table = Table(cover_data, colWidths=[1.05 * inch, 5.65 * inch], hAlign="LEFT")
cover_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#D6E0E4")),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#E4EAED")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [cover_table, Spacer(1, 0.28 * inch),
          P("Resultado ejecutivo: se elimino la salida webhook de la rama que trataba cualquier memoria no vacia como cualificacion completa. Los tres grupos quedaron guardados y publicados. Los recolectores fueron probados con un mensaje de telefono y ya no lo convierten en nombre ni en memoria.", "Callout"),
          Spacer(1, 0.2 * inch), P("Este documento separa los hallazgos comprobados en GHL y en el repositorio de las acciones que quedan para la auditoria de nuevos leads de manana.", "Smallx"), PageBreak()]

# Findings
story += [P("1. Problema encontrado", "H1x"),
          P("La rama llamada <b>Calificacion desde qualification memory</b> tenia una condicion insuficiente: bastaba con que qualification_memory no estuviera vacia y que existiera telefono. Eso permitia enviar un lead incompleto, incluso cuando la memoria solo contenia un marcador como 0 o una frase generada a partir del mensaje del telefono.", "Bodyx"),
          P("Caso que revelo el problema", "H2x"),
          P("En Fredericksburg 2, Ivan Penante dejo su numero sin completar la cualificacion. El workflow registro el telefono y la rama insegura tomo el camino del webhook. El problema no era la regla de las tres horas: la rama de memoria estaba saltandose esa proteccion.", "Bodyx"),
          P("Contaminacion observada", "H2x"),
          P("El recolector podia guardar el texto <i>Mí número es 5714223667</i> como real_name y como qualification_memory. En pruebas anteriores tambien se comprobo el riesgo de convertir respuestas como <i>En este mes</i> en nombre real.", "Bodyx"),
          P("Diagnostico", "H2x"),
          P("Habia dos fallas relacionadas pero separadas: (1) el routing permitia enviar con memoria parcial; (2) el normalizador live de GHL no descartaba frases de telefono cuando intentaba resolver el nombre.", "Bodyx"),
          P("Problema que obliga a cambiar el enfoque", "H2x"),
          P("El telefono no se guarda de forma consistente: en algunos casos la persona lo deja, pero no termina en contact.phone ni queda completo en la salida del recolector. Se han probado las configuraciones disponibles, mapeos, custom fields, condiciones, triggers y ramas posibles, sin obtener un resultado estable. Por eso el problema ya no se tratara como un ajuste aislado de configuracion; se cambiara la arquitectura de captura para que el transcript sea evidencia, el JSON tipado sea la extraccion, el Phone gate ocurra antes del trigger y dealerADMIN tenga la autoridad final.", "Bodyx"),
          P("Importante: el telefono que llega por WhatsApp en Stafford se conserva como fuente nativa y no se altero esa logica.", "RuleGood"),
          P("2. Solucion aplicada", "H1x"),
          P("Se aplico la correccion en dos capas: workflow y codigo. Esto deja el control de envio en el workflow y el control de calidad de datos en el normalizador.", "Bodyx")]

solution_rows = [
    [P("Capa", "TableHead"), P("Cambio", "TableHead"), P("Efecto", "TableHead")],
    [P("Routing", "Bodyx"), P("Se retiro el webhook de la rama de qualification_memory no vacia.", "Bodyx"), P("Un lead incompleto ya no puede ser enviado por esa rama.", "Bodyx")],
    [P("Recolector GHL", "Bodyx"), P("Se agrego phoneLikeText y se bloqueo texto de telefono como nombre.", "Bodyx"), P("real_name y qualification_memory quedan vacios cuando solo llega el numero.", "Bodyx")],
    [P("Repositorio", "Bodyx"), P("Se actualizo el normalizador TypeScript y el espejo JavaScript, con pruebas unitarias.", "Bodyx"), P("La misma regla queda protegida en el codigo mantenible y en el custom code equivalente.", "Bodyx")],
]
tbl = Table(solution_rows, colWidths=[1.0 * inch, 3.1 * inch, 2.6 * inch], repeatRows=1)
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#CCD9DE")),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#DCE5E8")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
]))
story += [tbl, PageBreak()]

# Matrix
story += [P("3. Dealers y reglas preservadas", "H1x"),
          P("La correccion fue quirurgica: se retiro el camino inseguro, pero se conservaron las reglas de cada dealer, sus ramas horarias y el routing existente.", "Bodyx")]
dealer_rows = [
    [P("Dealer / grupo", "TableHead"), P("Routing", "TableHead"), P("Recolector", "TableHead"), P("Regla conservada", "TableHead")],
    [P("Fredericksburg 1", "Bodyx"), P("Publicado; webhook prematuro retirado", "Bodyx"), P("Publicado; normalizador protegido", "Bodyx"), P("Envio inmediato solo para cualificacion completa; incompletos siguen la espera horaria.", "Bodyx")],
    [P("Fredericksburg 2", "Bodyx"), P("Publicado; webhook prematuro retirado", "Bodyx"), P("Publicado; normalizador protegido", "Bodyx"), P("Misma separacion entre rama completa y rama de espera; Ivan no se reproceso.", "Bodyx")],
    [P("Easterns", "Bodyx"), P("Publicado; webhook prematuro retirado", "Bodyx"), P("Publicado; normalizador protegido", "Bodyx"), P("Se mantiene el routing de Easterns y su asignacion posterior; no se cambio la regla de dealer.", "Bodyx")],
    [P("Stafford", "Bodyx"), P("No modificado", "Bodyx"), P("No modificado", "Bodyx"), P("Opera diferente por WhatsApp; conserva telefono nativo y comportamiento probado.", "Bodyx")],
]
dt = Table(dealer_rows, colWidths=[1.25 * inch, 1.7 * inch, 1.6 * inch, 2.15 * inch], repeatRows=1)
dt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#CCD9DE")),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#DCE5E8")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
]))
story += [dt, Spacer(1, 0.14 * inch), P("La confirmacion visual en GHL mostro el switch de Publish activo y mensaje Saved / Workflow has been saved en los seis workflows modificados: routing y recolector de F1, F2 y Easterns.", "Callout"),
          P("4. Validacion tecnica y publicacion", "H1x"),
          P("Repositorio: commit <b>33fe3b7</b>, enviado a <b>origin/main</b> en GitHub. Se incluyeron solo cuatro archivos intencionales: los dos normalizadores y sus dos suites unitarias. Los artefactos y cambios ajenos del worktree no se incluyeron.", "Bodyx"),
          P("Pruebas: typecheck completado correctamente. La suite dirigida ejecuto 62 pruebas en dos archivos y paso completa: 46 pruebas del normalizador principal y 16 del normalizador HighLevel.", "Bodyx"),
          P("Prueba live de recolectores: con Mí número es 5714223667, los tres recolectores devolvieron real_name vacío, qualification_memory vacío, phone +15714223667 y qualification_complete false.", "Bodyx"), PageBreak()]

# Rules and tomorrow
approach_rows = [
    [P("Capa", "TableHead"), P("Funcion obligatoria manana", "TableHead"), P("Regla de seguridad", "TableHead")],
    [P("Raw evidence", "Bodyx"), P("Guardar el transcript completo: mensajes, direccion, timestamp, canal y contacto.", "Bodyx"), P("Append-only; no decide el envio directamente.", "Bodyx")],
    [P("Extraction JSON", "Bodyx"), P("Extraer JSON tipado para telefono, nombre, vehiculo, down, trade-in, ID, ingresos, tiempo, ciudad/estado/ZIP, fuente y confianza.", "Bodyx"), P("Schema estricto, tipos correctos, null explicito y evidencia por campo.", "Bodyx")],
    [P("Phone gate", "Bodyx"), P("Detectar y normalizar cualquier numero y escribirlo en contact.phone antes de evaluar el trigger.", "Bodyx"), P("Si no valida, conservar evidencia y bloquear el envio; nunca descartarlo silenciosamente.", "Bodyx")],
    [P("Campos operativos", "Bodyx"), P("Conservar solo indices utiles para filtros, routing, Skip if Already Filled, reportes y dealeradmin_send_now.", "Bodyx"), P("Actualizar desde JSON validado, no desde texto libre ni memoria parcial.", "Bodyx")],
    [P("Autoridad backend", "Bodyx"), P("dealerADMIN recibe raw + JSON, normaliza, valida completitud, enruta, aplica idempotencia y persiste.", "Bodyx"), P("No confiar en campos contaminados ni en dealer_name libre.", "Bodyx")],
]
approach_table = Table(approach_rows, colWidths=[1.1 * inch, 3.25 * inch, 2.35 * inch], repeatRows=1)
approach_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.6, HexColor("#CCD9DE")),
    ("INNERGRID", (0, 0), (-1, -1), 0.35, HexColor("#DCE5E8")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
]))

story += [P("5. Reglas prohibidas desde hoy", "H1x"),
          P("Estas dos reglas quedan como control operativo permanente para cualquier cambio futuro.", "Bodyx"),
          P("PROHIBIDO 1: No poner los workflows en Draft. Todo guardado debe terminar con Publish activo y una verificacion posterior de que el workflow sigue Published.", "RuleBad"),
          P("PROHIBIDO 2: No poner numeros extranos en el mapeo. No agregar valores de prueba, placeholders, indices ni numeros arbitrarios en custom fields, variables, condiciones o payloads. Los valores deben venir del campo real o de una regla documentada.", "RuleBad"),
          P("Regla adicional de seguridad: no reprocesar historicos para probar esta correccion. La validacion real se hara con leads nuevos, sin contaminar ni duplicar los anteriores.", "RuleGood"),
          P("6. Plan prioritario y obligatorio para manana", "H1x"),
          P("No se revisara ningun lead, contacto ni conversacion existente. El agente solo inspeccionara como estan configurados los workflows y ejecutara el cambio definitivo de enfoque en TODOS los dealers: Fredericksburg 1, Fredericksburg 2, Stafford y Easterns. Si despues entran leads nuevos, esos si se auditaran. No se reprocesaran leads ni se haran pruebas que contaminen la informacion.", "Callout"),
          P("Cambio definitivo de enfoque: el enfoque anterior basado en qualification_memory parcial y multiples custom fields no esta resolviendo la perdida de informacion. El enfoque hibrido del informe del 8 de septiembre queda adoptado como la prioridad numero uno y como requisito obligatorio: transcript completo como evidencia, JSON tipado como extraccion, Phone gate antes del trigger, campos operativos limitados y dealerADMIN como autoridad final.", "RuleBad"),
          P("Se mantendran las reglas de cada dealer. Se estandariza el contrato de captura y normalizacion, pero no se copiaran ciegamente los disparadores: Stafford conserva su logica WhatsApp; Easterns conserva ubicacion para routing; Fredericksburg conserva sus ramas primaria/fallback y Fredericksburg 2 su telefono dinamico.", "RuleGood"),
          approach_table,
          P("Orden obligatorio de ejecucion: congelar cambios y capturar la configuracion actual por dealer; revisar dependencias dentro de los workflows; definir el contrato JSON con transcript, tipos, null, evidencia, confianza, version y completitud; implementar la regla telefono -> normalizacion -> contact.phone -> trigger; aplicar el cambio en los cuatro dealers; verificar tecnicamente cada workflow y retirar campos solo despues de comprobar sus dependencias. Cuando entren leads nuevos despues del cambio, esos si se auditaran.", "Bodyx"),
          P("La auditoria de leads existentes queda eliminada de esta jornada. La auditoria se hara solamente con leads nuevos que entren despues de implementar el nuevo contrato de captura, el Phone gate y la autoridad de dealerADMIN.", "Bodyx"),
          P("Criterio de cierre para manana", "H2x"),
          P("La correccion se considerara estable cuando los nuevos leads demuestren que la memoria parcial no dispara webhook, que el nombre real se conserva cuando la persona lo proporciona y que el lead completo llega con todos sus campos sin contaminacion.", "Callout"),
          P("Estado al cierre de esta jornada: cambios live guardados y publicados; codigo probado y subido a GitHub; cambio de enfoque hibrido pendiente para manana. No se revisaran leads existentes; si entran leads nuevos despues del cambio, esos si se auditaran.", "Smallx")]

# Detailed activity log and handoff prompt
story += [PageBreak(), P("7. Bitacora detallada de lo realizado", "H1x"),
          P("Esta seccion conserva el contexto operativo para que la auditoria de manana pueda continuar sin repetir diagnosticos ni reprocesar historicos.", "Bodyx"),
          P("Contexto previo observado", "H2x"),
          P("- El sistema dealerADMIN recibe leads desde GHL por webhook y los coloca en la cola del dealer correspondiente.<br/>- En pruebas anteriores se habia confirmado que Stafford funciona de forma diferente porque recibe el telefono nativamente por WhatsApp; por eso se dejo fuera de esta correccion.<br/>- Tambien se habia detectado que el perfil de Messenger puede ser un nombre empresarial, mientras la persona puede decir su nombre real en la conversacion. Esa normalizacion debe conservar el nombre real si se expresa y usar el nombre empresarial solo cuando no hay nombre personal confiable.", "Bodyx"),
          P("Evidencia que disparo la investigacion", "H2x"),
          P("1. Fredericksburg 1 recibio a Juan Andino con un perfil que aparecia como Tatuajes y Perforaciones. El lead habia dicho su nombre y tambien SUV, pero el flujo no siempre estaba capturando todos los datos.<br/>2. El mismo Juan Andino aparecio en Stafford; ese caso se trato como referencia, no como objetivo de cambio.<br/>3. Fredericksburg 2 recibio a Ivan Penante cuando solo habia dejado el numero. No habia completado la cualificacion y, aun asi, el routing entro por la rama de qualification_memory y alcanzo el webhook.<br/>4. El payload live mostro el telefono como +15714223667, pero tambien habia contaminado real_name y qualification_memory con el texto Mí número es 5714223667.<br/>5. En Easterns se observo un caso donde una ubicacion como Abington PA termino en real_name, la memoria llego incompleta y el telefono no quedo reflejado; ese hallazgo se conserva como evidencia del problema, pero no se hara una revision de leads para resolverlo.<br/>6. Easterns se incluyo expresamente en el alcance. El routing de Baltimore entre Rosedale y Laurel se mantiene como regla del dealer.", "Bodyx"),
          P("Cambios live ejecutados", "H2x"),
          P("- Fredericksburg 2: workflow routing 74e1ec68-3918-451c-a6ad-a139baaf217b; recolector 4ea1b7d1-6140-46b5-8f28-861f93035cf1; ubicacion bAuMEQeH48xAtu9tAMFf.<br/>- Fredericksburg 1: workflow routing 39325ce8-b62c-499f-9861-f16e00ac43c7; recolector e1dce4d3-5f39-4253-8c1a-a33cfc6cc9a5; ubicacion MyxWNKacThim798E8KC6.<br/>- Easterns Rosedale: workflow routing 4cb5abe3-6330-4b87-a426-ae6fe00a10e3; recolector 10c4c30e-3ee5-40b0-9dbb-defe7dfd66c4; ubicacion xN2LSSl62okzv9GnOJPU.<br/>- En cada routing se retiro el webhook conectado a la rama de memoria no vacia. No se alteraron las ramas de cualificacion completa ni los tiempos de espera.<br/>- En cada recolector se edito el Custom Code para rechazar frases de telefono y numeros como real_name. Se ejecuto la prueba live con el mismo tipo de mensaje y se verifico nombre vacio, memoria vacia, telefono normalizado y cualificacion incompleta.", "Bodyx"),
          P("Control de publicacion", "H2x"),
          P("Cada guardado termino con el switch Toggle draft publish workflow en valor 1, etiqueta Publish visible y mensaje Saved / Workflow has been saved. Las listas de GHL mostraron Published para los seis workflows modificados. Stafford no se abrio para editar ni se cambio.", "Bodyx"),
          P("Control de codigo", "H2x"),
          P("Se modificaron cuatro archivos intencionales: collector-normalizer.ts, ghl-collector-normalizer.js y sus dos suites unitarias. El commit 33fe3b7 se publico en origin/main. Typecheck paso correctamente y la suite dirigida paso 62 de 62 pruebas.", "Bodyx"),
          P("8. Mega prompt para continuar manana", "H1x"),
          P("Copia el bloque siguiente como instruccion de continuidad en la proxima sesion. Debe usarse con leads nuevos y conservar las reglas de seguridad.", "Bodyx")]

mega_prompt = """CONTINUIDAD DE AUDITORIA dealerADMIN - 10 DE SEPTIEMBRE DE 2026

Objetivo:
Ejecutar manana el cambio definitivo de enfoque en los workflows de TODOS los dealers. No revisar leads, contactos ni conversaciones existentes. Cuando entren leads NUEVOS despues del cambio, esos si se auditaran para confirmar que la informacion viaja correctamente hasta dealerADMIN. No reprocesar historicos y no crear datos de prueba en produccion.

Problema central que justifica el cambio:
El telefono a veces no se guarda aunque la persona lo haya dejado. Ya se probaron las configuraciones disponibles, mapeos, custom fields, condiciones, triggers y ramas posibles, pero no se obtuvo un resultado estable. No repetir el mismo enfoque: implementar la arquitectura hibrida y hacer que la escritura de contact.phone ocurra antes de evaluar el trigger.

Orden obligatorio antes de cualquier otra actividad:
1. Inspeccionar unicamente la configuracion actual de los workflows, sus ramas, mapeos, campos, condiciones, Custom Code, triggers y acciones de cada dealer.
2. No abrir ni revisar leads, contactos o conversaciones como parte de esta implementacion.
3. Aplicar el cambio de enfoque hibrido en los cuatro dealers y verificar que cada regla particular quede preservada.
4. Si despues entran leads nuevos, iniciar entonces la auditoria end-to-end de esos leads; no auditar historicos.

Cambio de enfoque obligatorio para esta jornada:
- El enfoque anterior basado en qualification_memory parcial y muchos custom fields no se considera suficiente y no debe continuar como arquitectura principal.
- Adoptar una arquitectura hibrida: transcript completo como raw evidence append-only; extraccion AI en JSON tipado con schema, null explicito, fuente, evidencia y confianza; Phone gate obligatorio; campos operativos limitados; dealerADMIN como autoridad final para normalizacion, completitud, routing, idempotencia y persistencia.
- Congelar cambios al inicio y capturar la configuracion actual por dealer. No borrar campos ni cambiar triggers sin revisar primero las dependencias dentro de los workflows.
- Definir y documentar el contrato JSON: transcript, campos, tipos, null, evidencia por campo, confianza, version y estado de completitud.
- Implementar y probar el orden obligatorio: numero detectado -> normalizacion -> escritura en contact.phone -> evaluacion del trigger. Si el telefono no valida, conservar evidencia y bloquear el envio automatico.
- Validar tecnicamente cada workflow y su salida configurada, sin usar leads historicos ni crear datos de prueba en produccion. Cuando existan leads nuevos posteriores al cambio, verificar telefono, nombre, vehiculo, down, trade-in, identificacion, comprobante, timeline, ciudad/estado/ZIP, memory y transcript.
- Validar el recorrido completo en dealerADMIN con los leads nuevos que entren despues del cambio: payload completo, normalizacion, routing, idempotencia, processed en Neon y una sola fila correcta.
- Retirar campos solo despues de comprobar que no son necesarios para Phone, condiciones, routing, reportes o trazabilidad.
- Mantener las reglas particulares de cada dealer: Stafford sigue siendo WhatsApp; Easterns necesita ubicacion para routing; Fredericksburg conserva ramas primaria/fallback; Fredericksburg 2 conserva su telefono dinamico. Estandarizar la captura no significa copiar ciegamente los triggers.

Alcance:
- Fredericksburg 1: ubicacion MyxWNKacThim798E8KC6
- Fredericksburg 2: ubicacion bAuMEQeH48xAtu9tAMFf
- Easterns Rosedale: ubicacion xN2LSSl62okzv9GnOJPU
- Stafford se incluye en el cambio de enfoque, pero conserva su logica especifica de WhatsApp y su telefono nativo.

Reglas no negociables:
1. Nunca poner un workflow en Draft. Antes y despues de cualquier guardado confirmar Publish activo y Published en la lista.
2. Nunca poner numeros extranos, indices, placeholders o valores arbitrarios en mapeos, custom fields, condiciones o payloads.
3. No contaminar real_name ni qualification_memory con respuestas, numeros, marcadores 0 o texto de telefono.
4. No revisar ni reprocesar leads viejos. Auditar unicamente leads nuevos que entren despues del cambio.
5. No cambiar reglas de tiempo, routing ni asignacion si la prueba no demuestra un fallo concreto.

Secuencia por cada lead nuevo:
1. Identificar dealer y workflow exacto antes de abrir cualquier canvas.
2. Leer la conversacion completa y anotar que dijo realmente la persona: nombre, tipo de vehiculo, enganche, tiempo de compra, identificacion, ingresos, cuenta bancaria y ubicacion.
3. Revisar en el recolector los valores de message, qualification_memory, real_name, phone, vehicle_type, down_payment, purchase_timeline, identification, proof_of_income y bank_account.
4. Confirmar si el telefono llego por contact.phone o por el mensaje. En Stafford usar la fuente WhatsApp nativa y no aplicar la normalizacion de Messenger.
5. Revisar el routing: memoria parcial o telefono solo nunca deben disparar webhook inmediato. Solo la rama de cualificacion completa puede enviar inmediatamente.
6. Si falta cualificacion, confirmar que entra a la espera horaria que corresponda y que no llega a dealerADMIN antes de tiempo.
7. Revisar webhook, Neon y dealerADMIN: evento recibido, lead persistido una sola vez, dealer correcto y sin duplicado.
8. Si aparece un error al inspeccionar o configurar un workflow, documentar la evidencia, corregir el mismo problema en los otros workflows de todos los dealers y volver a verificar Publish. En Stafford respetar siempre la logica WhatsApp y sus reglas particulares.

Casos prioritarios:
- Lead que diga solamente su telefono: real_name y qualification_memory deben quedar vacios; phone debe normalizarse; qualification_complete debe ser false.
- Lead que diga su nombre personal aunque su perfil sea empresarial: usar el nombre personal expresado; si no lo expresa, conservar el nombre empresarial.
- Lead que diga SUV, sedan o troca: vehicle_type debe capturarse sin inventar los demas campos.
- Lead completo: debe pasar por la rama de cualificacion completa y llegar una sola vez.
- Easterns con Baltimore: registrar si la asignacion termina en Rosedale o Laurel y explicar por que.

Matriz minima de aceptacion:
- Telefono en mensaje: debe normalizarse y quedar en contact.phone antes del trigger; si Phone queda vacio, bloquear.
- Respuesta Si a identificacion/documentos: debe enlazarse con la pregunta activa y guardarse con evidencia.
- Numero 20: no convertirlo en down payment sin etiqueta down payment, enganche o inicial.
- Informacion parcial: conservar raw y marcar faltantes; nunca forzar lead completo ni inventar valores.
- Texto repetido o concatenado: cada mensaje una sola vez y vehiculo separado de trade-in/down; no promover tokens como 20EI.
- Lead repetido: merge e idempotencia sin duplicar ni borrar un estado enviado.

Entrega al finalizar:
- Resumen por dealer.
- Evidencia de conversacion, campos, routing, webhook y dealerADMIN.
- Cualquier correccion live y su verificacion Published.
- Tests ejecutados y resultado.
- Actualizar el PDF de auditoria solo despues de terminar las verificaciones y revisar visualmente sus paginas.
"""
story.append(Paragraph(escape(mega_prompt).replace("\n", "<br/>"), styles["Prompt"]))

doc.build(story)
print(OUT)
