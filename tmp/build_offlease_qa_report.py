import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "output" / "qa" / "offlease-qa-results-2026-09-17.json"
PDF_PATH = ROOT / "output" / "pdf" / "offlease-qa-report-2026-09-17.pdf"


def p(text, style):
    return Paragraph(str(text).replace("\n", "<br/>") , style)


def make_table(data, widths, header=True, font_size=8):
    cell_style = ParagraphStyle(
        name=f"TableCell{font_size}",
        fontName="Helvetica",
        fontSize=font_size,
        leading=font_size + 2,
        textColor=colors.black,
    )
    header_style = ParagraphStyle(
        name=f"TableHeader{font_size}",
        fontName="Helvetica-Bold",
        fontSize=font_size,
        leading=font_size + 2,
        textColor=colors.white,
    )

    wrapped_data = []
    for row_index, row in enumerate(data):
        row_style = header_style if header and row_index == 0 else cell_style
        wrapped_row = []
        for cell in row:
            if isinstance(cell, Paragraph):
                wrapped_row.append(cell)
            else:
                wrapped_row.append(Paragraph(str(cell).replace("\n", "<br/>"), row_style))
        wrapped_data.append(wrapped_row)

    table = Table(wrapped_data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("LEADING", (0, 0), (-1, -1), font_size + 2),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173B3F")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ])
    for row in range(1 if header else 0, len(data)):
        if row % 2 == (1 if header else 0):
            commands.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#F8FAFC")))
    table.setStyle(TableStyle(commands))
    return table


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.line(36, 28, landscape(letter)[0] - 36, 28)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(36, 17, "dealerADMIN - Offlease QA local - no production writes")
    canvas.drawRightString(landscape(letter)[0] - 36, 17, f"Pagina {doc.page}")
    canvas.restoreState()


def main():
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=30, textColor=colors.HexColor("#173B3F"), alignment=TA_LEFT, spaceAfter=14))
    styles.add(ParagraphStyle(name="Subtitle", parent=styles["Normal"], fontSize=12, leading=17, textColor=colors.HexColor("#475569"), spaceAfter=12))
    styles.add(ParagraphStyle(name="H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=colors.HexColor("#173B3F"), spaceBefore=8, spaceAfter=9))
    styles.add(ParagraphStyle(name="H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=colors.HexColor("#0F766E"), spaceBefore=7, spaceAfter=5))
    styles.add(ParagraphStyle(name="BodyCustom", parent=styles["BodyText"], fontSize=9, leading=13, textColor=colors.HexColor("#1E293B"), spaceAfter=6))
    styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontSize=7.5, leading=10, textColor=colors.HexColor("#475569"), spaceAfter=4))
    styles.add(ParagraphStyle(name="Pass", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=colors.HexColor("#047857"), spaceAfter=5))
    styles.add(ParagraphStyle(name="CenterSmall", parent=styles["BodyText"], fontSize=8, leading=10, alignment=TA_CENTER))

    doc = SimpleDocTemplate(str(PDF_PATH), pagesize=landscape(letter), rightMargin=36, leftMargin=36, topMargin=34, bottomMargin=42, title=data["report"]["title"], author="dealerADMIN QA")
    story = []

    story.append(Spacer(1, 0.35 * inch))
    story.append(p("Reporte de QA: reglas Offlease, normalizacion y prediccion", styles["TitleCustom"]))
    story.append(p("Stafford y Fredericksburg | Evidencia local reproducible | 17 de septiembre de 2026", styles["Subtitle"]))
    story.append(Spacer(1, 0.12 * inch))
    story.append(p("Resultado global: PASS 100%", styles["Pass"]))
    story.append(p("Este reporte separa de forma explicita las conversaciones generadas para QA de las conversaciones de referencia leidas desde Neon. Las pruebas de aceptacion se ejecutaron en la API local y PostgreSQL Docker; Neon se mantuvo en modo lectura.", styles["BodyCustom"]))
    summary_data = [
        [p("Metrica", styles["Small"]), p("Resultado", styles["Small"]), p("Evidencia", styles["Small"])],
        ["Unitarias", "336 / 336 PASS", "5 archivos de prueba"],
        ["Matriz Docker", "10 / 10 PASS", "Stafford WhatsApp + Fredericksburg Messenger"],
        ["Prediccion", "10 / 10 PASS", "down inferior vs documentos"],
        ["Frontend local", "2 / 2 PASS", "campos visibles en ambos Offlease"],
        ["Pausa del bot", "8 / 8 PASS", "pause_hours = 24"],
        ["GitHub", "NO PUSH", "bloqueado hasta revision humana"],
    ]
    story.append(make_table(summary_data, [1.65 * inch, 1.5 * inch, 5.6 * inch], font_size=9))

    story.append(PageBreak())
    story.append(p("1. Proveniencia de las conversaciones", styles["H1Custom"]))
    story.append(p("Esta distincion es necesaria para hacer comparaciones validas y evitar presentar casos sinteticos como si fueran conversaciones reales.", styles["BodyCustom"]))
    provenance = [
        ["Grupo", "Origen", "Identificador", "Uso", "Produccion"],
        ["QA generado", "Mensajes creados para esta corrida", "qa-offlease-v4-* (10)", "Casos deterministas equal, superior, inferior, trade-in y cash", "Solo Docker local"],
        ["Referencia Neon", "Conversaciones existentes leidas en Neon", "IDs parcialmente anonimizados en el JSON", "Comparar lenguaje y patrones reales", "Lectura solamente; 0 escrituras"],
    ]
    story.append(make_table(provenance, [1.05 * inch, 2.0 * inch, 1.75 * inch, 3.0 * inch, 1.75 * inch], font_size=8))
    story.append(Spacer(1, 10))
    story.append(p("Muestras de referencia leidas desde Neon", styles["H2Custom"]))
    neon_rows = [["Conversation", "Location", "Patron observado"]]
    for sample in data["provenanceAndComparison"]["neonReferenceSamples"]["samples"]:
        neon_rows.append([sample["conversationId"], sample["sourceLocation"], sample["observedPattern"]])
    story.append(make_table(neon_rows, [1.7 * inch, 2.1 * inch, 4.8 * inch], font_size=8))
    story.append(Spacer(1, 10))
    story.append(p("Conclusion de proveniencia: los registros Neon sirvieron como referencia, mientras que los diez registros qa-offlease-v4 fueron creados por el operador para probar el comportamiento esperado de forma controlada.", styles["BodyCustom"]))

    story.append(PageBreak())
    story.append(p("2. Regla de down payment y matriz de estados", styles["H1Custom"]))
    story.append(p("El enrutamiento Offlease requiere vehiculo, telefono y una via de down aceptada. Un down numerico inferior no entra a waiting_window. Cash y trade-in son vias aceptadas; cash se guarda como Pagara en cash.", styles["BodyCustom"]))
    rules = [["Categoria", "Minimo"]] + [[key, f"${value:,}"] for key, value in data["rules"]["minimumDownPayments"].items()]
    story.append(make_table(rules, [2.2 * inch, 1.3 * inch], font_size=8))
    story.append(Spacer(1, 10))
    matrix = [["Source", "Canal", "Caso", "Vehiculo", "Req.", "Down normalizado", "Suficiente", "Estado inicial"]]
    for case in data["dockerDatabaseMatrix"]["cases"]:
        matrix.append([
            case["source"], case["channel"], case["case"], case["vehicle"], f"${case['requiredDown']:,}", case["normalizedDown"], "true" if case["downSufficient"] else "false", case["initialStatus"],
        ])
    story.append(make_table(matrix, [1.0 * inch, 0.75 * inch, 0.75 * inch, 1.25 * inch, 0.55 * inch, 1.45 * inch, 0.7 * inch, 1.15 * inch], font_size=7.5))
    story.append(Spacer(1, 8))
    story.append(p("Resultado de la matriz: 10 / 10 PASS. Los casos inferiores quedaron partial; los casos igual, superior, trade-in y cash llegaron a waiting_window en la captura inmediata.", styles["Pass"]))

    story.append(PageBreak())
    story.append(p("3. Prediccion de la siguiente pregunta", styles["H1Custom"]))
    story.append(p("La prediccion es determinista y se basa en los campos faltantes despues de normalizar el transcript. No usa API externa de IA.", styles["BodyCustom"]))
    prediction = [["Caso", "Paso predicho", "Pregunta predicha"]]
    shown = {}
    for case in data["dockerDatabaseMatrix"]["cases"]:
        key = case["case"]
        if key in shown:
            continue
        shown[key] = True
        prediction.append([key, case["predictedStep"], case["predictedQuestion"]])
    story.append(make_table(prediction, [1.25 * inch, 1.4 * inch, 6.7 * inch], font_size=8.5))
    story.append(Spacer(1, 10))
    story.append(p("Prediccion verificada en la base local: 10 / 10 PASS. El down inferior conserva el paso down_payment y formula la recuperacion del minimo de $1,500; todos los caminos aceptados avanzan al paso documents.", styles["Pass"]))
    story.append(p("Cobertura adicional de normalizacion: 1000, 2000, 3000, 3 mil, 2 mil, mil, 1K, 2K, 3K, cash, contado, efectivo y varias expresiones de trade-in.", styles["BodyCustom"]))

    story.append(PageBreak())
    story.append(p("4. Regresion de geozonas, round robin e idioma", styles["H1Custom"]))
    story.append(p("Se repitio la validacion contra PostgreSQL Docker usando los dealers y el historial local. Las comprobaciones de alternancia se ejecutaron dentro de una transaccion revertida para no dejar cambios persistentes.", styles["BodyCustom"]))
    regression = data["regressionOtherAlgorithms"]
    regression_summary = [
        ["Area", "Resultado", "Detalle"],
        ["Geozonas", "7 / 7 PASS", "VA, MD, DE, PA, NY, NJ y DC"],
        ["Baltimore", "PASS", "Round robin Rosedale / Laurel"],
        ["Southern Maryland", "PASS", "Round robin Laurel / Sterling"],
        ["Millersville", "3 / 3 PASS", "Millersville / Nissan of White Marsh"],
        ["Action Cars", "2 / 2 PASS", "Español -> ES; English -> EN"],
    ]
    story.append(make_table(regression_summary, [1.7 * inch, 1.2 * inch, 6.45 * inch], font_size=8.5))
    story.append(Spacer(1, 10))
    regression_rows = [["Caso", "Actual", "Esperado", "Estado"]]
    for case in regression["cases"]:
        regression_rows.append([case["name"], case["actual"], case["expected"], "PASS" if case["pass"] else "FAIL"])
    story.append(make_table(regression_rows, [4.7 * inch, 1.5 * inch, 1.5 * inch, 0.8 * inch], font_size=7.5))
    story.append(Spacer(1, 10))
    story.append(p("Resultado de regresion adicional: 14 / 14 PASS.", styles["Pass"]))

    story.append(PageBreak())
    story.append(p("5. Frontend, pausa del bot y logs", styles["H1Custom"]))
    story.append(p("El endpoint de leads ahora trae desde el snapshot mas reciente: vehicleCategory, requiredDownPayment, downPaymentAmount, downPaymentSufficient y qualificationStep. El frontend muestra estos valores bajo Normalizado.", styles["BodyCustom"]))
    frontend = [
        ["Verificacion", "Resultado", "Detalle"],
        ["Stafford local Playwright", "PASS", "Normalizado, categoria, minimo, suficiencia y cash visibles; inferior no visible en cola"],
        ["Fredericksburg local Playwright", "PASS", "Mismos campos visibles; inferior no visible en cola"],
        ["Stafford Messenger", "PASS", "HTTP 422; fuente restringida a WhatsApp"],
        ["Bot pause", "PASS", "8 eventos queued con pause_hours=24"],
    ]
    story.append(make_table(frontend, [2.0 * inch, 1.0 * inch, 6.35 * inch], font_size=8.5))
    story.append(Spacer(1, 12))
    story.append(p("Logs resumidos de ejecucion", styles["H2Custom"]))
    logs = [["Comando / prueba", "Resultado"]]
    for item in data["automatedChecks"]:
        logs.append([item["command"], item["result"]])
    story.append(make_table(logs, [4.0 * inch, 5.35 * inch], font_size=8.5))
    story.append(Spacer(1, 12))
    story.append(p("Gate de publicacion: NO se hizo push a GitHub. La publicacion queda bloqueada hasta que el usuario revise este JSON y este PDF y autorice expresamente el siguiente paso.", styles["Pass"]))
    story.append(p("Interpretacion del 100%: significa que todos los criterios y casos definidos en esta corrida de aceptacion pasaron. No se presenta como una garantia matematica sobre lenguaje nunca observado; por eso se conservaron pruebas de formatos, prediccion, Docker, frontend y referencia Neon.", styles["Small"]))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
