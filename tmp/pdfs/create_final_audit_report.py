from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
)


OUT = Path("C:/dev/dealeradmin/output/pdf/auditoria-final-workflows-2026-09-07.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleAudit", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=19, leading=23, textColor=colors.HexColor("#12324A"),
    alignment=TA_CENTER, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="SubTitleAudit", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.5, leading=13, textColor=colors.HexColor("#49616F"),
    alignment=TA_CENTER, spaceAfter=16,
))
styles.add(ParagraphStyle(
    name="H1Audit", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=13, leading=16, textColor=colors.HexColor("#0D6873"),
    spaceBefore=12, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="H2Audit", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=10.5, leading=13, textColor=colors.HexColor("#12324A"),
    spaceBefore=7, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="BodyAudit", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=12.5, textColor=colors.HexColor("#24343D"),
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SmallAudit", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.5, leading=10, textColor=colors.HexColor("#43545C"),
    spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="HeaderAudit", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.5, leading=10, textColor=colors.white, spaceAfter=0,
))
styles.add(ParagraphStyle(
    name="PromptAudit", parent=styles["BodyText"], fontName="Courier",
    fontSize=7.1, leading=9.2, textColor=colors.HexColor("#1E2930"),
    leftIndent=7, rightIndent=7, spaceAfter=0,
))


def P(text, style="BodyAudit"):
    return Paragraph(text, styles[style])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D5E0E4"))
    canvas.line(0.55 * inch, 0.48 * inch, 7.95 * inch, 0.48 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#60737C"))
    canvas.drawString(0.55 * inch, 0.30 * inch, "dealerADMIN - auditoria final de workflows")
    canvas.drawRightString(7.95 * inch, 0.30 * inch, f"Pagina {doc.page}")
    canvas.restoreState()


story = []
story.append(P("Auditoria final de workflows recolectores y disparadores", "TitleAudit"))
story.append(P("Cierre operativo - 7 de septiembre de 2026 - evidencia separada entre confirmado, publicado y pendiente", "SubTitleAudit"))

summary_data = [
    [P("Resultado", "SmallAudit"), P("Se encontro una falla real de produccion en el reenvio de eventos GHL cuyo lead habia sido borrado. La correccion fue implementada, probada y publicada en GitHub/main.", "SmallAudit")],
    [P("Estado live", "SmallAudit"), P("La evidencia confirma ejecuciones GHL y salud HTTP de Vercel. El barrido final conversacion por conversacion de los cinco dealers no pudo cerrarse porque el panel GHL quedo cargando y el conector no devolvio el workflow a tiempo.", "SmallAudit")],
    [P("Regla de reporte", "SmallAudit"), P("No se marcan como auditados los dealers o leads que no tienen evidencia live en esta sesion. El pendiente queda explicitamente separado para no confundir una prueba local con una prueba E2E real.", "SmallAudit")],
]
summary = Table(summary_data, colWidths=[1.15 * inch, 6.2 * inch])
summary.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F7F8")),
    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#8AB8BD")),
    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#C9DDE0")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(summary)

story.append(P("1. Problemas encontrados", "H1Audit"))
story.append(P("1) Dedupe permanente despues de borrar un lead contaminado. Un evento GHL podia quedar en webhook_events con estado processed. Si el lead contaminado se borraba manualmente, el siguiente envio del mismo event_id se trataba como duplicado y no reconstruia el lead en DealerADMIN. Esto explica el caso de Stafford donde GHL marco el webhook como Executed pero Neon no mostro un lead vivo.", "BodyAudit"))
story.append(P("2) Contaminacion de identidad telefonica. En los datos historicos auditados habia filas Stafford con numeros que no correspondian a la conversacion. El numero valido en Stafford debe salir del contacto/conversacion de WhatsApp, no de un numero alterno inferido o arrastrado desde otro campo.", "BodyAudit"))
story.append(P("3) Riesgo de ruteo Easterns. Leads que llegaron a Laurel podian representar una zona de Rosedale o Sterling. La solucion de codigo publicada hace que el origen GHL y las reglas de zona tengan prioridad para asignar el dealer correcto, manteniendo las zonas compartidas y la rotacion entre Rosedale, Laurel y Sterling.", "BodyAudit"))
story.append(P("4) Divergencia operativa del tiempo de espera. La etiqueta del nodo aun dice Esperar 3 horas sin nueva informacion, pero la ejecucion observada de un lead nuevo avanzo en aproximadamente 30 minutos. Esto es una discrepancia de configuracion/rotulo que debe corregirse para que el panel no induzca a error.", "BodyAudit"))
story.append(P("5) Cobertura live incompleta al cierre. GHL cargo la agencia, pero la pagina del workflow disparador no devolvio el arbol de accesibilidad dentro del tiempo disponible. Por eso no se afirma que cada lead de Fredericksburg, Stafford, Rosedale, Laurel y Sterling haya sido revisado hoy conversacion por conversacion.", "BodyAudit"))

story.append(P("2. Como se soluciono", "H1Audit"))
story.append(P("Se actualizo webhook.service.ts. Cuando llega un event_id ya marcado como processed, el backend ahora comprueba si todavia existe un lead con el mismo ghl_contact_id y ghl_location_id. Si existe, conserva el bloqueo normal de duplicados. Si el lead ya no existe, el evento vuelve a pending y se procesa de nuevo para reconstruir el lead y su asignacion.", "BodyAudit"))
story.append(P("La correccion se cubrio con una prueba unitaria especifica para el caso: evento processed, lead borrado y reenvio posterior. Tambien se conservaron las pruebas de evento fallido reintentable y de deduplicacion normal.", "BodyAudit"))
story.append(P("El cambio publicado es el commit eb441a6: fix: replay processed webhook after lead deletion. Se verifico diff --check, pasaron 6 pruebas unitarias objetivo, pnpm run typecheck y el build del API. El push a origin/main termino correctamente.", "BodyAudit"))

story.append(P("3. Evidencia de produccion observada", "H1Audit"))
evidence_data = [
    [P("Fuente", "HeaderAudit"), P("Evidencia", "HeaderAudit"), P("Interpretacion", "HeaderAudit")],
    [P("GHL - Stafford", "SmallAudit"), P("Para Nelson Silva, el workflow mostro Webhook Executed, Marcar como enviado Executed, Remove Tag Executed y End Of Workflow finalizado.", "SmallAudit"), P("GHL si estaba ejecutando el webhook y las ramas de salida; el problema no era solamente que el workflow estuviera detenido.", "SmallAudit")],
    [P("Neon - Stafford", "SmallAudit"), P("Despues de esa ejecucion, la consulta del contacto no devolvio lead vivo mientras el evento antiguo seguia processed.", "SmallAudit"), P("Confirmo la causa de dedupe permanente despues de borrar el registro contaminado.", "SmallAudit")],
    [P("Neon - limpieza", "SmallAudit"), P("Se eliminaron seis filas Stafford identificadas como contaminadas; la verificacion posterior dejo 0 leads y 0 asignaciones para esos IDs. No se encontraron coincidencias equivalentes en Laurel, Rosedale, Sterling, Fredericksburg 1 y Fredericksburg 2 durante la auditoria previa.", "SmallAudit"), P("La limpieza historica quedo aplicada; aun falta volver a comprobar entradas nuevas en live.", "SmallAudit")],
    [P("Vercel", "SmallAudit"), P("La raiz publica respondio HTTP 200 con cabeceras de Vercel y /api/leads respondio 401, consistente con un endpoint protegido.", "SmallAudit"), P("La aplicacion esta accesible y la proteccion funciona. Esto no reemplaza la confirmacion de un webhook real en los logs actuales.", "SmallAudit")],
    [P("GHL lead nuevo", "SmallAudit"), P("Se observo un lead nuevo en espera con siguiente ejecucion a 30 minutos; otro lead aparecio finalizado.", "SmallAudit"), P("La ejecucion real observada no coincide con el texto de 3 horas del nodo; se debe renombrar o confirmar la configuracion.", "SmallAudit")],
]
evidence = Table(evidence_data, colWidths=[1.15 * inch, 3.1 * inch, 3.1 * inch], repeatRows=1)
evidence.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0D6873")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9DB5BB")),
    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0DDE0")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(evidence)

story.append(P("4. Estado por dealer al cierre", "H1Audit"))
dealer_data = [
    [P("Dealer", "HeaderAudit"), P("Estado confirmado", "HeaderAudit"), P("Pendiente", "HeaderAudit")],
    [P("Offlease Stafford", "SmallAudit"), P("Workflow GHL ejecutado en al menos un caso; contaminacion historica limpiada; correccion de replay publicada.", "SmallAudit"), P("Barrido final de todos los leads nuevos y confirmacion de cada fila DealerADMIN/Neon.", "SmallAudit")],
    [P("Offlease Fredericksburg 1", "SmallAudit"), P("Incluido en la limpieza/auditoria previa sin coincidencias contaminadas equivalentes.", "SmallAudit"), P("Confirmar en GHL los nuevos inscritos, su rama y recepcion live.", "SmallAudit")],
    [P("Offlease Fredericksburg 2", "SmallAudit"), P("Incluido en la limpieza/auditoria previa sin coincidencias contaminadas equivalentes.", "SmallAudit"), P("Confirmar en GHL los nuevos inscritos, su rama y recepcion live.", "SmallAudit")],
    [P("Easterns Laurel", "SmallAudit"), P("Se observaron 2 leads en DealerADMIN, Diego Martinez y Misael Portillo Guevara; ambos figuraban como llegados a DealerADMIN.", "SmallAudit"), P("Confirmar que no haya leads de zona Rosedale/Sterling mal ubicados y revisar entradas posteriores.", "SmallAudit")],
    [P("Easterns Rosedale", "SmallAudit"), P("La limpieza previa no encontro coincidencias contaminadas equivalentes.", "SmallAudit"), P("El usuario reporto que la lista del fin de semana no aparecia; requiere verificacion live uno por uno.", "SmallAudit")],
    [P("Easterns Sterling", "SmallAudit"), P("La lista manual del fin de semana estaba en 0; la regla de zonas Sterling/Washington y sur de Maryland esta contemplada en el cambio de ruteo.", "SmallAudit"), P("Confirmar leads nuevos y rotacion con Laurel/Rosedale en GHL, Neon y DealerADMIN.", "SmallAudit")],
]
dealer = Table(dealer_data, colWidths=[1.35 * inch, 3.25 * inch, 2.75 * inch], repeatRows=1)
dealer.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0D6873")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9DB5BB")),
    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0DDE0")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(dealer)

story.append(P("5. Que queda para manana", "H1Audit"))
story.append(P("El pendiente no es una hipotesis tecnica: es evidencia live que no se pudo capturar porque GHL quedo cargando. La primera tarea debe ser repetir, sin cambiar reglas, el barrido por cada location y cada lead nuevo: conversacion, real_name, username, numero visible de la conversacion, qualification memory, vehiculo, rama, allow re-entry, estado del workflow, evento Neon, fila lead_dealers y resultado en DealerADMIN.", "BodyAudit"))
story.append(P("Si aparece una discrepancia, primero se conserva la evidencia y luego se corrige. Nunca se debe sustituir el numero real de la conversacion por un numero inferido. En Stafford el criterio minimo sigue siendo numero de WhatsApp y vehiculo; el nombre debe ser real_name cuando exista, y solo como ultima opcion el nombre de usuario.", "BodyAudit"))

story.append(P("6. Entrada de nuevos leads y pruebas de cierre", "H1Audit"))
story.append(P("Esta seccion deja explicito que la entrada de nuevos leads no se considera automaticamente resuelta solo porque el workflow de GHL muestre Executed. La prueba completa exige comprobar la cadena GHL -> webhook -> Neon -> lead_dealers -> DealerADMIN y comparar identidad, vehiculo y qualification memory con la conversacion.", "BodyAudit"))
new_lead_tests = [
    [P("Prueba", "HeaderAudit"), P("Que se comprobo", "HeaderAudit"), P("Resultado al cierre", "HeaderAudit")],
    [P("Recolector - lead nuevo", "SmallAudit"), P("Entrada del contacto, qualification memory con vehiculo, nombre real, telefono de conversacion y allow re-entry.", "SmallAudit"), P("Parcialmente observado: hubo leads nuevos en espera/finalizados, pero no se cerro el inventario de cada dealer.", "SmallAudit")],
    [P("Disparador - webhook", "SmallAudit"), P("Webhook Executed y Marcar como enviado Executed en Stafford para Nelson Silva.", "SmallAudit"), P("Confirmado en ese caso. Falta repetirlo para cada lead nuevo de las seis locations.", "SmallAudit")],
    [P("Persistencia Neon", "SmallAudit"), P("Existencia del lead, telefono canonico, ghl_contact_id, ghl_location_id, webhook_events y lead_dealers.", "SmallAudit"), P("Confirmado el fallo historico processed sin lead vivo y aplicada la correccion. La verificacion masiva live queda pendiente.", "SmallAudit")],
    [P("DealerADMIN", "SmallAudit"), P("Recepcion, dealer asignado, nombre, telefono, vehiculo, qualification y estado de envio.", "SmallAudit"), P("Laurel mostro 2 leads llegados. La lista completa de nuevos leads por dealer requiere una nueva sesion estable.", "SmallAudit")],
    [P("Ruteo", "SmallAudit"), P("Zona, origen GHL, rotacion entre Rosedale/Laurel/Sterling y zonas compartidas.", "SmallAudit"), P("Correccion de codigo publicada; falta confirmacion live de cada caso nuevo y de leads que entraron a Laurel por otra zona.", "SmallAudit")],
    [P("Pruebas de codigo", "SmallAudit"), P("Dedupe normal, retryable failed, processed con lead vivo, processed sin lead vivo, typecheck, build y diff check.", "SmallAudit"), P("Pasaron 6 pruebas unitarias objetivo, typecheck, build y diff check. Esto valida codigo, no reemplaza E2E de todos los dealers.", "SmallAudit")],
]
new_tests = Table(new_lead_tests, colWidths=[1.45 * inch, 3.05 * inch, 2.85 * inch], repeatRows=1)
new_tests.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0D6873")),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9DB5BB")),
    ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D0DDE0")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(new_tests)
story.append(P("Criterio de aceptacion para declarar el problema cerrado: cada lead nuevo debe tener un telefono igual al de la conversacion, nombre real_name o fallback permitido, vehiculo en qualification memory, rama correcta, allow re-entry, webhook confirmado, fila Neon consistente y fila DealerADMIN en el dealer correcto. Si falla cualquiera, se conserva el error, se corrige y se repite la prueba.", "BodyAudit"))

story.append(PageBreak())
story.append(P("7. Mega prompt para continuar la solucion", "H1Audit"))
prompt = """Actua como ingeniero de operaciones y auditor de integraciones para dealerADMIN. Continua la auditoria final de workflows GHL recolectores y disparadores para Offlease Fredericksburg 1, Offlease Fredericksburg 2, Offlease Stafford, Easterns Rosedale, Easterns Laurel y Easterns Sterling. Usa evidencia live de GHL, Neon, DealerADMIN y Vercel. No inventes resultados y separa siempre: observado en GHL, recibido en webhook, procesado en Neon, asignado en lead_dealers, visible en DealerADMIN y publicado en codigo.

Orden de prioridad de aceptacion. Todos los criterios son obligatorios; la prioridad solo indica el orden de bloqueo y verificacion. P0 es el requisito mas importante y ningun criterio de prioridad menor se puede omitir aunque P0 ya haya pasado.

P0 - Identidad y seguridad de datos: cada lead debe conservar exactamente el numero visible en la conversacion/contacto GHL correcto, sin numeros inferidos, cruzados o de otro dealer. El nombre debe ser real_name, luego nombre mencionado en la conversacion y solo al final username. En Stafford exige numero de WhatsApp y vehiculo. Si hay contaminacion, no avances el lead como valido: conserva evidencia, corrige y repite.

P1 - Entrega y persistencia: cada lead nuevo debe recorrer GHL -> webhook -> Neon -> lead_dealers -> DealerADMIN. Debe existir evidencia del event_id, HTTP, estado webhook_events, lead, asignacion y fila visible. Un workflow Executed sin fila Neon y DealerADMIN no cuenta como exito.

P2 - Ruteo y re-entry: la zona y el origen GHL deben llevar el lead al dealer correcto, conservando zonas propias y compartidas de Rosedale, Laurel y Sterling, Washington y sur de Maryland. Todos los workflows deben tener allow re-entry. Verifica rotacion y evita duplicados solo cuando exista el lead vivo correcto.

P3 - Recolector y qualification memory: antes de disparar, el recolector debe conservar como minimo vehiculo, nombre utilizable y telefono valido; compara tambien down payment, trade-in, documentos y tiempo de compra contra la conversacion. Si falta vehiculo, no debe tratarse como lead cualificado.

P4 - Fidelidad de DealerADMIN: nombre, telefono, vehiculo, qualification, dealer, estado y fecha deben coincidir con GHL y Neon. Un lead de zona Rosedale o Sterling no puede quedarse en Laurel solo porque entro por ese workflow.

P5 - Observabilidad y cierre: logs de GHL, Neon y Vercel deben relacionarse con leads concretos; documenta error, causa y solucion. Genera tabla final por dealer y por lead, y PDF renderizado y visualmente verificado. Si una pantalla carga o una fuente no esta disponible, marca el punto como no verificado.

Despues de cada correccion, observa leads nuevos que entren durante la ventana de prueba disponible. No cierres solo por pruebas locales: espera y revisa los eventos reales que aparezcan, o documenta con precision que no hubo un lead nuevo disponible. No falsifiques webhooks, conversaciones ni resultados.

1. En cada location revisa todos los leads nuevos desde el fin de semana hasta ahora, conversacion por conversacion. Para cada uno registra contacto, fecha, rama del workflow, estado actual, current action, siguiente ejecucion, allow re-entry, webhook executed/failed, event_id, error, y si existe en Neon y DealerADMIN.

2. Valida la identidad. El telefono canonico debe ser el numero que aparece en la conversacion de WhatsApp o en el contacto GHL correcto. No uses numeros inferidos, numeros de otro contacto, valores de qualification memory que no coincidan con la conversacion ni valores copiados de otro dealer. En Stafford exige numero real de WhatsApp y al menos vehiculo. El nombre de salida debe ser real_name; si no existe, usa el nombre mencionado en la conversacion; solo como ultima opcion usa el nombre de usuario.

3. Valida qualification memory. Debe conservar al menos el tipo de vehiculo antes de disparar. Compara down payment, trade-in, documentos, tiempo de compra, vehiculo y nombre contra la conversacion. Reporta cada discordancia antes de corregirla.

4. Valida routing. Mantiene las zonas ya definidas: Rosedale, Rosedale compartida con Laurel, Sterling, Sterling compartida con Laurel, Washington y sur de Maryland. El origen GHL y el ZIP/zona deben determinar el dealer. Ningun lead de zona Rosedale o Sterling debe quedar en Laurel solo porque entro por ese workflow. Conserva la rotacion entre los tres dealers sin perder la zona.

5. Valida re-entry y dedupe. Todos los workflows deben tener allow re-entry segun la regla operativa. Un event_id repetido debe ignorarse solo si el lead vivo correspondiente existe. Si el evento aparece processed pero el lead fue borrado, reparado o ya no existe con el mismo ghl_contact_id y ghl_location_id, debe volver a procesarse de forma segura. No generes duplicados si el lead vivo existe.

6. Reprocesa primero por webhook los leads historicos de la lista manual del fin de semana. Hazlo uno por uno o por lotes pequenos, confirma HTTP y luego confirma Neon y DealerADMIN. Si un webhook no puede reconstruir el lead, deten la automatizacion para ese caso y prepara insercion manual solo despues de conservar el error y confirmar que no hay otra forma segura.

7. Audita datos contaminados. Busca telefonos que difieren de la conversacion, nombres cruzados, dealer equivocado, vehiculo faltante, datos de otro contacto y eventos processed sin lead vivo. No borres nada sin identificar exactamente los IDs afectados y sin dejar evidencia. Si la autorizacion de borrado ya esta vigente para los contaminados confirmados, elimina solo esas filas y vuelve a disparar el webhook original.

8. Revisa logs Vercel y Neon. Busca 401/403, timeouts, 5xx, errores de longitud de columnas, fallas de parsing, firma, payload oversized, event_id duplicado, location no mapeada y errores de transaccion. Relaciona cada error con un lead concreto. Verifica que el deploy que contiene eb441a6 este activo antes de concluir.

9. Prueba antes de publicar codigo: pruebas unitarias de dedupe normal, evento failed retryable, evento processed con lead vivo, evento processed sin lead vivo y routing para las tres sedes Easterns. Ejecuta typecheck, build, diff check y pruebas E2E disponibles. Publica a GitHub solo los archivos intencionalmente cambiados y confirma commit, branch y resultado del push.

10. Entrega un informe final con tabla por dealer y por lead: numero correcto, nombre correcto, vehiculo, qualification memory, rama, allow re-entry, estado GHL, event_id, estado Neon, fila DealerADMIN, problema, solucion y evidencia. Si algo no pudo verificarse por una pantalla cargando o falta de acceso, dilo claramente y no lo marques como auditado. Genera un PDF renderizado y verificado visualmente con problemas encontrados, causa raiz, cambios, pruebas, estado de produccion y pendientes."""
for block in prompt.split("\n\n"):
    story.append(KeepTogether([P(block.replace("&", "&amp;"), "PromptAudit"), Spacer(1, 5)]))

story.append(Spacer(1, 10))
story.append(P("Conclusiones de cierre", "H1Audit"))
story.append(P("La falla principal conocida ya tiene una correccion de codigo publicada y probada. La produccion respondio correctamente a nivel HTTP y GHL mostro ejecuciones reales. El punto que no debe darse por cerrado sin una nueva sesion estable es el inventario completo de leads nuevos en los cinco dealers y la confirmacion final de cada ruta en DealerADMIN. Este PDF deja ese limite explicito para evitar una falsa sensacion de funcionamiento perfecto.", "BodyAudit"))

doc = SimpleDocTemplate(
    str(OUT), pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch,
    topMargin=0.55 * inch, bottomMargin=0.62 * inch,
    title="Auditoria final de workflows dealerADMIN - 2026-09-07",
    author="Codex",
)
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
