from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.pdfbase.pdfmetrics import stringWidth

OUT = r"C:\dev\dealeradmin\output\pdf\dealeradmin-cierre-y-siguiente-workflow-2026-08-29.pdf"
NAVY = colors.HexColor("#10252B")
INK = colors.HexColor("#172B30")
MUTED = colors.HexColor("#60777A")
TEAL = colors.HexColor("#078B83")
MINT = colors.HexColor("#DDF3EE")
PALE = colors.HexColor("#F3F8F7")
LINE = colors.HexColor("#D5E2E0")

base = getSampleStyleSheet()
base.add(ParagraphStyle(name="Kicker", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=TEAL, spaceAfter=9))
base.add(ParagraphStyle(name="TitleX", parent=base["Title"], fontName="Helvetica-Bold", fontSize=27, leading=31, textColor=NAVY, spaceAfter=10))
base.add(ParagraphStyle(name="Sub", parent=base["Normal"], fontName="Helvetica", fontSize=11, leading=16, textColor=MUTED, spaceAfter=14))
base.add(ParagraphStyle(name="H1X", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=NAVY, spaceBefore=4, spaceAfter=9))
base.add(ParagraphStyle(name="H2X", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=TEAL, spaceBefore=8, spaceAfter=5))
base.add(ParagraphStyle(name="BodyX", parent=base["BodyText"], fontName="Helvetica", fontSize=9.3, leading=13.5, textColor=INK, spaceAfter=6))
base.add(ParagraphStyle(name="SmallX", parent=base["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10.5, textColor=MUTED, spaceAfter=4))
base.add(ParagraphStyle(name="Cell", parent=base["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10, textColor=INK))
base.add(ParagraphStyle(name="CellWhite", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.8, leading=10, textColor=colors.white))
base.add(ParagraphStyle(name="Num", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=11, leading=13, textColor=TEAL, alignment=TA_CENTER))
base.add(ParagraphStyle(name="Callout", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=NAVY))

def P(value, style="BodyX"):
    return Paragraph(value, base[style])

def hf(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18*mm, h-16*mm, w-18*mm, h-16*mm)
    canvas.setFillColor(TEAL)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(18*mm, h-12*mm, "dealerADMIN")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(w-18*mm, h-12*mm, "Cierre tecnico y siguiente workflow | 29 ago 2026")
    canvas.line(18*mm, 14*mm, w-18*mm, 14*mm)
    canvas.drawString(18*mm, 9*mm, "Documento interno | uso personal")
    canvas.drawRightString(w-18*mm, 9*mm, "Pagina " + str(doc.page))
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=22*mm, bottomMargin=20*mm, title="dealerADMIN - Cierre tecnico")
doc.addPageTemplates([PageTemplate(id="main", frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="frame")], onPage=hf)])
story = []

story += [Spacer(1, 18*mm), P("INFORME DE CIERRE TECNICO", "Kicker"), P("dealerADMIN: pruebas de webhook y workflow recolector", "TitleX"), P("Estado de la integracion GHL -> dealerADMIN -> Neon y guia de implementacion del workflow que recolectara, guardara y despachara la informacion de cada conversacion.", "Sub")]
summary = Table([[P("<b>Confirmado</b><br/>Easterns: GHL ejecutado, lead visible en dealerADMIN y evento procesado en Neon.", "Cell"), P("<b>En observacion</b><br/>Fredericksburg 2: contacto con telefono esperando la ventana de 3 horas por informacion incompleta.", "Cell")]], colWidths=[doc.width/2-3*mm, doc.width/2-3*mm])
summary.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),MINT),("BACKGROUND",(1,0),(1,0),PALE),("BOX",(0,0),(-1,-1),0.5,LINE),("INNERGRID",(0,0),(-1,-1),0.5,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
story += [summary, Spacer(1, 7*mm), P("Alcance de esta entrega", "H2X"), P("Se corrigio el receptor para aceptar el formato nativo del Webhook outbound de HighLevel: datos estandar del contacto en la raiz y datos adicionales en <b>customData</b>. Hoy no se creo ni se activo un workflow separado de captura; ese es el siguiente paso controlado.", "BodyX"), P("La evidencia de transporte se separa de la futura evidencia de captura. Un campo que aparece como no indicado significa que GHL no lo envio en ese contacto de prueba.", "BodyX"), PageBreak()]

story += [P("1. Cambios realizados", "H1X")]
rows = [
 [P("Elemento","CellWhite"), P("Resultado","CellWhite")],
 [P("Backend","Cell"), P("Adaptador para normalizar payloads nativos de GHL al contrato estable de dealerADMIN.","Cell")],
 [P("Pruebas","Cell"), P("3 pruebas focalizadas pasan: adaptacion nativa, contrato interno y proteccion de reprocesamiento.","Cell")],
 [P("Build","Cell"), P("Build del monorepo completado para config, contracts, API y web.","Cell")],
 [P("Git / Vercel","Cell"), P("Commit <b>ba0394d</b> publicado en <b>main</b> y version de produccion recompilada.","Cell")],
 [P("Workflows","Cell"), P("Revisados Easterns Automotive Group, Fredericksburg 1, Fredericksburg 2 y Stafford. Se corrigio el estado obsoleto <b>is empty</b> por <b>is not sent</b>.","Cell")],
]
tab = Table(rows, colWidths=[42*mm, doc.width-42*mm], repeatRows=1)
tab.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
story += [tab, Spacer(1,4*mm), P("Advertencia operativa: GHL puede continuar al paso Set status sent aunque Webhook falle. Por eso Neon y la respuesta del receptor son la fuente de verdad; un cambio visual de estado no es prueba suficiente de entrega.", "SmallX")]

story += [P("2. Evidencia de produccion", "H1X"), P("Prueba confirmada - Easterns Automotive Group", "H2X")]
rows = [
 [P("Capa","CellWhite"), P("Evidencia","CellWhite"), P("Estado","CellWhite")],
 [P("GHL","Cell"), P("QA DealerADMIN Native: Webhook - Executed en el log del workflow.","Cell"), P("OK","Cell")],
 [P("dealerADMIN","Cell"), P("Cola con 1 lead pendiente: QA DealerADMIN Native, telefono +13015550200, Easterns Laurel.","Cell"), P("OK","Cell")],
 [P("Neon","Cell"), P("Consulta en production/neondb: fila de lead con status pending y webhook_event con status processed.","Cell"), P("OK","Cell")],
 [P("Routing","Cell"), P("La prueba sin zona explicita quedo en Easterns Laurel, consistente con el fallback vigente.","Cell"), P("OK","Cell")],
]
tab = Table(rows, colWidths=[26*mm, doc.width-66*mm, 40*mm], repeatRows=1)
tab.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),7),("RIGHTPADDING",(0,0),(-1,-1),7),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
story += [tab, Spacer(1,4*mm), P("Incidente corregido", "H2X"), P("La primera prueba fue rechazada con <b>INVALID_LEAD_PAYLOAD</b> porque el Webhook nativo no enviaba los ocho campos del contrato interno como propiedades de primer nivel. El adaptador ahora obtiene id, locationId, location, nombre, telefono y customData de GHL y construye el contrato esperado.", "BodyX"), P("Rama de espera confirmada - Fredericksburg 2", "H2X"), P("Un contacto operativo con telefono fue inscrito y el log mostro <b>Esperar 3 horas sin nueva informacion - waiting</b>. Esto confirma la rama parcial con telefono. No se cuenta como entrega final hasta que el Webhook sea ejecutado y el lead aparezca tambien en dealerADMIN y Neon.", "BodyX"), PageBreak()]

story += [P("3. Workflow recolector propuesto", "H1X"), P("Objetivo", "H2X"), P("Separar captura y despacho. El recolector escucha cada avance, identifica los datos, actualiza los custom fields y deja una memoria legible. El sender conserva la responsabilidad de enviar una sola vez por dealer.", "BodyX")]
steps = [
 ("01","Disparadores","Contact Changed y Contact Tag cuando corresponda. Reinscripcion controlada ante nuevos mensajes."),
 ("02","Leer contexto","Tomar mensaje nuevo, qualification_memory y campos existentes. Nunca reemplazar un valor valido por un vacio."),
 ("03","Extraer","Reglas deterministicas para telefono, dinero, ID, documentos, plazo, vehiculo y zona. AI Extract Data solo ante ambiguedad."),
 ("04","Actualizar","Guardar cada valor en su custom field y conservar el idioma original."),
 ("05","Memoria","Recomponer qualification_memory separado por comas, sin duplicados y con etiquetas."),
 ("06","Completitud","Telefono + informacion minima completa activa dealeradmin_send_now=true. Parcial queda pendiente; sin telefono no se despacha."),
 ("07","Despacho","Completo: Webhook inmediato. Parcial con telefono: Wait de 3 horas desde el ultimo avance relevante."),
 ("08","Confirmacion","Solo con respuesta aceptada se conserva el procesamiento; status sent impide reenvios."),
]
for n, title, body in steps:
    box = Table([[P(n,"Num"), P("<b>"+title+"</b><br/>"+body,"Cell")]], colWidths=[16*mm, doc.width-16*mm])
    box.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),MINT),("BOX",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
    story += [box, Spacer(1,2*mm)]
story += [PageBreak()]

story += [P("4. Acciones GHL disponibles en agosto de 2026", "H1X")]
rows = [
 [P("Accion","CellWhite"), P("Uso","CellWhite"), P("Regla","CellWhite")],
 [P("Contact Changed","Cell"), P("Detectar cambios de contacto.","Cell"), P("Evitar loops y escuchar solo campos de captura.","Cell")],
 [P("If/Else","Cell"), P("Separar sin telefono, parcial y completo.","Cell"), P("Telefono no vacio; campos minimos; status distinto de sent.","Cell")],
 [P("AI Extract Data","Cell"), P("Convertir texto no estructurado en datos.","Cell"), P("Entrada: mensaje o memoria. Validar salida antes de escribir.","Cell")],
 [P("Update Contact Field","Cell"), P("Persistir cada dato.","Cell"), P("Escribir solo valores presentes y conservar idioma.","Cell")],
 [P("Custom Code","Cell"), P("Regex, normalizacion y memoria.","Cell"), P("Preferido para reglas deterministicas y confianza; no imprimir secretos.","Cell")],
 [P("Wait","Cell"), P("Esperar cuando hay telefono pero faltan datos.","Cell"), P("Descripcion: Esperar 3 horas sin nueva informacion; revalidar antes de enviar.","Cell")],
 [P("Webhook outbound","Cell"), P("Enviar hacia dealerADMIN.","Cell"), P("POST a /api/webhooks con header secreto; backend acepta standard data + customData.","Cell")],
]
tab = Table(rows, colWidths=[34*mm, 58*mm, doc.width-92*mm], repeatRows=1)
tab.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
story += [tab, Spacer(1,4*mm), P("La documentacion oficial de GHL confirma que el Webhook outbound incluye datos estandar del contacto, custom fields y location. Tambien documenta AI Extract Data para pasar texto a campos estructurados y Custom Code para extender el workflow con JavaScript o Python.", "BodyX"), PageBreak()]

story += [P("5. Custom fields, memoria e idioma", "H1X")]
rows = [
 [P("Campo","CellWhite"), P("Contenido","CellWhite"), P("Ejemplo","CellWhite")],
 [P("vehicle_type","Cell"), P("Texto libre, no limitar a SUV, sedan o truck.","Cell"), P("F-150 XLT 2021","Cell")],
 [P("down_payment","Cell"), P("Monto o texto normalizado.","Cell"), P("$1,500","Cell")],
 [P("identification","Cell"), P("ID, licencia o referencia.","Cell"), P("ID","Cell")],
 [P("bank_account","Cell"), P("Ultimos 4 digitos o vacio indicado.","Cell"), P("1234","Cell")],
 [P("purchase_timeline","Cell"), P("Plazo en idioma original.","Cell"), P("this week / esta semana","Cell")],
 [P("documents","Cell"), P("Documentos o prueba de ingresos.","Cell"), P("proof of income","Cell")],
 [P("easterns_zone","Cell"), P("Zona declarada.","Cell"), P("Baltimore","Cell")],
 [P("easterns_dealer_selected","Cell"), P("Booleano de seleccion explicita.","Cell"), P("true","Cell")],
 [P("qualification_memory","Cell"), P("Cadena con elementos separados por comas.","Cell"), P("vehicle: truck, down payment: $1,500, documents: proof of income, timeline: this week","Cell")],
]
tab = Table(rows, colWidths=[43*mm, 64*mm, doc.width-107*mm], repeatRows=1)
tab.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [tab, Spacer(1,4*mm), P("Ejemplo en ingles: <b>Alexander Freez, 3212343212, truck, $1500 down, ID and proof of income, wants to buy this week</b>. En espanol se conserva el resumen en espanol. El sistema no traduce automaticamente los valores del cliente.", "BodyX"), PageBreak()]

story += [P("6. Easterns y reglas de envio", "H1X"), P("Seleccion explicita", "H2X"), P("Si dice \"quiero mi auto con Easterns Baltimore\", guardar easterns_zone=Baltimore y easterns_dealer_selected=true. El backend dirige a <b>Easterns Rosedale</b>. Laurel va a Laurel y Sterling va a Sterling.", "BodyX"), P("Si solo responde una zona y no nombra dealer, guardar easterns_dealer_selected=false y permitir el round robin de Baltimore. El booleano es el que impide repartir una seleccion explicita.", "BodyX"), P("Criterio de aceptacion por workflow", "H2X"), P("El mismo contacto debe aparecer en: (a) GHL con Webhook Executed, (b) cola de dealerADMIN y (c) Neon con webhook_events procesado y lead persistido. Un 201 o cambio de estado aislado no es suficiente.", "Callout")]
rows = [
 [P("Escenario","CellWhite"), P("Esperado","CellWhite"), P("Evidencia actual","CellWhite")],
 [P("Completo + telefono","Cell"), P("Webhook inmediato, cola y Neon.","Cell"), P("Easterns confirmado.","Cell")],
 [P("Parcial + telefono","Cell"), P("Wait 3 horas y revalidacion.","Cell"), P("Fredericksburg 2 en waiting.","Cell")],
 [P("Sin telefono","Cell"), P("No despachar; revision.","Cell"), P("Pendiente de prueba controlada.","Cell")],
 [P("Baltimore explicito","Cell"), P("Rosedale, sin round robin.","Cell"), P("Regla unitaria confirmada; E2E pendiente.","Cell")],
]
tab = Table(rows, colWidths=[43*mm, 70*mm, doc.width-113*mm], repeatRows=1)
tab.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
story += [Spacer(1,4*mm), tab, PageBreak()]

story += [P("7. Paso a paso de la siguiente implementacion", "H1X")]
todo = [
 ("A","Inventariar custom fields","Confirmar nombre, key, tipo y opciones en cada location. Las cuatro locations deben usar keys canonicas equivalentes."),
 ("B","Crear recolector en Draft","Replicar en Easterns, FRED1, FRED2 y Stafford. No publicar hasta probar cada location."),
 ("C","Agregar extraccion","Reglas primero: telefono, dinero, ID, documentos, plazo, vehiculo y frases Easterns. AI solo si hay ambiguedad, con salida estructurada y confianza."),
 ("D","Actualizar y memorizar","Guardar cada valor presente y recomponer qualification_memory con comas, sin duplicados."),
 ("E","Decidir envio","Completo + telefono activa dealeradmin_send_now. Parcial + telefono espera 3 horas en el sender. Sin telefono queda en revision."),
 ("F","Mantener webhook","POST a https://dealeradmin-api-eight.vercel.app/api/webhooks y header secreto ya configurado. Nunca copiar secretos al PDF o logs."),
 ("G","Publicar progresivo","Publicar una location, probar GHL + dealerADMIN + Neon y luego continuar con la siguiente."),
 ("H","Cerrar pruebas","Por location: completo, parcial, sin telefono, duplicado y, en Easterns, Baltimore, Laurel y Sterling."),
]
for key, title, body in todo:
    box = Table([[P(key,"Num"), P("<b>"+title+"</b><br/>"+body,"Cell")]], colWidths=[14*mm, doc.width-14*mm])
    box.setStyle(TableStyle([("BACKGROUND",(0,0),(0,0),MINT),("BOX",(0,0),(-1,-1),0.4,LINE),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
    story += [box, Spacer(1,2.5*mm)]

story += [Spacer(1,4*mm), P("Fuentes GHL consultadas el 29 de agosto de 2026", "H2X"), P("Workflow Action - Webhook (Outbound): https://help.gohighlevel.com/support/solutions/articles/155000003299-actions-webhook", "SmallX"), P("AI Extract Data Workflow Action: https://help.gohighlevel.com/support/solutions/articles/155000007992-workflow-action-ai-extract-data", "SmallX"), P("Workflow Action - Custom Code: https://help.gohighlevel.com/support/solutions/articles/155000003362-workflow-action-custom-code", "SmallX"), P("Custom Webhook y payload mapping: https://help.gohighlevel.com/support/solutions/articles/155000003305/", "SmallX"), P("Las referencias describen las acciones disponibles; la configuracion final debe verificarse dentro de cada subcuenta antes de publicar.", "SmallX")]
doc.build(story)
print(OUT)

