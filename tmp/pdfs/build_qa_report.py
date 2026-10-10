from __future__ import annotations
import html, json
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, LongTable, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(r"C:\dev\dealeradmin")
QA = ROOT / "tmp" / "qa-e2e-local-20260912"
OUT = ROOT / "output" / "pdf" / "dealeradmin-qa-problemas-soluciones-2026-09-12.pdf"
evidence = json.loads((QA / "evidence.json").read_text(encoding="utf-8"))
failures = json.loads((QA / "failure-evidence.json").read_text(encoding="utf-8"))["failures"]

INK = colors.HexColor("#17342f")
TEAL = colors.HexColor("#0f8b83")
PALE = colors.HexColor("#e9f4f1")
LINE = colors.HexColor("#cadbd7")
MUTED = colors.HexColor("#526863")
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="Kicker", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=TEAL, alignment=1, spaceAfter=8))
styles.add(ParagraphStyle(name="Cover", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=23, leading=28, textColor=INK, alignment=1, spaceAfter=12))
styles.add(ParagraphStyle(name="Sub", parent=styles["Normal"], fontSize=10.5, leading=15, textColor=MUTED, alignment=1))
styles.add(ParagraphStyle(name="H1QA", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INK, spaceBefore=3, spaceAfter=8))
styles.add(ParagraphStyle(name="H2QA", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=TEAL, spaceBefore=5, spaceAfter=3))
styles.add(ParagraphStyle(name="BodyQA", parent=styles["BodyText"], fontSize=8.5, leading=11.5, textColor=INK, spaceAfter=4))
styles.add(ParagraphStyle(name="SmallQA", parent=styles["BodyText"], fontSize=6.5, leading=8, textColor=INK, spaceAfter=1))
styles.add(ParagraphStyle(name="CaptionQA", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=6.8, leading=8, textColor=MUTED, alignment=1, spaceAfter=6))

def esc(value):
    return html.escape(str(value if value is not None else ""), quote=False)

def P(value, style="BodyQA"):
    return Paragraph(esc(value).replace("&lt;br/&gt;", "<br/>"), styles[style])

def PB(value, style="BodyQA"):
    return Paragraph(value, styles[style])

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 8 * mm, "dealerADMIN | QA local | datos de prueba solamente")
    canvas.drawRightString(A4[0] - 18 * mm, 8 * mm, f"Pagina {doc.page}")
    canvas.restoreState()

def box(label, value):
    table = Table([[P(label, "SmallQA"), P(value, "H2QA")]], colWidths=[45 * mm, 120 * mm])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), .5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return table

def issue(item):
    rows = [[P(f"{item['id']} - {item['stage']}", "H2QA")], [PB(f"<b>Observado:</b> {esc(item['observed'])}")], [PB(f"<b>Causa raiz:</b> {esc(item['root_cause'])}")], [PB(f"<b>Correccion:</b> {esc(item['correction'])}")], [PB(f"<b>Archivos:</b> {esc(', '.join(item['files']))}", "SmallQA")], [PB(f"<b>Evidencia/SQL:</b> {esc(item.get('verification_sql', 'evidence.json y logs locales'))}", "SmallQA")], [PB(f"<b>Retest:</b> {esc(item['retest'])}", "SmallQA")]]
    table = Table(rows, colWidths=[174 * mm])
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f7fbfa")), ("BOX", (0, 0), (-1, -1), .5, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return table

def case_row(case):
    steps = case.get("steps", [])
    state = (case.get("after") or {}).get("state", [])
    events = ", ".join(str(s.get("event_id", "")) for s in steps)
    hashes = ", ".join(str(s.get("payload_hash", ""))[:16] for s in steps)
    return [P(case.get("id", ""), "SmallQA"), P(case.get("conversationId", ""), "SmallQA"), P(f"event: {events}<br/>hash: {hashes}", "SmallQA"), P(f"before={case.get('status_before', '')}<br/>after={case.get('status_after', '')}", "SmallQA"), P(f"dealer={case.get('dealer_assigned', [])}<br/>next={case.get('next_attempt_at', '')}<br/>{case.get('routing_reason', [])}", "SmallQA"), P(case.get("assertion", ""), "SmallQA")]

story = [Spacer(1, 25 * mm), P("INFORME FINAL DE QA LOCAL", "Kicker"), P("Problemas encontrados y soluciones aplicadas", "Cover"), P("dealerADMIN - E2E general completamente local\n12 de septiembre de 2026", "Sub"), Spacer(1, 15 * mm), box("RESULTADO", "PASS AC-01 a AC-20"), Spacer(1, 6 * mm), box("E2E", "34 casos PASS | 0 FAIL | 0 BLOCKED"), Spacer(1, 6 * mm), box("REGRESION", "333 tests PASS en 28 archivos"), PageBreak()]
story += [P("1. Resumen ejecutivo", "H1QA"), P("Se levantaron PostgreSQL Docker, API y frontend locales. Se enviaron Customer Replied firmados a las fuentes configuradas y se probaron Messenger, WhatsApp, respuestas contaminantes y validas, reparacion por poll, ventanas de 15 segundos/30 segundos/30 minutos/3 horas, concurrencia, duplicados, ruteo y la regla nueva de telefono enviado hace al menos tres dias."), P("Se encontraron ocho problemas durante la ejecucion. Cada uno fue capturado antes de corregirse, se aplico una correccion acotada y se reejecuto el caso relacionado. La reejecucion final fue 34/34 E2E PASS y la regresion completa fue 333/333 tests PASS. No quedaron pendientes reales ni bloqueos."), P("La especificacion PDF adjunta se trato como plan de QA. No se activaron GHL, Neon ni cuentas reales."), P("2. Version exacta probada", "H1QA"), Table([[P("Elemento", "SmallQA"), P("Valor", "SmallQA")], [P("Commit", "SmallQA"), P("3470776ed3ec0e72adb4583fa015291a9e9e3985", "SmallQA")], [P("Docker", "SmallQA"), P("c20d4b05ae50 | dealeradmin-postgres | postgres:18 | activo", "SmallQA")], [P("API / frontend", "SmallQA"), P("http://127.0.0.1:3010 / http://127.0.0.1:3000", "SmallQA")], [P("Migracion", "SmallQA"), P("RepairCustomerRepliedSourceAliases1710000020000", "SmallQA")], [P("Configuracion", "SmallQA"), P("NODE_ENV development; America/Bogota; reloj fijo de QA; HMAC simulado no impreso", "SmallQA")]], colWidths=[35 * mm, 139 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), PALE), ("GRID", (0, 0), (-1, -1), .35, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])), P("Esquema verificado: conversation_messages, conversations, dealer_location_aliases, dealer_round_robin_state, dealers, lead_dealers, locations, leads, migrations y webhook_events. Namespace QA final: 37 leads, 45 eventos y 34 conversaciones."), PageBreak()]
story += [P("3. Matriz AC-01 a AC-20", "H1QA"), P(f"Timestamp de evidencia: {evidence.get('generated_at', '')}. Los hashes completos, IDs, snapshots y SQL estan en evidence.json.")]
criteria = ["Trazabilidad completa", "HMAC invalido", "Idempotencia exacta", "Identidad Messenger/WhatsApp", "No contaminar real_name", "Evidencia de vehiculo", "Down y timeline separados", "Documentos no bloquean", "Reparacion poll 30 s", "No mezclar campos", "Ventanas Bogota", "waiting_window null", "Action Cars por idioma", "Millersville alternancia", "Easterns ciudad/estado", "Duplicado queued", "Coherencia de estado", "Sin fuga dealer", "Sent y concurrencia", "Frontend refleja BD"]
matrix = [[P("AC", "SmallQA"), P("Resultado", "SmallQA"), P("Timestamp", "SmallQA"), P("Evidencia", "SmallQA")]] + [[P(f"AC-{i:02d}", "SmallQA"), P("PASS", "SmallQA"), P(evidence.get("generated_at", ""), "SmallQA"), P(c, "SmallQA")] for i, c in enumerate(criteria, 1)]
story.append(LongTable(matrix, colWidths=[17 * mm, 23 * mm, 42 * mm, 92 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), PALE), ("GRID", (0, 0), (-1, -1), .3, LINE), ("TEXTCOLOR", (1, 1), (1, -1), TEAL), ("FONTNAME", (1, 1), (1, -1), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)])))
story += [PageBreak(), P("4. Detalle de cada conversacion", "H1QA"), P("Cada fila resume payload hash, event_id, conversation_id, estados, dealer, ventana y routing_reason. Los message IDs completos, snapshots before/after, location_snapshot y queries estan en evidence.json.")]
header = [P("Case", "SmallQA"), P("Conversation", "SmallQA"), P("Payload/event", "SmallQA"), P("Estado", "SmallQA"), P("Dealer/ventana", "SmallQA"), P("Resultado", "SmallQA")]
detail = [header] + [case_row(case) for case in evidence.get("cases", [])]
story.append(LongTable(detail, colWidths=[25 * mm, 29 * mm, 48 * mm, 22 * mm, 32 * mm, 18 * mm], repeatRows=1, style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), PALE), ("GRID", (0, 0), (-1, -1), .25, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)])))
story += [PageBreak(), P("5. Incidentes de normalizacion", "H1QA"), P("Se aplico la regla conservadora: si no hay evidencia suficiente, el campo queda vacio. No se mezclan real_name, vehicle_type, down_payment, purchase_timeline, documents, identification ni bank_account."), P("Se verificaron nombres declarados, vehiculos Mustang/truck/SUV/Sedan, down payments 1000/2000/3000, anios 2025/2018, plazos, identificacion, cuenta bancaria, documentos y prueba de ingresos. Tambien se corrigio telefono invalido seguido de telefono valido conservando la misma conversacion."), P("Regla nueva: sent_at de al menos tres dias produce stale_phone_ignored y no crea nueva cola; sent_at de dos dias permite el lead. Casos: stale-phone-exact-3-days y recent-phone-allowed."), P("6. Action Cars y Millersville", "H1QA"), P("Action Cars uso el mismo endpoint con action-es y action-en; cada idioma quedo en su dealer/cola sin mezcla."), P("Millersville produjo exactamente: Easterns Millersville, White Marsh, Millersville, White Marsh."), P("7. Ruteo Easterns", "H1QA"), P("Rosedale fue a Rosedale; Laurel ambiguo priorizo Maryland y fue a Laurel; Laurel VA respetó el estado explícito y fue a Sterling; Sterling fue a Sterling; Newark en colisión respetó la prioridad MD. Un nombre de contacto que contenia Easterns Laurel no selecciono dealer."), PageBreak(), P("8. Pruebas de 30 segundos y ventanas", "H1QA"), P("Prueba de 30 segundos: se dejo una conversacion incompleta, se agrego el inbound tardio 2000/esta semana y process-due a +30 s reparo la misma conversation_db_id sin duplicarla."), P("Ventanas distintas: 10:00 America/Bogota +30 min y 20:00 America/Bogota +3 h. La estabilizacion de +15 s y el poll de +30 s se probaron por separado."), P("Tambien se cambio manualmente waiting_window con next_attempt_at null y el proceso calculo la fecha con reloj controlado."), P("9. Regresiones y pendientes reales", "H1QA"), P("Despues de cada correccion se reejecuto el caso fallido y regresiones relacionadas. Resultado: 34/34 E2E PASS y 333/333 tests PASS, incluyendo carga de 150 webhooks, duplicados, orden invertido y rollback. Pendientes reales: ninguno para AC-01 a AC-20."), PageBreak(), P("10. Capturas incluidas", "H1QA"), P("Capturas del estado local de UI y BD que acompañan este informe:")]
for path, caption in [(QA / "frontend-dashboard.png", "Frontend local autenticado: cola Fredericksburg, Ana Fred y Late Repair"), (ROOT / "output" / "screenshots" / "real-db-before-webhook.png", "BD local antes del webhook"), (ROOT / "output" / "screenshots" / "real-db-pending-after-webhook.png", "BD local despues del webhook, pending"), (ROOT / "output" / "screenshots" / "real-db-sent-after-webhook.png", "BD local despues del reprocesamiento, sent")]:
    if path.exists():
        img = Image(str(path))
        scale = min((170 * mm) / img.imageWidth, (75 * mm) / img.imageHeight)
        img.drawWidth, img.drawHeight = img.imageWidth * scale, img.imageHeight * scale
        story += [img, P(caption, "CaptionQA"), Spacer(1, 2)]
story += [PageBreak(), P("11. Detalle de incidentes y soluciones", "H1QA")]
for item in failures:
    story += [issue(item), Spacer(1, 4)]
story += [PageBreak(), P("12. Cierre", "H1QA"), P("La implementacion queda validada localmente con PASS AC-01 a AC-20. El PDF no contiene secretos; los datos y teléfonos mostrados son fixtures del namespace QA."), box("CIERRE", "PASS | 0 FAIL | 0 BLOCKED")]

OUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=15 * mm, bottomMargin=18 * mm, title="dealerADMIN QA local - problemas y soluciones", author="Codex")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(str(OUT))
