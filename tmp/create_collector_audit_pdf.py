from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor
from pathlib import Path

OUT = Path('output/pdf/collector-workflows-diagnostic-2026-09-05.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='CoverTitle', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=23, leading=28, textColor=HexColor('#123B3A'), alignment=TA_CENTER, spaceAfter=16))
styles.add(ParagraphStyle(name='CoverSub', parent=styles['Normal'], fontSize=11, leading=16, textColor=HexColor('#365B5A'), alignment=TA_CENTER, spaceAfter=8))
styles.add(ParagraphStyle(name='H1x', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=HexColor('#123B3A'), spaceBefore=8, spaceAfter=9))
styles.add(ParagraphStyle(name='H2x', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, leading=15, textColor=HexColor('#0D7772'), spaceBefore=8, spaceAfter=5))
styles.add(ParagraphStyle(name='Bodyx', parent=styles['BodyText'], fontSize=9.2, leading=13.2, spaceAfter=6))
styles.add(ParagraphStyle(name='Smallx', parent=styles['BodyText'], fontSize=7.7, leading=10.5, textColor=HexColor('#4A5A5A')))
styles.add(ParagraphStyle(name='CodeX', parent=styles['Code'], fontName='Courier', fontSize=7.3, leading=9.3, backColor=HexColor('#F2F6F5'), borderColor=HexColor('#D6E5E2'), borderWidth=.5, borderPadding=6, spaceBefore=4, spaceAfter=8))
styles.add(ParagraphStyle(name='Callout', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=10, leading=14, textColor=HexColor('#7A2800'), backColor=HexColor('#FFF1E8'), borderColor=HexColor('#F1B28C'), borderWidth=.7, borderPadding=8, spaceBefore=5, spaceAfter=8))

def P(text, style='Bodyx'):
    return Paragraph(text, styles[style])

def tbl(data, widths, header=True, small=False):
    converted = []
    for r, row in enumerate(data):
        converted.append([P(str(x), 'Smallx' if small or r > 0 else 'Bodyx') for x in row])
    t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), HexColor('#DDEDEA') if header else colors.white),
        ('TEXTCOLOR', (0,0), (-1,0), HexColor('#123B3A')),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), .35, HexColor('#B8CCC8')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, HexColor('#F7FAF9')]),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(HexColor('#D7E5E2'))
    canvas.line(0.55*inch, 0.46*inch, 7.95*inch, 0.46*inch)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(HexColor('#607371'))
    canvas.drawString(0.6*inch, 0.28*inch, 'DealerADMIN · Auditoría del recolector · 05-sep-2026')
    canvas.drawRightString(7.9*inch, 0.28*inch, f'Página {doc.page}')
    canvas.restoreState()

story = []
story += [Spacer(1, .65*inch), P('Auditoría del problema de los workflows recolectores', 'CoverTitle'), P('DealerADMIN · GHL · Backend · Neon · Evidencia de producción', 'CoverSub'), Spacer(1, .15*inch), P('Fecha de corte: 5 de septiembre de 2026 (America/Bogota). Los eventos de Neon se muestran en UTC cuando corresponde.', 'CoverSub'), Spacer(1, .35*inch), P('VEREDICTO', 'H2x'), P('El backend y el workflow disparador están funcionando y hay evidencia de webhooks procesados y georuteo. El problema prioritario está aguas arriba, en el workflow recolector: allí se pierde o no se expone correctamente la salida normalizada antes de que el disparador intente enviarla.', 'Callout'), Spacer(1, .25*inch), P('Este documento deja el diagnóstico para el próximo agente. La solución integral del recolector debe tratarse como prioridad máxima, tomando control de Chrome cuando sea necesario y corrigiendo el patrón en todos los dealers, no solo en el caso donde aparezca primero.', 'Bodyx'), PageBreak()]

story += [P('1. Alcance y dealers auditados', 'H1x'), P('Se revisaron los workflows recolectores y su relación con el backend para estas cuatro locations/dealers. Se mantuvo Advanced Builder y no se usó Test Workflow ni se crearon contactos falsos.', 'Bodyx'), tbl([
    ['Dealer / grupo', 'Location ID', 'Recolector', 'Estado observado'],
    ['Offlease Motors Fredericksburg', 'MyxWNKacThim798E8KC6', 'e1dce4d3-5f39-4253-8c1a-a33cfc6cc9a5', 'Publicado; anomalía crítica en los dos custom code'],
    ['Offlease Motors Fredericksburg 2', 'bAuMEQeH48xAtu9tAMFf', '4ea1b7d1-6140-46b5-8f28-861f93035cf1', 'Publicado; teléfono corregido y probado'],
    ['Offlease Motors Stafford', 'LiaoSID3nvAhad49ZpNJ', 'd746d406-fb54-42e2-8b0e-100c0775bf0a', 'Publicado; real_name y teléfono presentes'],
    ['Easterns Automotive Group', 'xN2LSSl62okzv9GnOJPU', '10c4c30e-3ee5-40b0-9dbb-defe7dfd66c4', 'Publicado; memoria de ubicación y georuteo'],
], [1.65*inch, 1.28*inch, 2.0*inch, 2.35*inch], small=True), Spacer(1, 10), P('Easterns incluye las sedes Laurel/Rosedale (Baltimore), Laurel y Sterling. La sede fuente GHL es Easterns; la sede final se resuelve por geolocalización y por la ubicación explícita capturada en la qualification memory.', 'Bodyx')]

story += [P('Diferencias entre los recolectores', 'H2x'), P('Operativamente los cuatro hacen lo mismo: reciben una respuesta/cambio de contacto, reúnen conversación, custom fields y qualification memory, normalizan la información, guardan los campos y dejan listo el workflow disparador. Las diferencias son de configuración y de negocio, no de objetivo:', 'Bodyx'), tbl([
    ['Workflow', 'Diferencia de configuración', 'Operación común'],
    ['Stafford', 'Incluye real_name y el guard adicional para WhatsApp: número no basta; exige vehículo en custom field y memory.', 'Recolectar → normalizar → guardar → permitir webhook solo si cumple.'],
    ['Fredericksburg', 'Versión con primary enlazado a AI Extract y fallback enlazado directamente al Custom Code; es donde se observó el retorno ausente.', 'Misma finalidad de persistir la calificación.'],
    ['Fredericksburg 2', 'Incluye condición de qualification_memory y dos salidas de normalización; tuvo discrepancia phone/current_phone.', 'Misma finalidad de persistir la calificación.'],
    ['Easterns', 'Añade location/city/zona para resolver sede y mantiene qualification_source; el backend consulta locations.', 'Misma finalidad, más georuteo de Easterns.'],
], [1.18*inch, 3.12*inch, 3.08*inch], small=True), Spacer(1, 7), P('Conclusión operacional: aunque cada dealer tiene nombres de nodos, índices de Custom Code y mappings distintos, el contrato final debe ser equivalente. Esa equivalencia hoy no está garantizada, y es la razón por la que una corrección aislada no basta.', 'Callout')]

story += [P('2. Flujo esperado y punto de ruptura', 'H1x'), tbl([
    ['Etapa', 'Responsabilidad', 'Resultado auditado'],
    ['1. Trigger', 'Customer Replied / Contact Changed en GHL', 'Activo y publicado en las cuatro locations.'],
    ['2. Recolección', 'Actualiza estado y espera qualification memory / datos de conversación', 'Aquí se observan ramas y versiones de código diferentes.'],
    ['3. Normalización', 'Custom Code principal o fallback', 'El resultado debe ser un objeto con teléfono, vehículo, memoria y banderas.'],
    ['4. Persistencia GHL', 'Update contact field / Save Normalized Qualification', 'Depende de que la salida del paso 3 exista y coincida con el mapeo.'],
    ['5. Disparador', 'Evalúa teléfono + vehículo/memoria y horario; llama webhook', 'Los logs y Neon muestran procesamiento cuando recibe payload válido.'],
    ['6. Backend', 'Valida, normaliza, persiste, georutea', 'Funciona con payload válido; bloquea payload incompleto.'],
], [1.25*inch, 2.85*inch, 3.18*inch], small=True), Spacer(1, 8), P('La separación es importante: un webhook procesado no demuestra que el recolector haya guardado correctamente los campos. El recolector es el productor del payload; el disparador y el backend son consumidores posteriores.', 'Bodyx')]

story += [PageBreak(), P('3. Anomalías encontradas por recolector', 'H1x'), P('Fredericksburg — problema crítico', 'H2x'), P('En el custom code principal <b>#1 Normalize Lead Qualification</b> y en <b>#3 Normalize Lead Qualification Fallback</b>, la fuente termina con la asignación de <font name="Courier">source</font> y no se observa un <font name="Courier">return { ... }</font> en el valor del editor. Sin retorno, GHL no entrega un objeto de salida confiable al siguiente paso.', 'Bodyx'), P('La rama principal de guardado además mapea vehículo, down payment, timeline, documentos e identificación desde <font name="Courier">workflow_ai_extract_data.1.*</font>, mientras que el teléfono se mapea desde <font name="Courier">custom_code.1.output.phone</font>. Si el custom code no retorna, el AI extract y el guardado reciben valores vacíos o inexistentes. El fallback mapea directamente desde <font name="Courier">custom_code.3.output.*</font>, pero también depende de un retorno válido.', 'Bodyx'), P('Hallazgo adicional: el guardado primario observado no incluye el campo <font name="Courier">bank_account</font>, mientras el fallback sí lo incluye. Hay una discrepancia real entre ramas.', 'Callout'), P('Fredericksburg 2 — discrepancia de input del teléfono', 'H2x'), P('El mapeo GHL incluía la propiedad <font name="Courier">phone → {{contact.phone}}</font>, pero la versión anterior del código solo leía <font name="Courier">inputData.current_phone</font>. Por ello, el dato existía en GHL y aun así la salida era <font name="Courier">phone: ""</font>. La expresión fue cambiada para priorizar <font name="Courier">inputData.phone</font> y ambas ramas fueron probadas en el editor con resultado exitoso.', 'Bodyx'), P('Riesgo pendiente de diseño: la rama F2 usa <font name="Courier">money(text)</font> sobre el texto completo. Un año, una cuota u otro número aislado puede interpretarse como down payment si no hay contexto explícito. También las salidas probadas no exponen <font name="Courier">qualification_source</font>, lo que dificulta distinguir memoria, custom fields o ambos.', 'Bodyx'), P('Stafford — estructura consistente, pero guard estricto', 'H2x'), P('Las ramas principal y fallback tienen mapeos para <font name="Courier">real_name → {{contact.real_name}}</font>, <font name="Courier">phone → {{contact.phone}}</font> y retornan el objeto. El workflow exige vehículo en custom field, vehículo en qualification memory y nombre real para el caso Stafford/WhatsApp. Esto evita enviar leads con solo número.', 'Bodyx'), P('Riesgo a vigilar: la lista de nombres inválidos contiene valores específicos como “Thu Chikitha Linda”. Un filtro así puede bloquear falsos nombres, pero también debe revisarse para no descartar accidentalmente una persona real. La regla debe basarse en señales de placeholder y no solo en una lista fija.', 'Bodyx'), P('Easterns — estructura correcta, dependencia de georuteo', 'H2x'), P('Las ramas principal y fallback tienen <font name="Courier">phone → {{contact.phone}}</font>, priorizan <font name="Courier">inputData.phone</font>, retornan el objeto y exponen <font name="Courier">qualification_source</font>. La prueba sintética con Sedan, trade-in, memoria completa, teléfono y BALTIMORE produjo <font name="Courier">qualification_complete: true</font> y teléfono E.164.', 'Bodyx'), P('La ubicación se conserva en qualification memory y el backend la usa para resolver Easterns. El guardado GHL auditado no persiste un custom field separado de ubicación; por tanto, si la memoria se pierde, el georuteo pierde su fuente principal.', 'Bodyx')]

story += [PageBreak(), P('4. Problemas transversales del código y del contrato', 'H1x'), tbl([
    ['Prioridad', 'Problema', 'Impacto'],
    ['P0', 'Dos implementaciones distintas: JavaScript embebido en GHL y TypeScript del backend.', 'Las mismas frases pueden normalizarse distinto; una corrección local no garantiza el mismo resultado en todos los dealers.'],
    ['P0', 'Fredericksburg tiene custom code sin retorno visible.', 'Los siguientes pasos no reciben objeto; los custom fields se guardan vacíos aunque la conversación/memoria tenga datos.'],
    ['P0', 'Mappings distintos entre primary y fallback.', 'Una rama guarda desde AI Extract, otra desde Custom Code; campos como bank_account no son simétricos.'],
    ['P1', 'Contrato LeadWebhookSchema exige lead.phone no vacío.', 'Un payload directo con teléfono solo en memoria falla antes de la persistencia si no pasa por el normalizador GHL.'],
    ['P1', 'CollectorOutput TypeScript no declara phone.', 'El input acepta teléfono, pero la salida tipada del normalizador no lo representa; el outbound lo resuelve por otra ruta.'],
    ['P1', 'Guard backend hasMinimumRoutingQualification recibe vehículo de custom field + memoria.', 'Es más estricto que una lectura únicamente de memory y debe mantenerse alineado con el alcance Stafford vs. demás dealers.'],
    ['P1', 'Parsing de montos sensible a números sin contexto en F2.', 'Años, códigos u otros números pueden convertirse en down payment y marcar una calificación falsa.'],
    ['P2', 'Aliases, idiomas y formatos no están centralizados en un solo contrato.', 'Trade-in, cambiar vehículo, hoy mismo, fechas y documentos pueden divergir entre ramas.'],
], [0.55*inch, 2.75*inch, 3.98*inch], small=True), Spacer(1, 10), P('La causa raíz operativa no es que el backend ignore la memoria. El backend ya recibe y normaliza memory cuando el payload llega; el problema es que el recolector no siempre produce una salida completa y coherente para que el disparador la envíe.', 'Callout'), P('Normalizaciones que deben mantenerse en una futura solución única', 'H2x'), P('<b>Teléfono:</b> buscar primero Contact.Phone, después aliases de teléfono y finalmente texto de conversación; aceptar formatos US comunes y emitir E.164. <b>Vehículo:</b> reconocer tipo, marca, modelo y año sin convertir campañas en vehículo. <b>Down payment:</b> distinguir efectivo, trade-in, trade-in + monto y evitar números de 10–15 dígitos. <b>Documentos:</b> separar identificación, ID/licencia/pasaporte y proof of income. <b>Compra:</b> hoy, hoy mismo, esta semana, este mes, en dos semanas, el otro mes y fechas expresas. <b>Nombre:</b> priorizar nombre real declarado por la persona en memory y descartar placeholders. <b>Easterns:</b> conservar ubicación y resolver Baltimore/Rosedale, Laurel o Sterling desde la BD.', 'Bodyx')]

story += [P('Especificaciones funcionales que no pueden quedar sueltas', 'H2x'), tbl([
    ['Dato / frase del lead', 'Normalización obligatoria', 'No hacer'],
    ['Trade in / trade-in / cambiar mi vehículo / cambio mi carro / mi auto como enganche', 'Marcar trade-in. Si hay dinero, guardar “monto + trade-in”; si no hay monto, guardar “trade-in”.', 'No tratarlo como texto libre ni perderlo por venir en español.'],
    ['1K / 2K / 3K, $1,500, 1500 de down, enganche, inicial, depósito', 'Convertir K a monto y conservar el valor como down_payment; soportar formatos con coma/punto.', 'No tomar un teléfono, año, ZIP o código como monto.'],
    ['Cash / contado / efectivo / paid in full', 'Guardar Cash como forma de pago/enganche según contrato.', 'No marcar down vacío si la persona dijo que paga de contado.'],
    ['Hoy / hoy mismo / ahora / de inmediato / ASAP / lo antes posible', 'Normalizar a purchase_timeline = today y usar envío inmediato si está dentro del horario.', 'No enviarlo a tres horas durante la ventana 3 a.m.–3 p.m.'],
    ['Esta semana / este mes / en 2 semanas / la próxima semana / el otro mes', 'Conservar la intención temporal normalizada y respetar las reglas de espera de tres horas fuera de horario.', 'No confundir “próximo mes” con “hoy”.'],
    ['ID / identificación / licencia / driver license / pasaporte', 'Marcar identification = yes o no según respuesta contextual.', 'No inferir yes por mencionar la pregunta del bot.'],
    ['Prueba de ingresos / comprobante / pay stub / bank statement', 'Marcar has_income_proof = yes o no y reflejarlo en documents.', 'No mezclarlo con identification.'],
    ['Cuenta bancaria / bank account', 'Marcar bank_account = yes o no con contexto de la respuesta.', 'No usar solamente la existencia de cualquier palabra “bank”.'],
    ['Marca y modelo: Toyota RAV4, Honda CR-V, etc.', 'Separar make, model, year si existe y siempre llenar vehicle_type/vehicle cuando la intención sea clara.', 'No dejar solo la marca si la persona dio modelo.'],
    ['Tipo: troca, truck, SUV, sedan/sedán, pickup, van', 'Mapear equivalentes español/inglés a una categoría consistente.', 'No perder “troca” por no ser una categoría literal en inglés.'],
    ['Nombre real en WhatsApp', 'Priorizar el nombre que el bot preguntó y que la persona declaró; guardarlo en real_name y memory cuando aplique.', 'No usar “.”, “Lead”, “WhatsApp”, “Facebook” u otro nombre técnico como persona.'],
    ['Ubicación Easterns: BALTIMORE, LAUREL, STERLING', 'Conservar location/city/zone en memory y consultar locations para sede final.', 'No mandar siempre a Laurel por defecto si hay ubicación explícita.'],
], [2.0*inch, 3.45*inch, 2.33*inch], small=True), Spacer(1, 7), P('El agente debe probar cada fila en español e inglés, aislada y combinada con las demás. La tabla es parte del contrato funcional y debe convertirse en pruebas automatizadas y pruebas reales controladas.', 'Bodyx')]

story += [PageBreak(), P('5. Evidencia real revisada', 'H1x'), P('Neon, consulta de eventos de las últimas 24 horas: 15 eventos visibles, todos con estado <b>processed</b>. Distribución por location: Easterns 9, Stafford 2, Fredericksburg 2 y Fredericksburg 2 3. Esto confirma que el backend y la recepción del webhook sí funcionan cuando el payload es válido.', 'Bodyx'), tbl([
    ['Evidencia', 'Resultado'],
    ['Eventos webhook por las cuatro locations', 'Todos procesados; no se observó un lote reciente atascado en pending/failed en la consulta auditada.'],
    ['Easterns real con Sedan y ubicación Baltimore', 'Procesado y visible en DealerADMIN; base Easterns Laurel, asignación final Easterns Rosedale por override/georuteo.'],
    ['Leads recientes con datos incompletos', 'Se mantuvieron bloqueados: el guard evitó enviar contactos con solo teléfono o sin vehículo/memoria suficiente.'],
    ['SMS', 'No se enviaron SMS durante esta auditoría.'],
    ['DealerADMIN', 'La cola mostró el lead Easterns en Rosedale y estados coherentes con Neon.'],
], [2.35*inch, 4.93*inch], small=True), Spacer(1, 10), P('La evidencia no autoriza a declarar el recolector perfecto: probar el webhook posterior no sustituye probar que cada rama del recolector guarda la salida normalizada en GHL. En particular, Fredericksburg requiere reparación y prueba end-to-end antes de cerrar.', 'Bodyx'), P('Leads reales no enviados', 'H2x'), P('Los contactos visibles revisados en Stafford, Fredericksburg, Fredericksburg 2 y Easterns tenían al menos una condición incompleta —teléfono nativo vacío, vehículo ausente o documentos/down/timeline no confirmados—. No se forzó su ingreso para evitar datos falsos o un envío indebido. El contacto real Easterns que sí llegó se verificó en la cola correcta.', 'Bodyx')]

story += [PageBreak(), P('6. Pruebas realizadas y límites', 'H1x'), tbl([
    ['Prueba', 'Resultado / límite'],
    ['F2 primary custom code', 'Exitosa con memoria completa, teléfono mapeado y qualification_complete true. No fue Test Workflow.'],
    ['F2 fallback custom code', 'Exitosa con trade-in + monto, memoria completa y teléfono normalizado.'],
    ['Easterns fallback custom code', 'Exitosa con Sedan, trade-in, BALTIMORE, memoria completa y teléfono normalizado.'],
    ['Stafford primary/fallback', 'Pruebas sintéticas previas exitosas para nombre real en memoria frente a placeholders, además de teléfono/vehículo.'],
    ['Fredericksburg primary/fallback', 'Auditoría estática encontró ausencia de return visible; no se ejecutó una nueva prueba porque se solicitó auditar, no corregir.'],
    ['Backend', '68 pruebas unitarias dirigidas pasaron; typecheck y git diff --check pasaron en la revisión previa.'],
    ['Producción', 'Neon confirmó eventos procesados; no se usaron contactos falsos ni se enviaron SMS.'],
], [2.05*inch, 5.23*inch], small=True), Spacer(1, 10), P('No se ejecutó GHL Test Workflow para evitar enrolamientos o mensajes reales. La prueba sintética de Custom Code valida el objeto aislado, pero no prueba por sí sola el encadenamiento completo Trigger → Collector → Update Contact Field → Routing Workflow → Webhook → Neon → DealerADMIN.', 'Callout'), P('Estado de publicación', 'H2x'), P('Los cuatro recolectores y los workflows disparadores auditados permanecen en Advanced Builder y publicados según la interfaz revisada. Las modificaciones de código del backend ya estaban publicadas en GitHub en los commits <font name="Courier">dcbad98</font>, <font name="Courier">eab7e28</font>, <font name="Courier">be16309</font> y <font name="Courier">c1115e9</font>. En esta fase de auditoría no se hizo un nuevo commit.', 'Bodyx')]

story += [PageBreak(), P('7. Prioridad máxima para el próximo agente', 'H1x'), P('Resolver totalmente el workflow recolector es la prioridad máxima. El próximo agente está autorizado a tomar control de Chrome/CUA, revisar GHL, Neon, logs y DealerADMIN, y debe corregir el patrón en todos los dealers y en todas las ramas, conservando Advanced Builder.', 'Callout'), tbl([
    ['Orden', 'Criterio de cierre obligatorio'],
    ['1', 'Unificar una sola lógica de normalización entre GHL y backend, o demostrar equivalencia con pruebas de contrato.'],
    ['2', 'Reparar y verificar que primary y fallback siempre hagan return de un objeto completo.'],
    ['3', 'Alinear cada mapping: message, qualification_memory, Contact.Phone, real_name y todas las salidas normalizadas.'],
    ['4', 'Probar combinaciones agresivas: solo memory, solo custom fields, ambos con vacíos, respuestas en español/inglés, “hoy mismo”, trade-in, trade-in + down, ID/licencia/pasaporte, proof of income, bank account, marca/modelo/año y números con formatos variados.'],
    ['5', 'Verificar Stafford: nombre real + teléfono + vehículo en custom field + vehículo en memory antes del webhook WhatsApp.'],
    ['6', 'Verificar Easterns: BALTIMORE/Rosedale, LAUREL y STERLING, consultando la BD y confirmando sede final.'],
    ['7', 'Usar leads reales controlados para la prueba final, sin SMS: revisar conversación, memory, custom fields, logs GHL, evento Neon y fila DealerADMIN.'],
    ['8', 'No cerrar hasta que un caso memory-only completo y un caso mixto custom+memory lleguen con teléfono, nombre, vehículo, calificación y dealer correctos.'],
], [0.45*inch, 6.83*inch], small=True), Spacer(1, 10), P('Mensaje operativo para el próximo agente: si aparece una anomalía en un dealer, no corregir únicamente ese workflow. Auditar y aplicar el mismo criterio en Offlease Motors Stafford, Offlease Motors Fredericksburg, Offlease Motors Fredericksburg 2 y Easterns Automotive Group, y después repetir las pruebas.', 'Bodyx'), P('Conclusión', 'H2x'), P('El sistema posterior al recolector tiene evidencia positiva: el backend valida y persiste payloads válidos, el webhook se procesa y Easterns georutea. La investigación debe concentrarse en por qué el recolector no entrega de forma determinista todos los datos. La solución debe ser end-to-end y verificable, no solo una edición visual del workflow.', 'Bodyx')]

story += [PageBreak(), P('8. Criterios de aceptación: recolector perfecto o casi perfecto', 'H1x'), P('El objetivo funcional es que el recolector complete todos los custom fields configurados y la qualification memory, sin importar si el dato nació en la conversación, en qualification memory, en un custom field o en una combinación de fuentes. Los campos no deben quedar vacíos cuando la conversación ya contiene la respuesta.', 'Callout'), tbl([
    ['Área', 'Criterio de aceptación verificable'],
    ['Cobertura de campos', 'Vehicle Type, Down Payment, Purchase Timeline, Documents, Identification, Bank Account, qualification_memory y Phone se llenan cuando existe evidencia suficiente. Stafford además llena real_name. Easterns conserva ubicación/zona para georuteo.'],
    ['Fuente', 'Cada salida identifica si proviene de custom_fields, qualification_memory, ambos o mensaje; no se sobreescribe un dato bueno con un vacío.'],
    ['Teléfono', 'Toda respuesta que contenga explícitamente un número de teléfono se normaliza a E.164 y se escribe en Contact.Phone; si GHL no lo reconoce como phone, el recolector lo recupera de la conversación/memory y lo entrega al backend.'],
    ['Vehículo', 'Reconoce tipo, marca, modelo, año, troca/truck, SUV, sedán/sedan, pickup y frases equivalentes; vehicle_type no se queda vacío si la persona dijo qué vehículo quiere.'],
    ['Pago', 'Distingue trade-in/cambiar vehículo, trade-in + efectivo, cash/contado y montos; nunca convierte un teléfono, año o código en down payment.'],
    ['Tiempo', 'Normaliza hoy, hoy mismo, ASAP, esta semana, este mes, en dos semanas, el otro mes, fechas y variantes en español/inglés.'],
    ['Documentos', 'Separa y conserva identificación/ID/licencia/pasaporte, prueba de ingresos y respuestas negativas sin convertir un “no” en “yes”.'],
    ['Guard Stafford', 'WhatsApp con teléfono no dispara si falta vehículo en custom field o en qualification memory; tampoco si falta real_name cuando esa regla esté activa.'],
    ['Easterns', 'BALTIMORE/Rosedale, LAUREL y STERLING se resuelven consultando locations en BD; la sede final coincide con la ubicación indicada.'],
    ['Integridad de ramas', 'Primary y fallback retornan el mismo contrato, tienen los mismos mappings y guardan los mismos campos.'],
    ['Cadena completa', 'Un caso válido se ve como Executed en GHL, processed en Neon y aparece una sola vez en DealerADMIN con el dealer correcto.'],
    ['Bloqueo', 'Un caso solo con teléfono, sin vehículo/memoria suficiente, no inserta leads en BD ni dispara webhook.'],
    ['Horarios', 'Se conservan las reglas existentes: durante 3:00 a.m.–3:00 p.m. se envía enseguida si está completo; fuera de horario se mantiene la espera de tres horas, sin alterar el comportamiento acordado.'],
], [1.35*inch, 5.93*inch], small=True), Spacer(1, 9), P('La aceptación requiere evidencia de los campos dentro de GHL, no únicamente un objeto correcto en una prueba aislada de Custom Code.', 'Bodyx')]

story += [PageBreak(), P('9. Mega prompt para el próximo agente', 'H1x'), P('Usa el siguiente prompt como instrucción de ejecución. Debe conservarse el alcance y no darse por terminado con una sola prueba positiva.', 'Bodyx'), P('Eres el agente responsable de resolver de forma integral el problema de los workflows recolectores de DealerADMIN. Tu prioridad máxima es que todos los custom fields configurados y qualification_memory se llenen correctamente y de forma consistente antes de que el workflow disparador envíe el webhook. Tienes autorización para tomar control de Chrome/CUA y revisar GHL, Neon, logs, conversaciones reales y DealerADMIN. Trabaja en Advanced Builder y no lo reemplaces. Audita y corrige en todos estos dealers: Offlease Motors Stafford, Offlease Motors Fredericksburg, Offlease Motors Fredericksburg 2 y Easterns Automotive Group. Si encuentras una anomalía en uno, revisa y aplica el mismo criterio en todos los demás workflows recolectores, con la excepción de reglas específicas de Stafford o Easterns que estén documentadas.', 'CodeX'), P('Primero inspecciona, sin asumir: triggers, ramas, condiciones, primary/fallback custom code, mappings de entrada y salida, Update Contact Field, AI Extract, Save Normalized Qualification, workflow disparador, logs de ejecución y estado publicado. Documenta el flujo exacto y conserva la diferencia entre la fuente custom fields, qualification memory, conversación y ambos. Luego construye o verifica un contrato único de salida. Debe incluir como mínimo: real_name cuando aplique, vehicle_type, make/model/year si existen, down_payment, trade-in, purchase_timeline, documents, identification, bank_account, qualification_memory, phone, qualification_source, qualification_complete y missing_qualification. Todo custom field que tenga evidencia debe quedar lleno; nunca reemplaces un dato válido por vacío.', 'CodeX'), P('Normaliza agresivamente español e inglés: teléfono US con formatos variados y salida E.164; “hoy”, “hoy mismo”, ASAP, esta semana, este mes, en dos semanas, el otro mes y fechas; trade-in, cambiar/cambio de vehículo, trade-in más down, cash/contado; ID, licencia, pasaporte, prueba/comprobante de ingresos y cuenta bancaria; marca, modelo, año, sedan/sedán, SUV, truck/troca, pickup y equivalentes. Rechaza placeholders de nombres y reconoce el nombre real declarado por la persona, especialmente en Stafford WhatsApp.', 'CodeX'), P('Implementa y verifica los guards: Stafford no puede enviar solo porque WhatsApp ya trae un número; debe existir teléfono, vehículo en custom field y vehículo en qualification memory, además del nombre real si la regla está activa. El backend debe aplicar el mismo guard, no insertar leads incompletos y normalizar cualquier teléfono recuperable. Para Easterns, la ubicación de la publicidad/conversación debe conservarse y resolverse mediante la tabla locations: Baltimore/Rosedale, Laurel o Sterling. No uses Laurel por defecto si existe una ubicación explícita.', 'CodeX'), P('Ejecuta pruebas por cada dealer y por cada rama primary/fallback: (1) todos los custom fields llenos; (2) solo qualification memory completa; (3) ambos con algunos custom fields vacíos; (4) teléfono solo en conversación; (5) teléfono en Contact.Phone; (6) nombre placeholder y nombre real en memory; (7) trade-in sin monto y trade-in + monto; (8) cada idioma; (9) cada variante de tiempo; (10) solo número para confirmar bloqueo; (11) Easterns con Baltimore, Laurel y Sterling. No uses SMS. No uses Test Workflow si puede enrolar o enviar mensajes. Con leads reales controlados, revisa conversación, GHL custom fields, qualification memory, logs del workflow disparador, Neon webhook_events y la fila final en DealerADMIN. Si llegan leads reales nuevos mientras ejecutas o después de publicar, detén el cierre, audita cada uno de esos leads, revisa conversación y memory contra los custom fields, identifica cualquier anomalía de guardado, normalización, routing o webhook, corrígela en todos los dealers afectados y vuelve a verificar la cadena completa.', 'CodeX'), P('No declares éxito por un HTTP 201 o por un custom code que devuelve un objeto. El criterio de cierre es end-to-end: todos los campos esperados llenos en GHL, rama correcta, webhook Executed, Neon processed, DealerADMIN visible una sola vez y sede Easterns correcta. Si falla, identifica la primera etapa que pierde el dato, corrige esa causa en todos los dealers, repite la matriz y documenta antes/después. Ejecuta tests unitarios, typecheck y pruebas de contrato del backend; publica los cambios de código en GitHub solo cuando estén verificados. Al final entrega un reporte detallado de anomalías, cambios, pruebas, evidencia y pendientes. No cierres hasta que el caso memory-only completo y el caso mixto custom+memory pasen.', 'CodeX'), P('Este prompt es deliberadamente explícito: la solución total del recolector es la prioridad máxima del siguiente agente y debe usar Chrome para corregir GHL cuando el problema sea de configuración, además de corregir el backend cuando exista una discrepancia.', 'Callout')]

doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=.55*inch, leftMargin=.55*inch, topMargin=.55*inch, bottomMargin=.62*inch, title='Auditoria del problema de los workflows recolectores')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
