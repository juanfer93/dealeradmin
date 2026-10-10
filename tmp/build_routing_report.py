from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

src = r"C:\dev\dealeradmin\tmp\routing_report_content.txt"
out = r"C:\dev\dealeradmin\output\pdf\informe-correccion-routing-qualification-memory-2026-09-10.pdf"
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=25, textColor=colors.HexColor("#073B4C"), spaceAfter=14))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=17, textColor=colors.HexColor("#007C83"), spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="BodyReport", parent=styles["BodyText"], fontSize=9.5, leading=14, spaceAfter=8))
styles.add(ParagraphStyle(name="Footer", parent=styles["Normal"], fontSize=7.5, textColor=colors.HexColor("#52606D")))

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#D9E5E1"))
    canvas.line(18*mm, 14*mm, 192*mm, 14*mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#52606D"))
    canvas.drawString(18*mm, 9*mm, "dealerADMIN | Correccion de routing y qualification memory")
    canvas.drawRightString(192*mm, 9*mm, f"Pagina {doc.page}")
    canvas.restoreState()

story = []
for index, raw in enumerate(open(src, encoding="utf-8")):
    line = raw.strip()
    if not line:
        story.append(Spacer(1, 3))
        continue
    if index == 0:
        story.append(Paragraph(esc(line), styles["ReportTitle"]))
    elif line[:2].isdigit() and line[2:3] == ".":
        story.append(Paragraph(esc(line), styles["Section"]))
    else:
        story.append(Paragraph(esc(line).replace("**", ""), styles["BodyReport"]))

doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=16*mm, bottomMargin=19*mm, title="Correccion de routing y qualification memory")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)
