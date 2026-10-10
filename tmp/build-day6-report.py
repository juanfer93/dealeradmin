from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(r"C:\dev\dealeradmin")
OUT = ROOT / "output" / "pdf" / "informe-dia-6-reportes-exceljs-2026-08-28.pdf"
REPORT_SHOT = ROOT / "output" / "screenshots" / "day6-reports-final.png"
QUEUE_SHOT = ROOT / "output" / "screenshots" / "day6-queue-copy.png"
XLSX_SHOT = ROOT / "output" / "screenshots" / "day6-xlsx-preview.png"

TEAL = colors.HexColor("#0B817A")
INK = colors.HexColor("#17211F")
MUTED = colors.HexColor("#60716D")
LINE = colors.HexColor("#D9E2E0")
PALE = colors.HexColor("#EDF7F5")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Kicker", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=TEAL, spaceAfter=8))
styles.add(ParagraphStyle(name="TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=INK, spaceAfter=12))
styles.add(ParagraphStyle(name="H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceBefore=4, spaceAfter=10))
styles.add(ParagraphStyle(name="H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=INK, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="BodyCustom", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13.5, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="SmallCustom", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED, spaceAfter=3))
styles.add(ParagraphStyle(name="CellCustom", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=INK))
styles.add(ParagraphStyle(name="CaptionCustom", parent=styles["BodyText"], fontName="Helvetica-Oblique", fontSize=7.6, leading=10, textColor=MUTED, spaceBefore=4, spaceAfter=8))


def p(text, style="BodyCustom"):
    return Paragraph(text, styles[style])


def bullet(text):
    return p(f"<font color='{TEAL}'>-</font> {text}")


def table(rows, widths):
    data = [[p(str(value), "CellCustom") for value in row] for row in rows]
    result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7FAF9")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return result


def screenshot(path, width=170):
    image = Image(str(path))
    ratio = image.imageHeight / float(image.imageWidth)
    image.drawWidth = width * mm
    image.drawHeight = width * mm * ratio
    return image


def frame(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.line(18 * mm, height - 14 * mm, width - 18 * mm, height - 14 * mm)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.setFillColor(TEAL)
        canvas.drawString(18 * mm, height - 10.5 * mm, "dealerADMIN")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 18 * mm, height - 10.5 * mm, "Día 6 - reportes XLSX")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 13 * mm, width - 18 * mm, 13 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 8 * mm, "Validación local - 28 de agosto de 2026")
    canvas.drawRightString(width - 18 * mm, 8 * mm, f"Página {doc.page}")
    canvas.restoreState()


OUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=22 * mm, bottomMargin=19 * mm, title="Informe Día 6 - Reportes ExcelJS", author="dealerADMIN")
story = []

story += [Spacer(1, 17 * mm), p("INFORME DE IMPLEMENTACIÓN Y EVIDENCIA", "Kicker"), p("Día 6: reportes XLSX bajo demanda", "TitleCustom")]
story.append(p("Exportación ExcelJS, filtros por dealer y fecha, y operación de copia por dealer en la consola dealerADMIN.", "BodyCustom"))
cover = table([
    ["ESTADO", "Validado localmente"],
    ["ALCANCE", "API + web + pruebas + evidencia visual"],
], [31 * mm, 125 * mm])
cover.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.6, TEAL)]))
story += [cover, Spacer(1, 15 * mm), p("Resumen ejecutivo", "H1Custom"), p("Se implementó el flujo para consultar un rango de leads y generar un XLSX en memoria, sin cron y sin persistir archivos sensibles. El detalle conserva nombre, número, comentarios disponibles y la fecha exacta de llegada a dealerADMIN.")]
story += [bullet("Los comentarios agregan solo información presente; los campos faltantes quedan vacíos."), bullet("Nunca se incluye el valor literal del ID de la persona ni el ID interno de la base de datos."), bullet("Se puede copiar un lead individual, leads seleccionados, todos los leads visibles o todos los leads de un dealer."), bullet("La fecha de llegada usa lead_dealers.created_at.")]
story += [Spacer(1, 5 * mm), p("Resultado de aceptación", "H2Custom"), table([
    ["Criterio", "Resultado"],
    ["Suite unitaria", "9 archivos y 54 pruebas exitosas"],
    ["Build", "Build completo y build web con API local exitosos"],
    ["Rutas", "Preview protegido y exportación autenticada"],
    ["XLSX", "3 hojas; headers operativos; teal #0B817A; sin null ni omitido"],
    ["Push", "Autorizado por el usuario y se realiza después de este informe"],
], [52 * mm, 104 * mm])]

story += [PageBreak(), p("Qué se construyó", "H1Custom"), p("La solución quedó integrada en la arquitectura existente de dealerADMIN, con autenticación por sesión y la misma consola operativa.")]
story += [p("API y exportación", "H2Custom"), bullet("GET /api/reports/preview calcula el tamaño del reporte por dealer y rango."), bullet("GET /api/reports/export genera el XLSX en memoria y devuelve la descarga Office."), bullet("Workbook con Resumen, Detalle y Errores."), bullet("Detalle con Nombre, Número, Comentarios y Fecha de llegada a dealerADMIN."), bullet("Fecha Excel con formato yyyy-mm-dd hh:mm y primera fila congelada.")]
story += [p("Regla de comentarios", "H2Custom"), p("Cuando hay identificación y prueba de ingresos se muestra <b>ID y prueba de ingresos</b>. Cuando hay identificación y cuenta bancaria se muestra <b>ID y cuenta bancaria</b>. No se muestra el valor del documento de identidad ni un ID de base de datos. El ejemplo completo validado es: <b>SUV, $1000 de down, ID y prueba de ingresos, quiere comprar este mes</b>.")]
story += [p("Selección y copia", "H2Custom"), bullet("Casilla individual en cada lead visible."), bullet("Casilla para seleccionar todos los leads visibles."), bullet("Botón Copiar seleccionados, manteniendo Copiar individual, Copiar todo y Copiar por dealer."), bullet("La selección se limpia al cambiar la cola para evitar copiar registros fuera de contexto.")]
story += [p("Archivos principales", "H2Custom"), table([
    ["Archivo", "Responsabilidad"],
    ["apps/api/src/features/reports/application/export-report.service.ts", "ExcelJS y reglas de comentarios"],
    ["apps/api/src/features/reports/presentation/reports.controller.ts", "Preview y export protegido"],
    ["apps/web/src/app/app/reports/page.tsx", "Pantalla de reportes"],
    ["apps/web/src/components/operator/OperatorDashboard.tsx", "Selección y copia de leads"],
    ["apps/api/src/features/reports/tests/unit/xlsx-generation.spec.ts", "Pruebas de XLSX y reglas de identificación"],
], [105 * mm, 51 * mm])]

story += [PageBreak(), p("Pruebas y evidencia técnica", "H1Custom"), p("La verificación se ejecutó sobre el build local final, con API en 127.0.0.1:3010 y web en localhost:3000.")]
story.append(table([
    ["Prueba", "Evidencia observada"],
    ["pnpm test:unit", "Exit code 0. Test Files 9 passed (9); Tests 54 passed (54)."],
    ["Pruebas XLSX", "4 tests passed: workbook, headers, comentarios sin ID literal y cuenta bancaria."],
    ["Preview sin sesión", "401, confirmando protección."],
    ["Login local", "201 con sesión de operador de prueba."],
    ["GET /api/dealers", "200 y 6 dealers visibles."],
    ["Preview autenticado", "200 y count=3 para 2026-08-01 a 2026-08-31."],
    ["Export autenticado", "200, MIME XLSX, 8,782 bytes."],
    ["Copia seleccionada", "1 lead seleccionado, botón Copiar seleccionados visible y clipboard confirmado."],
], [57 * mm, 99 * mm]))
story += [Spacer(1, 8 * mm), p("Inspección del XLSX descargado", "H2Custom"), table([
    ["Control", "Resultado"],
    ["Hojas", "Resumen, Detalle, Errores"],
    ["Headers de Detalle", "Nombre, Número, Comentarios, Fecha de llegada a dealerADMIN"],
    ["Formato", "Encabezado teal 0B817A; primera fila congelada; filtro automático"],
    ["Valores prohibidos", "containsNullLiteral=false; containsOmitido=false"],
    ["Fecha inspeccionada", "2026-08-21T12:00:00.000Z en fila local de prueba"],
], [57 * mm, 99 * mm]), Spacer(1, 6 * mm), p("Nota: el servidor local usa fixtures; por eso algunas filas no tienen campos enriquecidos. La prueba unitaria valida explícitamente SUV, $1000 de down, ID y prueba de ingresos, y también ID y cuenta bancaria.", "SmallCustom")]

story += [PageBreak(), p("Evidencia visual de la consola", "H1Custom"), p("La pantalla de reportes quedó disponible con dealer, rango de fechas, previsualización y descarga manual. La cola incluye selección individual, selección total visible y Copiar seleccionados.")]
story += [screenshot(REPORT_SHOT), p("Captura 1. Pantalla /app/reports en el servidor local.", "CaptionCustom"), Spacer(1, 4 * mm), screenshot(QUEUE_SHOT), p("Captura 2. Cola operativa con selección individual y Copiar seleccionados.", "CaptionCustom")]

story += [p("Evidencia visual del XLSX", "H1Custom"), p("La vista renderizada muestra las tres pestañas, los encabezados operativos, la fecha y el ejemplo de comentarios validado por pruebas.")]
story += [screenshot(XLSX_SHOT), p("Captura 3. Vista visual de la hoja Detalle del XLSX descargado. La fila de fixture sin datos enriquecidos queda vacía; el ejemplo funcional no expone ningún identificador literal.", "CaptionCustom"), Spacer(1, 7 * mm), p("Alcance y límites", "H2Custom"), bullet("La validación es local y no equivale a evidencia de despliegue en producción."), bullet("No se activaron cron, mensajes automáticos ni cambios en GHL."), bullet("Los cambios se subirán a main después de revisar este PDF y el diff final."), Spacer(1, 6 * mm), p("Entregables", "H2Custom"), table([
    ["Artefacto", "Ubicación"],
    ["XLSX de prueba", "tmp/day6-report-final.xlsx"],
    ["Captura reportes", "output/screenshots/day6-reports-final.png"],
    ["Captura selección", "output/screenshots/day6-queue-copy.png"],
    ["Captura XLSX", "output/screenshots/day6-xlsx-preview.png"],
], [58 * mm, 98 * mm])]

doc.build(story, onFirstPage=frame, onLaterPages=frame)
print(OUT)
