from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

output = r"C:\dev\dealeradmin\output\pdf\qa-offlease-media-down-2026-09-17.pdf"
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontSize=9, leading=12, spaceAfter=5))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontSize=13, leading=16, textColor=colors.HexColor("#123B5D"), spaceBefore=10, spaceAfter=6))
styles["Title"].textColor = colors.HexColor("#123B5D")

doc = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.65*inch, leftMargin=0.65*inch, topMargin=0.6*inch, bottomMargin=0.6*inch)
story = []
story.append(Paragraph("Reporte QA - Offlease, OCR de telefono y down payment", styles["Title"]))
story.append(Paragraph("Fecha: 17 de septiembre de 2026 | Commit: 9590d8d | Produccion: Vercel Ready", styles["Small"]))
story.append(Spacer(1, 8))
story.append(Paragraph("Resultado ejecutivo", styles["Section"]))
story.append(Paragraph("La validacion termino en 100%: 553/553 pruebas Vitest, 16/16 pruebas Playwright E2E y OCR Docker exitoso con el telefono extraido desde una imagen. El commit fue publicado y Vercel lo marco Ready en Production.", styles["BodyText"]))

story.append(Paragraph("Matriz de pruebas", styles["Section"]))
data = [
    ["Capa", "Resultado", "Evidencia"],
    ["Unitarias e integracion", "553/553 PASS", "35 archivos Vitest; Postgres local incluido"],
    ["Pruebas dirigidas", "213/213 PASS", "Normalizador, webhook, OCR y ventana"],
    ["E2E local", "16/16 PASS", "Webhooks, routing, UI, HMAC y dashboard"],
    ["OCR en Docker", "PASS", "+1-240-841-4183 extraido"],
    ["Frontend produccion", "PASS", "Charger y 2000 visibles en la cola"],
]
table = Table(data, colWidths=[1.55*inch, 1.15*inch, 3.8*inch])
table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#123B5D")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 8.5),
    ("LEADING", (0,0), (-1,-1), 11),
    ("GRID", (0,0), (-1,-1), 0.35, colors.HexColor("#B8C7D1")),
    ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#EEF4F7")]),
    ("TOPPADDING", (0,0), (-1,-1), 6),
    ("BOTTOMPADDING", (0,0), (-1,-1), 6),
]))
story.append(table)

story.append(Paragraph("Cambios verificados", styles["Section"]))
for item in [
    "El backend conserva la evidencia OCR de imagen aunque GHL no escriba el telefono nativo.",
    "Un webhook de texto normal despues de la imagen conserva el telefono OCR y persiste el mensaje nuevo.",
    "ready_at queda fijado para que waiting_window no se prorrogue cada 30 minutos.",
    "El normalizador acepta 1000, 2000, 3000, 3 mil, 1K, 2K, 3K y cantidades superiores.",
    "Las respuestas afirmativas solo heredan el monto de la ultima pregunta concreta de down/minimo; no se usa un si de telefono, banco, documentos o timeline.",
]:
    story.append(Paragraph("- " + item, styles["Small"]))

story.append(PageBreak())
story.append(Paragraph("Criterios de aceptacion", styles["Section"]))
for item in [
    "Offlease bloquea el ingreso a waiting_window cuando el down es inferior al minimo del vehiculo.",
    "Down igual o superior, pago de contado y trade-in siguen los caminos permitidos por la politica configurada.",
    "Stafford continua limitado a WhatsApp; Fredericksburg y Fredericksburg 2 conservan sus canales configurados.",
    "La vista de dealerADMIN muestra los campos normalizados: vehiculo, telefono y down.",
    "Las pruebas de geolocalizacion, round robin, captura webhook y firma HMAC no presentan regresiones.",
]:
    story.append(Paragraph("- " + item, styles["Small"]))
story.append(Paragraph("Produccion", styles["Section"]))
story.append(Paragraph("El commit 9590d8d fue enviado a main. Vercel genero el deployment de Production y lo mostro como Ready. La vista real de dealerADMIN mostro: Subaniel Salinas Torres, +12408311746, Charger y 2000 de down.", styles["BodyText"]))
story.append(Spacer(1, 12))
story.append(Paragraph("Nota de QA", styles["Section"]))
story.append(Paragraph("Las conversaciones usadas para comparar fueron fixtures de QA y datos consultados durante la validacion; no se modificaron filas productivas durante las pruebas. El contenedor temporal de worker lanzado sin imagen fue detenido al finalizar; el Postgres local requerido permanecio activo.", styles["Small"]))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#667781"))
    canvas.drawString(0.65*inch, 0.35*inch, "dealerADMIN - QA 2026-09-17")
    canvas.drawRightString(7.85*inch, 0.35*inch, f"Pagina {doc.page}")
    canvas.restoreState()

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(output)
