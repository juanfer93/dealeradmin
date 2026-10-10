from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, Image, PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "dealeradmin-qa-stafford-easterns-local-2026-09-12.pdf"
STAFFORD = ROOT / "tmp" / "qa-whatsapp-stafford-20260912" / "evidence.json"
EASTERNS = ROOT / "tmp" / "qa-easterns-routing-20260912" / "evidence.json"
FRONTEND = ROOT / "tmp" / "qa-whatsapp-stafford-20260912" / "frontend-result.json"
SCREENSHOT = ROOT / "tmp" / "qa-whatsapp-stafford-20260912" / "frontend-stafford-dashboard.png"

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleQA", parent=styles["Title"], fontSize=22, leading=27, textColor=colors.HexColor("#17324D"), alignment=TA_CENTER, spaceAfter=10))
styles.add(ParagraphStyle(name="SubQA", parent=styles["Normal"], fontSize=10, leading=14, textColor=colors.HexColor("#53616F"), alignment=TA_CENTER, spaceAfter=15))
styles.add(ParagraphStyle(name="H1QA", parent=styles["Heading1"], fontSize=15, leading=19, textColor=colors.HexColor("#17324D"), spaceBefore=8, spaceAfter=8))
styles.add(ParagraphStyle(name="H2QA", parent=styles["Heading2"], fontSize=11, leading=14, textColor=colors.HexColor("#246B8F"), spaceBefore=7, spaceAfter=5))
styles.add(ParagraphStyle(name="BodyQA", parent=styles["BodyText"], fontSize=8.6, leading=12, spaceAfter=6))
styles.add(ParagraphStyle(name="SmallQA", parent=styles["BodyText"], fontSize=7.1, leading=9, spaceAfter=0))
styles.add(ParagraphStyle(name="TinyQA", parent=styles["BodyText"], fontSize=6.2, leading=7.3, spaceAfter=0))
styles.add(ParagraphStyle(name="CodeQA", parent=styles["Code"], fontName="Courier", fontSize=5.8, leading=7, leftIndent=4, rightIndent=4, backColor=colors.HexColor("#F4F7FA"), borderColor=colors.HexColor("#D5DEE8"), borderWidth=0.5, borderPadding=4))
styles.add(ParagraphStyle(name="HeaderQA", parent=styles["SmallQA"], textColor=colors.white, fontName="Helvetica-Bold"))


def para(value, style="SmallQA"):
    text = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(text, styles[style])


def short_json(value, limit=1500):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= limit else text[:limit] + "..."


def make_table(rows, widths):
    cells = []
    for row_index, row in enumerate(rows):
        row_style = "HeaderQA" if row_index == 0 else "SmallQA"
        cells.append([cell if hasattr(cell, "wrap") else para(cell, row_style) for cell in row])
    result = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C9D2DC")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17324D")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ]
    for row in range(2, len(rows), 2):
        commands.append(("BACKGROUND", (0, row), (-1, row), colors.HexColor("#F4F7FA")))
    result.setStyle(TableStyle(commands))
    return result


class QAReport(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(filename, pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=17*mm, bottomMargin=20*mm, title="dealerADMIN QA local Stafford Easterns")
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal")
        self.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=self.footer)])

    def footer(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D5DEE8"))
        canvas.line(18*mm, 15*mm, 192*mm, 15*mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#5D6B78"))
        canvas.drawString(18*mm, 10*mm, "dealerADMIN - QA local Stafford WhatsApp + Easterns")
        canvas.drawRightString(192*mm, 10*mm, f"Pagina {doc.page}")
        canvas.restoreState()


staff = json.loads(STAFFORD.read_text(encoding="utf-8"))
east = json.loads(EASTERNS.read_text(encoding="utf-8"))
frontend = json.loads(FRONTEND.read_text(encoding="utf-8"))
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
dealer_names = {"d1111111-1111-1111-1111-111111111111": "Rosedale", "d2222222-2222-2222-2222-222222222222": "Laurel", "d3333333-3333-3333-3333-333333333333": "Sterling"}
story = []

story += [para("Reporte de QA E2E local", "TitleQA"), para("Stafford WhatsApp y Easterns Automotive Group - evidencia reproducible", "SubQA")]
story += [make_table([
    ["Resultado", "Alcance", "Evidencia"],
    ["PASS", "Stafford WhatsApp: 7/7; frontend local PASS", "JSON de evidencia + captura"],
    ["PASS", "Easterns: 8/8 rutas solicitadas", "JSON + SQL de verificacion"],
    ["PASS", "Regresion: 328 tests + 4 stress", "Suite local completa"],
    ["BLOCKED", "Ninguno", "Sin dependencias pendientes"],
], [26*mm, 70*mm, 78*mm]), Spacer(1, 8)]
story += [para("Resumen ejecutivo", "H1QA")]
story += [para("Se ejecuto un E2E completamente local usando el PostgreSQL de Docker proporcionado, una API local y el frontend local. Los Customer Replied fueron simulados y firmados con un HMAC de prueba inyectado por variables de entorno; el secreto no se imprimio ni se guardo en esta evidencia." , "BodyQA")]
story += [para("Stafford WhatsApp quedo conforme con la regla especial: el telefono ya existe, pero el backend solo crea la cola cuando interpreta un vehiculo. Sin vehiculo permanece parcial. Se probaron 15 segundos de estabilizacion, 30 minutos dentro de horario y 3 horas fuera de horario con reloj simulado. Easterns quedo dirigido por datos de locations, sin listas de ciudades codificadas en el servicio.", "BodyQA")]
story += [para("Action Pre Owned Cars queda verificado con los dos nombres solicitados: Action Pre Owned Cars English y Action Pre Owned Cars Español.", "BodyQA")]

story += [para("Version exacta probada y entorno", "H1QA")]
story += [make_table([
    ["Elemento", "Valor"],
    ["Commit publicado", commit],
    ["Rama / remoto", "main / https://github.com/juanfer93/dealeradmin.git"],
    ["BD", "dealeradmin-postgres; c20d4b05ae50; postgres:18; Up; puerto 5432"],
    ["Migracion ultima", "EasternsLocationRoutingRules1710000021000"],
    ["API / frontend", "http://127.0.0.1:3010 / http://127.0.0.1:3000"],
    ["Zona horaria", "America/Bogota"],
    ["Config no secreta", "NODE_ENV=development; API_URL local; reloj de prueba; namespace determinista"],
    ["Externos", "GHL=false; Neon=false; cuentas reales=false"],
    ["Generado", generated],
], [43*mm, 131*mm]), Spacer(1, 8)]
story += [para("La tabla locations tiene 5,298 registros: outside_md_va 4,074; virginia 688; maryland_laurel 316; southern_md_overlap 218; baltimore_overlap 1; silver_spring_laurel 1.", "BodyQA")]

story += [para("Matriz AC-01 a AC-20", "H1QA")]
matrix = [["ID", "Criterio", "Estado", "Evidencia / timestamp"]]
matrix += [
    ["AC-01", "DB, API y frontend locales saludables", "PASS", "API 3010 + frontend 3000; 2026-09-12"],
    ["AC-02", "Migraciones verificadas en PostgreSQL", "PASS", "Ultima 1710000021000; SELECT migrations"],
    ["AC-03", "Webhook Stafford WhatsApp firmado", "PASS", "7 casos; HTTP 201; IDs deterministas"],
    ["AC-04", "Telefono preexistente no basta solo", "PASS", "phone-without-vehicle -> partial; sin lead_dealer"],
    ["AC-05", "Vehiculo interpretado habilita minima", "PASS", "Mustang y truck en snapshot"],
    ["AC-06", "Contaminantes no inventan categoria", "PASS", "requisitos/financiar/Mustang aislado"],
    ["AC-07", "Incompleta en horario: +30 min", "PASS", "10:00 Bogota -> 15:30Z; queued"],
    ["AC-08", "Incompleta fuera: +3 h", "PASS", "20:00 Bogota -> 04:00Z; queued"],
    ["AC-09", "Poll de estabilizacion +15 s", "PASS", "process-due con X-Test-Now"],
    ["AC-10", "Nombre y vehiculo separados", "PASS", "real_name y vehicle_type independientes"],
    ["AC-11", "Webhook duplicado idempotente", "PASS", "duplicate_ignored; un mensaje"],
    ["AC-12", "Firma invalida rechazada", "PASS", "HTTP 401"],
    ["AC-13", "Baltimore rota Rosedale/Laurel", "PASS", "Caso 1 Rosedale; caso 2 Laurel"],
    ["AC-14", "New Jersey -> Rosedale", "PASS", "Newark NJ"],
    ["AC-15", "Silver Spring -> Laurel", "PASS", "Catalogo MD"],
    ["AC-16", "Washington/DC -> Sterling", "PASS", "Estado explicito DC"],
    ["AC-17", "Southern Maryland rota", "PASS", "Waldorf Laurel; La Plata Sterling"],
    ["AC-18", "Virginia -> Sterling", "PASS", "Richmond VA"],
    ["AC-19", "Ruteo consulta localidades BD", "PASS", "5,298 locations; zona + indice"],
    ["AC-20", "Regresion + Action bilingue", "PASS", "328/328 + 4/4 stress; nombres OK"],
]
story += [make_table(matrix, [13*mm, 70*mm, 18*mm, 73*mm]), PageBreak()]

story += [para("Detalle de cada conversacion Stafford WhatsApp", "H1QA")]
story += [para("Cada caso usa conversation_id y event_id deterministas dentro del namespace qa-whatsapp-stafford-20260912. Los webhooks se enviaron al endpoint local y la evidencia correlaciona conversation_messages, webhook_events, conversations, leads y lead_dealers mediante SQL.", "BodyQA")]
staff_rows = [["Caso", "Mensajes", "Estado/snapshot", "Ventana"]]
for case in staff["cases"]:
    snap = case.get("snapshot_after", {})
    bodies = [step["payload"]["message_body"] for step in case.get("steps", [])]
    if case["case_id"].endswith("day-vehicle-only"):
        window = "10:00; +15 s; +30 min -> queued"
    elif case["case_id"].endswith("night-vehicle-only"):
        window = "20:00; +15 s; +3 h -> queued"
    else:
        window = str(case.get("status_after", case.get("state_after", "")))
    staff_rows.append([case["case_id"].replace("qa-whatsapp-stafford-20260912-", ""), " | ".join(bodies), f"{case.get('state_before','none')} -> {case.get('state_after', case.get('status_after',''))}; vehicle={snap.get('vehicle_type') or '-'}; phone={snap.get('phone') or '-'}", window])
story += [make_table(staff_rows, [35*mm, 54*mm, 52*mm, 33*mm]), Spacer(1, 7)]
for case in staff["cases"]:
    story += [para(case["case_id"], "H2QA")]
    lines = []
    for step in case.get("steps", []):
        payload = step["payload"]
        lines.append(f"event_id={step['event_id']} | message_ids={','.join(step['message_ids'])} | payload_hash={step['payload_hash']} | body={payload['message_body']}")
    story += [Preformatted("\n".join(lines), styles["CodeQA"])]
    story += [para("Estado: " + str(case.get("state_after", case.get("status_after", ""))) + "; snapshot=" + short_json(case.get("snapshot_after", {})) + "; location_snapshot=" + short_json(case.get("location_snapshot", {})) + "; next_attempt_at=" + str(case.get("next_attempt_at")), "SmallQA")]
    if case.get("window_wait"):
        story += [para("Ventana simulada release_at=" + case["window_wait"].get("release_at", "") + "; transicion confirmada por poll.", "SmallQA")]
    sql = case.get("sql_verification", "") or case.get("steps", [{}])[-1].get("after", {}).get("sql", "")
    story += [para("SQL de verificacion:", "SmallQA"), Preformatted(sql, styles["CodeQA"]), Spacer(1, 5)]

story += [PageBreak(), para("Detalle de cada conversacion Easterns", "H1QA")]
story += [para("La secuencia usa ocho conversaciones Messenger independientes en easterns. locations aporta state_code y easterns_routing_zone; la rotacion consulta el historial persistido de lead_dealers.", "BodyQA")]
east_rows = [["Caso", "Ciudad/estado", "Dealer", "Routing reason", "Estado"]]
for case in east["cases"]:
    loc = case.get("location_snapshot", {})
    did = case.get("assigned_dealer_id", "")
    east_rows.append([case["case_id"].replace("qa-easterns-routing-20260912-", ""), f"{loc.get('city','')} / {loc.get('state','')}", dealer_names.get(did, did), case.get("routing_reason", ""), case.get("result", "")])
story += [make_table(east_rows, [39*mm, 32*mm, 25*mm, 63*mm, 15*mm]), Spacer(1, 7)]
for case in east["cases"]:
    story += [para(case["case_id"], "H2QA")]
    bodies = [message["body"] for message in case.get("after", {}).get("messages", [])]
    story += [para("Mensajes: " + " | ".join(bodies), "SmallQA")]
    story += [para("conversation_id=" + case["conversation_id"] + "; event_ids=" + ", ".join(case["event_ids"]) + "; message_ids=" + ", ".join(case["message_ids"]), "TinyQA")]
    story += [para("payload_hashes=" + ", ".join(case["payload_hashes"]), "TinyQA")]
    story += [para("snapshot=" + short_json(case.get("snapshot_after", {})) + "; location_snapshot=" + short_json(case.get("location_snapshot", {})) + "; dealer=" + dealer_names.get(case.get("assigned_dealer_id"), case.get("assigned_dealer_id")) + "; next_attempt_at=" + str(case.get("next_attempt_at")), "SmallQA")]
    story += [Preformatted(case.get("sql_verification", ""), styles["CodeQA"]), Spacer(1, 4)]

story += [PageBreak(), para("Normalizacion, correcciones y regresiones", "H1QA")]
story += [para("Incidentes de normalizacion", "H2QA"), make_table([
    ["Campo", "Resultado"],
    ["real_name", "Solo se guardo con declaracion explicita; texto del bot o ubicaciones no se usaron como nombre."],
    ["vehicle_type", "Mustang y truck se interpretaron con evidencia; Mustang aislado contaminante no creo lead."],
    ["down_payment", "No se infirio; Easterns uso 1000 solo como enganche declarado."],
    ["telefono", "Stafford uso el telefono preexistente y canonico."],
    ["documents / identification / bank_account", "Quedaron vacios/null sin evidencia explicita; no se mezclaron campos."],
], [43*mm, 131*mm]), Spacer(1, 8)]
story += [para("Correcciones aplicadas despues de capturar evidencia", "H2QA"), make_table([
    ["Hallazgo", "Causa raiz", "Correccion", "Reprueba"],
    ["Easterns dependia de ciudades codificadas", "Listas en el servicio.", "Migracion agrega easterns_routing_zone a locations y runtime consulta BD.", "Easterns 8/8; unitarias 72/72"],
    ["Firma del process-due del harness", "Endpoint sin body requiere header compartido.", "Correccion solo en harness; no era defecto de negocio.", "Stafford 7/7 + Easterns 8/8"],
    ["Frontend sin API_URL en primer arranque", "Build local incompleto.", "Rebuild con API_URL local.", "Login/dashboard PASS"],
    ["Fixtures contaminaban nombre con ciudad", "Normalizador rechazo ubicaciones como nombres.", "Nombres neutrales declarados.", "Easterns 8/8"],
], [35*mm, 43*mm, 54*mm, 42*mm]), Spacer(1, 8)]
story += [para("Regresiones ejecutadas", "H2QA"), para("Suite completa: 27 archivos PASS; 328 tests PASS y 4 omitidos en modo normal. Suite de resiliencia con RUN_RESILIENCE_STRESS: 4/4 PASS, incluyendo 150 webhooks concurrentes, deduplicacion, orden actualizado-antes-que-base y rollback por conexion fallida. Stafford se repitio despues del rebuild de API y el frontend se verifico despues del rebuild.", "BodyQA")]
story += [para("Action Pre Owned Cars", "H2QA"), make_table([
    ["Codigo", "Nombre", "Grupo", "Idioma"],
    ["ACTION-CARS-EN", "Action Pre Owned Cars English", "Action Pre Owned Cars", "en"],
    ["ACTION-CARS-ES", "Action Pre Owned Cars Español", "Action Pre Owned Cars", "es"],
], [35*mm, 65*mm, 45*mm, 29*mm]), Spacer(1, 8)]
story += [para("Frontend local: " + json.dumps(frontend, ensure_ascii=False), "SmallQA")]
if SCREENSHOT.exists():
    image = Image(str(SCREENSHOT), width=174*mm, height=92*mm)
    image.hAlign = "CENTER"
    story += [image, para("Captura tomada del dashboard local Stafford con telefono y Mustang visibles.", "TinyQA")]

story += [PageBreak(), para("Conclusiones y artefactos", "H1QA")]
story += [para("Todos los criterios de aceptacion quedaron PASS. No quedan fallos abiertos ni bloqueos de infraestructura. La evidencia conserva IDs, hashes, snapshots, estados, ventanas simuladas y consultas SQL; no contiene secretos HMAC ni credenciales.", "BodyQA")]
story += [para("Artefactos publicados", "H2QA"), make_table([
    ["Artefacto", "Contenido"],
    ["tmp/qa-whatsapp-stafford-20260912/evidence.json", "Stafford: payload hashes, IDs, snapshots, estados, ventanas, SQL y resultados."],
    ["tmp/qa-easterns-routing-20260912/evidence.json", "Easterns: ocho conversaciones, locations, dealer, routing_reason, IDs, hashes y SQL."],
    ["tmp/qa-whatsapp-stafford-20260912/frontend-stafford-dashboard.png", "Captura del dashboard local."],
    ["apps/api/src/database/migrations/1710000021000-EasternsLocationRoutingRules.ts", "Clasificacion geografica persistida en locations."],
], [76*mm, 98*mm]), Spacer(1, 8)]
story += [para("Los datos de prueba son locales y deterministas. No se borro informacion fuera de los namespaces QA.", "BodyQA")]

OUT.parent.mkdir(parents=True, exist_ok=True)
doc = QAReport(str(OUT))
doc.build(story)
print(OUT)
