from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
    PageBreak,
)


ROOT = Path(r"C:\dev\dealeradmin")
OUT = ROOT / "output" / "pdf" / "dealeradmin-cierre-workflows-y-pendientes-2026-08-31.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#12233F")
BLUE = colors.HexColor("#1E63D6")
TEAL = colors.HexColor("#0D8A83")
GOLD = colors.HexColor("#D8A63B")
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#667085")
LIGHT = colors.HexColor("#F4F7FB")
PALE_TEAL = colors.HexColor("#E9F7F5")
PALE_GOLD = colors.HexColor("#FFF7E5")
LINE = colors.HexColor("#D9E2F0")
WHITE = colors.white


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=9, leading=12, textColor=TEAL, tracking=1.3, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=27, leading=31, textColor=NAVY, alignment=TA_LEFT, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=11.5, leading=17, textColor=MUTED, spaceAfter=15,
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=18, leading=22, textColor=NAVY, spaceBefore=3, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=8, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.6, leading=14, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.1, leading=11, textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=8.4, leading=10, textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["Normal"], fontName="Helvetica",
    fontSize=8.2, leading=11, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableCellBold", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=8.2, leading=11, textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="BadgeDone", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=7.7, leading=9, textColor=TEAL, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="BadgePending", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=7.7, leading=9, textColor=GOLD, alignment=TA_CENTER,
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


class Rule(Flowable):
    def __init__(self, width=6.85 * inch, color=LINE, thickness=0.8, space=8):
        super().__init__()
        self.width = width
        self.color = color
        self.thickness = thickness
        self.space = space
        self.height = space

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


class WorkflowFlow(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 6.85 * inch
        self.height = 1.05 * inch

    def draw(self):
        c = self.canv
        boxes = [
            ("Lead entrante", BLUE),
            ("Condition", NAVY),
            ("Normalizar", TEAL),
            ("Guardar campos", GOLD),
        ]
        box_w = 1.42 * inch
        box_h = 0.48 * inch
        gap = (self.width - len(boxes) * box_w) / (len(boxes) - 1)
        y = 0.36 * inch
        c.setFont("Helvetica-Bold", 7.8)
        for i, (label, color) in enumerate(boxes):
            x = i * (box_w + gap)
            c.setFillColor(color)
            c.roundRect(x, y, box_w, box_h, 7, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.drawCentredString(x + box_w / 2, y + box_h / 2 - 3, label)
            if i < len(boxes) - 1:
                ax = x + box_w + 5
                c.setStrokeColor(MUTED)
                c.setLineWidth(1.2)
                c.line(ax, y + box_h / 2, ax + gap - 10, y + box_h / 2)
                c.setFillColor(MUTED)
                c.line(ax + gap - 10, y + box_h / 2, ax + gap - 16, y + box_h / 2 + 4)
                c.line(ax + gap - 10, y + box_h / 2, ax + gap - 16, y + box_h / 2 - 4)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.6)
        c.drawCentredString(self.width / 2, 0.08 * inch, "Advanced Builder - flujo recolector")


class DealerAdminDoc(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, pagesize=letter, leftMargin=0.82 * inch,
                         rightMargin=0.82 * inch, topMargin=0.72 * inch,
                         bottomMargin=0.62 * inch, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                      id="normal", leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=self._page)])

    def _page(self, canvas, doc):
        canvas.saveState()
        w, h = letter
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 0.16 * inch, w, 0.16 * inch, stroke=0, fill=1)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(doc.leftMargin, 0.36 * inch, "dealerADMIN | Cierre de workflows y siguientes pasos")
        canvas.drawRightString(w - doc.rightMargin, 0.36 * inch, f"{canvas.getPageNumber():02d}")
        canvas.restoreState()


def status_table(rows):
    data = [[P("ESTADO", "TableHead"), P("COMPONENTE", "TableHead"), P("DETALLE", "TableHead")]]
    for state, component, detail in rows:
        badge_style = "BadgeDone" if state == "COMPLETADO" else "BadgePending"
        data.append([P(state, badge_style), P(component, "TableCellBold"), P(detail, "TableCell")])
    table = Table(data, colWidths=[1.08 * inch, 1.54 * inch, 4.23 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("BACKGROUND", (0, 1), (0, -1), PALE_TEAL),
    ]))
    return table


def callout(title, text, bg=PALE_TEAL, border=TEAL):
    table = Table([[P(title, "TableCellBold"), P(text, "TableCell")]], colWidths=[1.55 * inch, 5.3 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LINEBEFORE", (0, 0), (0, -1), 4, border),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


story = []

# Cover
story.append(Spacer(1, 0.48 * inch))
story.append(P("INFORME DE CIERRE", "CoverKicker"))
story.append(P("dealerADMIN<br/>Workflows de captura y normalizacion", "CoverTitle"))
story.append(P("Resumen de implementacion, configuracion visible en HighLevel y plan de validacion con leads reales.", "CoverSub"))
story.append(Rule(width=6.85 * inch, color=GOLD, thickness=2, space=14))
cover_meta = Table([
    [P("FECHA", "Smallx"), P("ALCANCE", "Smallx"), P("ESTADO OPERATIVO", "Smallx")],
    [P("31 de agosto de 2026", "TableCellBold"), P("Easterns + 3 Offlease; Country Club excluido", "TableCellBold"), P("Publicado; pendiente de pruebas reales", "TableCellBold")],
], colWidths=[2.2 * inch, 2.45 * inch, 2.2 * inch])
cover_meta.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
    ("BACKGROUND", (0, 1), (-1, 1), WHITE),
    ("BOX", (0, 0), (-1, -1), 0.65, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story.append(cover_meta)
story.append(Spacer(1, 0.28 * inch))
story.append(P("Objetivo del cierre", "H2x"))
story.append(P("Dejar el recolector preparado para recibir leads desde HighLevel, interpretar respuestas libres y guardar los datos normalizados en los custom fields correspondientes. La etapa siguiente sera observar el comportamiento con leads reales y corregir unicamente lo que aparezca en esa evidencia.", "Bodyx"))
story.append(Spacer(1, 0.15 * inch))
story.append(callout("Decisión actual", "Los workflows ya fueron publicados y quedan en observación. No se declara éxito de producción hasta comprobar entradas reales, persistencia en custom fields y asignación correcta.", PALE_GOLD, GOLD))
story.append(Spacer(1, 0.28 * inch))
story.append(P("Alcance de cuentas", "H2x"))
story.append(P("- Easterns Automotive Group<br/>- Offlease Fredericksburg<br/>- Offlease Fredericksburg 2<br/>- Offlease Motors<br/><br/>Country Club queda fuera de este alcance.", "Bodyx"))

story.append(PageBreak())

# Completed
story.append(P("1. Lo que se hizo", "H1x"))
story.append(P("La base tecnica y la configuracion de captura quedaron preparadas para la etapa de validacion operativa.", "Bodyx"))
story.append(status_table([
    ("COMPLETADO", "Normalizador de leads", "Se implemento normalizacion de vehiculo, down payment, tiempo de compra, documentos, identificacion, prueba de ingresos y memoria de calificacion."),
    ("COMPLETADO", "Montos y respuestas", "Reconoce formatos como $1000, 1000, 1K y expresiones de contado; conserva respuestas utiles y evita perder contexto entre mensajes."),
    ("COMPLETADO", "Persistencia", "Se agrego la ruta para guardar los resultados en los custom fields del contacto, no solo mostrarlos en el workflow."),
    ("COMPLETADO", "Eliminacion de leads", "Se agrego eliminacion persistente de la base de datos con advertencia en modal; no queda limitada a ocultar el lead de la vista."),
    ("COMPLETADO", "Unificacion Offlease", "Se unificaron los registros/ruteo de Offlease Fredericksburg y Offlease Fredericksburg 2, incluyendo la migracion de produccion."),
    ("COMPLETADO", "Landing page", "Se agrego una representacion visual del workflow recolector. El rediseño visual de la landing con estilo mas sobrio queda para una fase posterior."),
    ("COMPLETADO", "Codigo y GitHub", "Los cambios de normalizacion fueron validados localmente y subidos al repositorio: github.com/juanfer93/dealeradmin."),
    ("COMPLETADO", "Publicacion GHL", "Los workflows dentro del alcance ya fueron publicados por el usuario y quedan listos para observacion con leads reales."),
]))
story.append(Spacer(1, 0.22 * inch))
story.append(PageBreak())
story.append(P("2. Configuracion del workflow recolector", "H1x"))
story.append(P("El workflow se trabajo en Advanced Builder y mantiene separado el workflow emisor existente, que ya funciona y se conserva sin cambios.", "Bodyx"))
story.append(WorkflowFlow())
story.append(Spacer(1, 0.1 * inch))
story.append(P("Cadena configurada: Customer Replied / Contact Changed -> Update contact field -> Condition -> Complete information -> Update contact field -> Normalize Lead Qualification -> Save Normalized Qualification.", "Smallx"))

fields = [
    [P("CAMPO", "TableHead"), P("ORIGEN / SIGNIFICADO", "TableHead")],
    [P("vehicle_type", "TableCellBold"), P("Vehiculo normalizado desde la respuesta del lead.", "TableCell")],
    [P("down_payment", "TableCellBold"), P("Monto normalizado; por ejemplo, 1K se guarda como 1000.", "TableCell")],
    [P("purchase_timeline", "TableCellBold"), P("Tiempo de compra normalizado: today, this week, this month, etc.", "TableCell")],
    [P("documents", "TableCellBold"), P("Resumen de identificacion y prueba de ingresos.", "TableCell")],
    [P("identification", "TableCellBold"), P("Respuesta sobre ID o licencia.", "TableCell")],
    [P("qualification_memory", "TableCellBold"), P("Memoria acumulada de los datos detectados.", "TableCell")],
    [P("easterns_dealer_selected", "TableCellBold"), P("Checkbox booleano exclusivo de Easterns: indica que se selecciono dealer/sede.", "TableCell")],
    [P("easterns_zone", "TableCellBold"), P("Campo exclusivo de Easterns para la ubicacion/zona; enlazado a Output.Easterns Zone.", "TableCell")],
]
field_table = Table(fields, colWidths=[2.05 * inch, 4.8 * inch], repeatRows=1)
field_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
    ("GRID", (0, 0), (-1, -1), 0.45, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(field_table)
story.append(Spacer(1, 0.18 * inch))
story.append(callout("Importante", "easterns_zone no se agrega a Offlease. Las demás subcuentas conservan su estructura actual; esta ubicación es una necesidad específica de Easterns.", PALE_TEAL, TEAL))

story.append(PageBreak())

# Pending
story.append(P("3. Lo que falta", "H1x"))
story.append(P("La siguiente fase es operativa y depende de observar entradas auténticas. No se reemplaza con una prueba sintética ni con el hecho de que el workflow aparezca guardado.", "Bodyx"))
pending = [
    [P("PASO", "TableHead"), P("ACCION", "TableHead"), P("CRITERIO DE EXITO", "TableHead")],
    [P("1", "TableCellBold"), P("Publicacion en HighLevel.", "TableCell"), P("Completado: los workflows ya fueron publicados.", "TableCell")],
    [P("2", "TableCellBold"), P("Dejar entrar leads reales y observarlos a medida que lleguen.", "TableCell"), P("El lead entra por el workflow esperado y conserva su conversación.", "TableCell")],
    [P("3", "TableCellBold"), P("Revisar custom fields y memoria de calificacion.", "TableCell"), P("Vehiculo, monto, timeline, documentos y memoria quedan persistidos con valores coherentes.", "TableCell")],
    [P("4", "TableCellBold"), P("Revisar asignacion/ruteo en el workflow principal.", "TableCell"), P("El lead llega al dealer correcto; Easterns respeta la seleccion de sede y la zona correspondiente.", "TableCell")],
    [P("5", "TableCellBold"), P("Corregir cualquier error que aparezca y repetir observacion.", "TableCell"), P("El mismo escenario queda reproducible y sin perdida de datos.", "TableCell")],
    [P("6", "TableCellBold"), P("Si las pruebas son exitosas, crear/configurar los dealers faltantes en dealerADMIN.", "TableCell"), P("Cada dealer queda registrado, unificado donde corresponde y listo para operacion.", "TableCell")],
]
pending_table = Table(pending, colWidths=[0.58 * inch, 2.52 * inch, 3.75 * inch], repeatRows=1)
pending_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
    ("GRID", (0, 0), (-1, -1), 0.45, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(pending_table)
story.append(Spacer(1, 0.25 * inch))
story.append(P("4. Puntos de control durante la prueba real", "H1x"))
story.append(P("Para cada lead observado conviene confirmar cuatro evidencias separadas:", "Bodyx"))
story.append(P("- Entrada: el lead se inscribe en el workflow correcto.<br/>- Interpretacion: el codigo identifica correctamente vehiculo, monto, tiempo y documentos aunque el lead use lenguaje libre.<br/>- Persistencia: los valores aparecen en el contacto y no solo en la ejecucion del workflow.<br/>- Operacion: el workflow emisor y la asignacion al dealer funcionan con el destino esperado.", "Bodyx"))
story.append(Spacer(1, 0.12 * inch))
story.append(callout("Regla de cierre", "Solo despues de ver resultados consistentes con leads reales se replica la configuracion final y se crean los dealers faltantes en dealerADMIN. Si aparece un error, primero se corrige y se vuelve a observar antes de declarar la fase lista.", PALE_GOLD, GOLD))
story.append(Spacer(1, 0.28 * inch))
story.append(P("5. Referencias de implementacion", "H1x"))
story.append(P("Repositorio: github.com/juanfer93/dealeradmin<br/>API desplegada: dealeradmin-api-eight.vercel.app<br/>Migracion aplicada: UnifyOffleaseFredericksburg1710000003000<br/>Ultimos cambios relevantes: normalizador de leads, endurecimiento de documentos/montos, unificacion Offlease, eliminacion persistente y diagrama del recolector.", "Smallx"))


doc = DealerAdminDoc(str(OUT), title="dealerADMIN - Cierre de workflows")
doc.build(story)
print(OUT)
