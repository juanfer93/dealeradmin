import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = 'C:\\dev\\dealeradmin';
const out = path.join(root, 'output', 'pdf', 'informe-recolector-qualification-memory-y-custom-fields-2026-09-08.pdf');
const img1 = 'C:\\Users\\Dell\\AppData\\Local\\Temp\\codex-clipboard-3a6f8edb-5265-4b3c-8687-05b08719b1ae.png';
const img2 = 'C:\\Users\\Dell\\AppData\\Local\\Temp\\codex-clipboard-a44d4874-08fb-4089-b577-2e601df003b6.png';

const dataUri = (file) => {
  if (!fs.existsSync(file)) return '';
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
};
const screenshot1 = dataUri(img1);
const screenshot2 = dataUri(img2);

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #243b53; background: #fff; font-size: 10.2pt; line-height: 1.38; }
.page { width: 210mm; min-height: 297mm; padding: 18mm 17mm 18mm; position: relative; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.top { border-top: 3px solid #087f7b; padding-top: 8px; }
.kicker { text-transform: uppercase; letter-spacing: 1.4px; font-weight: 700; color: #087f7b; font-size: 9pt; }
h1 { color: #102a43; font-size: 21pt; line-height: 1.12; margin: 7px 0 10px; }
h2 { color: #087f7b; font-size: 12.5pt; margin: 13px 0 6px; }
h3 { color: #102a43; font-size: 11pt; margin: 11px 0 5px; }
p { margin: 0 0 7px; }
.lead { font-size: 12pt; line-height: 1.45; color: #102a43; }
.muted { color: #627d98; font-size: 8.6pt; }
.callout { background: #e8f4f3; border-left: 4px solid #087f7b; padding: 9px 11px; margin: 9px 0; color: #102a43; }
.warn { background: #fff4e5; border-left-color: #b54708; }
.danger { background: #fff0f0; border-left-color: #b42318; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { border: 1px solid #d9e2ec; border-radius: 6px; padding: 9px 10px; background: #f7fafc; }
.card h3 { margin-top: 0; }
table { width: 100%; border-collapse: collapse; margin: 7px 0 10px; font-size: 8.5pt; line-height: 1.25; }
th { background: #087f7b; color: #fff; text-align: left; padding: 7px; font-weight: 700; }
td { border: 1px solid #d9e2ec; padding: 6px 7px; vertical-align: top; }
tr:nth-child(even) td { background: #f7fafc; }
ul { margin: 4px 0 8px 18px; padding: 0; }
li { margin: 3px 0; }
code { font-family: Consolas, monospace; font-size: 8.4pt; background: #edf3f8; padding: 1px 3px; }
.code { font-family: Consolas, monospace; background: #edf3f8; padding: 8px 10px; font-size: 8.7pt; line-height: 1.4; margin: 7px 0; }
.shot { display: block; width: 100%; max-height: 78mm; object-fit: contain; object-position: center; margin: 7px auto 3px; border: 1px solid #d9e2ec; }
.caption { color: #627d98; font-size: 8pt; text-align: center; margin-bottom: 5px; }
.source { font-size: 8pt; color: #486581; overflow-wrap: anywhere; margin: 2px 0; }
.source a { color: #087f7b; text-decoration: none; }
.footer { position: absolute; left: 17mm; right: 17mm; bottom: 8mm; border-top: 1px solid #d9e2ec; padding-top: 5px; color: #627d98; font-size: 7.6pt; display: flex; justify-content: space-between; }
.footer span:last-child { color: #087f7b; }
.small { font-size: 8.7pt; }
</style></head><body>

<section class="page"><div class="top">
<div class="kicker">Informe de decision | Workflow recolector</div>
<h1>Cuando el lead llega incompleto o contaminado</h1>
<p class="lead">Qualification memory, custom fields y la ruta segura hacia dealerADMIN</p>
<p class="muted">Fecha de corte: 8 de septiembre de 2026 | Alcance: Fredericksburg, Fredericksburg 2, Stafford y Easterns</p>
<div class="callout danger"><b>Problema central:</b> el disparador puede funcionar, pero el workflow recolector a veces no conserva toda la conversacion, mezcla valores y no guarda el telefono en <code>contact.phone</code>. Si el telefono queda solo en el texto, el workflow disparador que exige Phone no vacio no puede activarse correctamente.</div>
<h2>Respuesta ejecutiva</h2>
<p>Se comparan dos caminos: (A) tu propuesta de eliminar los custom fields de calificacion y usar una sola <code>qualification_memory</code> para luego producir JSON; y (B) una arquitectura hibrida basada en documentacion actual de HighLevel: transcript completo como evidencia, extraccion estructurada por schema, campos operativos limitados y normalizacion final en dealerADMIN.</p>
<div class="grid2">
<div class="card"><h3>Tu solucion</h3><p>Menos duplicacion y un solo lugar para el contexto. Puede funcionar si la memoria contiene realmente todo el transcript y si el JSON tiene un contrato estricto.</p></div>
<div class="card"><h3>Mi recomendacion</h3><p>Opcion B: mantener raw transcript, extraer JSON tipado, normalizar en backend y usar custom fields solo para indices y condiciones operativas.</p></div>
</div>
<div class="callout"><b>Recomendacion:</b> escoger la opcion hibrida. Incorpora tu idea de reducir duplicacion, pero no confunde un resumen mutable con la conversacion completa y hace obligatorio guardar el telefono antes de evaluar el trigger.</div>
</div><div class="footer"><span>dealerADMIN | no modifica workflows ni produccion</span><span>1</span></div></section>

<section class="page"><div class="top">
<div class="kicker">1. Diagnostico</div><h1>El fallo esta en la captura, no en la etiqueta Published</h1>
<p>Segun la correccion del usuario, todos los workflows estan <b>Published</b>. Este informe no afirma que alguno este Draft. Pero Published es un estado de configuracion: no demuestra que cada ejecucion escriba los valores correctos ni que la salida completa llegue a dealerADMIN.</p>
<h2>P0 - Regla obligatoria del telefono</h2>
<div class="callout danger"><b>Siempre que el cliente escriba un numero:</b> el recolector debe detectarlo, normalizarlo y escribirlo en el campo estandar <code>contact.phone</code> antes de que se evalue cualquier condicion del workflow disparador. Despues, el trigger puede seguir usando la condicion <code>contact.phone is not empty</code>. Si no pasa validacion, se conserva la evidencia y se bloquea el envio automatico; nunca se descarta silenciosamente.</div>
<table><tr><th>Sintoma</th><th>Lo que se ve</th><th>Causa probable en el recolector</th></tr>
<tr><td>Fredericksburg no saca toda la informacion</td><td>La cola muestra telefono en algunos leads, pero down, ID, documentos y tiempo quedan como no indicado.</td><td>Salida incompleta, mapeo asimetrico entre ramas, valor viejo o paso Normalize sin salida visible.</td></tr>
<tr><td>Easterns no envio un lead con numero</td><td>El numero estaba en la conversacion, pero no quedo como telefono util para la condicion.</td><td>No se detecto, normalizo y escribio <code>contact.phone</code> antes del trigger.</td></tr>
<tr><td>Informacion contaminada</td><td><code>20; vehicle: Suv; down payment: trade:in</code> aparece como memoria.</td><td>Texto libre tratado como hecho final, sin tipos, evidencia ni regla de null.</td></tr>
<tr><td>Carmen queda incompleta</td><td>La conversacion tiene mas datos que la memoria visible.</td><td>La memoria se comporta como resumen parcial o campo mutable, no como transcript append-only.</td></tr></table>
<div class="callout warn"><b>Segundo caso recien llegado - Fernando Gallegos, Fredericksburg:</b> el campo de vehiculo aparece contaminado con texto repetido: “camioneta para el down de ese auto”, “trade:in para el down de un Camaro”, frases duplicadas varias veces y tokens como <code>20EI</code>. Esto no es una simple respuesta incompleta: es una concatenacion/merge defectuoso que convierte el historial en un valor operativo inutil. El test de manana debe comprobar que cada mensaje se agrega una sola vez, que el vehiculo se separa del trade-in/down y que los tokens no se promueven a campos finales.</div>
<h2>Caso Carmen Sara Rivera</h2>
<p>La conversacion aportada contiene objecion de credito, ubicacion, intencion de comprar ya, identificacion valida y comprobante de ingresos. Tambien aparece una ciudad de Pennsylvania, Harrisburg, y el telefono <code>2232848722</code>. El valor visible de <code>qualification_memory</code> solo dice: <code>20; vehicle: Suv; down payment: trade:in</code>. La perdida del telefono y de varias respuestas es evidencia directa de una captura incompleta.</p>
</div><div class="footer"><span>dealerADMIN | diagnostico funcional</span><span>2</span></div></section>

<section class="page"><div class="top">
<div class="kicker">2. Evidencia y alcance</div><h1>Que sabemos y que aun debe probarse</h1>
<p>La memoria de auditorias anteriores aporta hipotesis tecnicas utiles. La correccion actual del usuario sobre Published se incorpora como estado vigente. La ejecucion real sigue siendo el criterio decisivo.</p>
<table><tr><th>Hallazgo previo util</th><th>Limite de esa evidencia</th></tr>
<tr><td>El backend/webhook ya tiene normalizacion para fusionar mensaje, historial y <code>qualification_memory</code>; evita valores vacios y telefonos usados como down payment.</td><td>Capacidad de codigo y pruebas locales no demuestra que el workflow entregue el input completo en cada dealer.</td></tr>
<tr><td>Se identificaron riesgos en Fredericksburg: bloques Normalize sin <code>return { ... }</code> visible y ramas primario/fallback no simetricas.</td><td>No se usa la observacion antigua de Draft como estado actual. Todos se consideran Published segun el usuario.</td></tr>
<tr><td>Fredericksburg 2 habia mostrado riesgo de priorizar <code>current_phone</code> en vez de <code>inputData.phone</code>.</td><td>El nombre del campo no prueba que el valor viajo; hay que revisar execution logs y valor final.</td></tr>
<tr><td>La secuencia esperada es trigger -> update -> complete information -> normalize -> AI -> save.</td><td>El orden correcto no evita overwrite, truncamiento, tipo incorrecto o salida desconectada.</td></tr></table>
<div class="callout"><b>Criterio de cierre:</b> no basta Published, Saved, HTTP 201 o una fila en dealerADMIN. Un lead real debe dejar transcript/memory, campos estructurados, <code>contact.phone</code> normalizado, <code>dealeradmin_send_now</code>, webhook, <code>processed</code> en Neon, dealer correcto y una sola fila en la cola.</div>
${screenshot1 ? `<img class="shot" src="${screenshot1}"><div class="caption">Figura 2. Evidencia aportada: cola con telefonos presentes pero calificaciones incompletas.</div>` : ''}
<h2>Lo que no se hara hoy</h2><p>No se modifican workflows, no se borran campos en produccion, no se envia SMS y no se fuerza un lead incompleto. Este PDF deja la decision preparada para manana.</p>
</div><div class="footer"><span>dealerADMIN | evidencia separada de hipotesis</span><span>3</span></div></section>

<section class="page"><div class="top">
<div class="kicker">3A. Cobertura obligatoria por workflow</div><h1>Un cambio comun, con diferencias que deben conservarse</h1>
<p>Los cambios deben implementarse en <b>todos</b> los workflows recolectores: Stafford, Fredericksburg, Fredericksburg 2 y Easterns Automotive Group. Eso no significa copiar la misma logica sin revisar el canal, los campos publicados y el routing de cada cuenta.</p>
<div class="callout danger"><b>Regla de implementacion:</b> mismo contrato de captura y normalizacion para todos; configuracion de salida y condiciones especificas por dealer. Una plantilla identica puede romper Stafford o enviar Easterns sin la ubicacion necesaria para asignar el dealer.</div>
<table><tr><th>Workflow / dealer</th><th>Diferencia que debe preservarse</th><th>Requisito para manana</th></tr>
<tr><td><b>Stafford</b></td><td>Solo maneja WhatsApp. No se debe asumir que la logica de SMS, Messenger u otro canal aplica igual.</td><td>El recolector debe publicar siempre el telefono normalizado y el tipo de vehiculo. Revisar que los disparadores ya condicionen Phone no vacio + tipo de vehiculo y que la salida sea compatible con WhatsApp.</td></tr>
<tr><td><b>Fredericksburg</b></td><td>Debe conservar la cobertura completa de respuestas y sus ramas primaria/fallback.</td><td>Aplicar la misma captura robusta; confirmar que Phone, vehiculo, memoria, fuentes y normalizados tengan mapeo simetrico en ambas ramas.</td></tr>
<tr><td><b>Fredericksburg 2</b></td><td>Debe usar el telefono dinamico mapeado, no un campo viejo o alterno.</td><td>Confirmar prioridad de <code>inputData.phone</code>, normalizar y escribir <code>contact.phone</code> antes del trigger.</td></tr>
<tr><td><b>Easterns Automotive Group</b></td><td>La conversacion pregunta la ubicacion para que dealerADMIN asigne el dealer.</td><td>Conservar el custom field de ubicacion y tambien la ubicacion dentro del raw/JSON. No borrar ese campo: es parte del routing y debe viajar al webhook.</td></tr></table>
<h2>Revision de los disparadores</h2>
<ul><li>Revisar, no asumir, que Stafford tenga la condicion de Phone no vacio y tipo de vehiculo antes de publicar/enviar por WhatsApp.</li><li>Revisar que Easterns no dependa solo de Phone: la ubicacion debe estar disponible para el routing de dealerADMIN.</li><li>Revisar los cuatro workflows y sus ramas primary/fallback con el mismo contrato de captura, pero respetando las diferencias de canal y dealer.</li><li>Probar que el telefono se escriba primero en <code>contact.phone</code>; despues deben evaluarse las condiciones especificas del disparador.</li></ul>
<div class="callout"><b>Decision:</b> se estandariza la captura; no se estandarizan a ciegas los disparadores. Stafford necesita Phone + tipo de vehiculo para WhatsApp. Easterns necesita Phone + ubicacion para routing. Estas diferencias son intencionales y deben quedar visibles en la configuracion final.</div>
</div><div class="footer"><span>dealerADMIN | cobertura multi-workflow</span><span>4</span></div></section>

<section class="page"><div class="top">
<div class="kicker">3. Opcion A</div><h1>Tu propuesta: solo qualification memory</h1>
<p>Eliminar los custom fields usados para calificacion, guardar toda la conversacion en <code>qualification_memory</code>, hacer que ese contenido identifique cada dato y producir un JSON con la conversacion completa y la informacion detectada. dealerADMIN normaliza el resultado.</p>
<div class="code">Conversacion completa -> qualification_memory -> interpretacion -> JSON completo + datos -> webhook -> normalizacion dealerADMIN -> persistencia/routing</div>
<table><tr><th>Ventajas</th><th>Riesgos que deben resolverse</th></tr>
<tr><td>Un solo lugar visible para contexto y menos duplicacion.</td><td>La Conversation Memory de HighLevel se documenta como rolling summary opcional; no debe asumirse que es el transcript completo.</td></tr>
<tr><td>El backend conserva la autoridad para normalizar y re-procesar.</td><td>Un <i>Si</i> puede quedar sin la pregunta a la que responde; el modelo podria asociarlo al ID, documentos o ingresos equivocados.</td></tr>
<tr><td>Reduce discrepancias entre muchos campos escritos por acciones distintas.</td><td>Borrar campos puede romper condiciones, Phone, reportes o Skip if Already Filled que aun dependan de ellos.</td></tr>
<tr><td>Puede ser limpio si el JSON es versionado y trazable.</td><td>Si memory se sobrescribe o se resume, se pierde la evidencia que el backend necesita para corregir el dato.</td></tr></table>
<h2>Condiciones para que A sea segura</h2><ul><li><code>qualification_memory</code> no puede ser un resumen rolling; debe existir un transcript raw completo y append-only.</li><li>El JSON debe tener schema, tipos, null explicito, fuente del dato y evidencia del mensaje.</li><li>El telefono debe pasar primero por normalizacion y escribirse siempre en <code>contact.phone</code>.</li><li>Una respuesta ambigua debe quedar como <code>ambiguous</code>, no convertirse en un hecho inventado.</li><li>Antes de borrar campos hay que inventariar cada condicion, reporte y workflow que los usa.</li></ul>
<div class="callout warn"><b>Veredicto:</b> tu enfoque va en la direccion correcta al atacar la duplicacion, pero “solo memory” es demasiado fragil si memory es un texto mutable o un resumen. Lo usaria como parte del diseño, no como unica fuente.</div>
</div><div class="footer"><span>dealerADMIN | opcion propuesta por el usuario</span><span>5</span></div></section>

<section class="page"><div class="top">
<div class="kicker">4. Opcion B | investigacion web</div><h1>Arquitectura hibrida recomendada</h1>
<p>La documentacion actual de HighLevel separa transcript, summary, output JSON, field mapping y Update Contact Field. La solucion usa esas piezas con una frontera clara: HighLevel captura y extrae; dealerADMIN valida, normaliza y enruta.</p>
<table><tr><th>Capa</th><th>Que hace</th><th>Regla de seguridad</th></tr>
<tr><td>1. Raw evidence</td><td>Guarda transcript completo: mensajes, direccion, timestamp, canal y contacto.</td><td>Append-only o inmutable. No decide el envio directamente.</td></tr>
<tr><td>2. Extraction</td><td>AI Extract Data o AI Agent devuelve JSON tipado: telefono, nombre, vehiculo, down, trade-in, ID, comprobante, tiempo, ciudad, estado, ZIP, fuente y confianza.</td><td>Schema, descripcion por campo, null si no hay evidencia.</td></tr>
<tr><td>3. Phone gate</td><td>Detecta cualquier numero del mensaje, normaliza formato y actualiza <code>contact.phone</code>.</td><td>Debe ocurrir antes de evaluar el trigger. Si es invalido, bloquea y registra evidencia.</td></tr>
<tr><td>4. Operational fields</td><td>Conserva solo indices utiles para filtros, routing, Skip if Already Filled y <code>dealeradmin_send_now</code>.</td><td>Se actualizan desde JSON validado, no desde texto suelto.</td></tr>
<tr><td>5. Backend authority</td><td>dealerADMIN recibe raw + JSON, normaliza tipos, valida completitud, aplica routing, idempotencia y persistencia.</td><td>El webhook no confia en campos contaminados ni en dealer_name libre.</td></tr></table>
<h2>Interpretacion segura</h2>
<table><tr><th>Entrada</th><th>Resultado esperado</th></tr>
<tr><td><code>Si</code></td><td>Se vincula a la pregunta activa anterior. Si hay dos preguntas posibles, se guarda evidencia y <code>ambiguous</code>.</td></tr>
<tr><td><code>Quiero comprar ya</code></td><td><code>purchase_timeline = immediate</code>; nunca down payment.</td></tr>
<tr><td><code>20</code></td><td>No es down payment sin etiqueta down, down payment, enganche o inicial.</td></tr>
<tr><td><code>2232848722</code></td><td>Se normaliza como telefono si cumple formato y procede del cliente/campo Phone; se escribe en <code>contact.phone</code>.</td></tr></table>
<div class="callout"><b>Por que B es mejor:</b> conserva evidencia para auditar, evita que un resumen sea la unica verdad, hace el JSON re-procesable y conserva custom fields donde realmente ayudan a operar el trigger y la cola.</div>
</div><div class="footer"><span>dealerADMIN | opcion recomendada</span><span>6</span></div></section>

<section class="page"><div class="top">
<div class="kicker">5. Investigacion y decision</div><h1>La documentacion actual respalda la opcion B</h1>
<p>La busqueda se hizo el 8 de septiembre de 2026. Se priorizaron fuentes oficiales de HighLevel para evitar basar la decision en tutoriales que puedan describir otra version de la interfaz. La investigacion no produjo una URL de YouTube oficial, fechada y suficientemente especifica; por eso la alternativa web se apoya en documentacion primaria actual.</p>
<table><tr><th>Documento oficial</th><th>Aplicacion al problema</th></tr>
<tr><td>AI Extract Data Workflow Action</td><td>Convierte texto no estructurado en campos estructurados para pasos posteriores; permite definir nombre, tipo y descripcion.</td></tr>
<tr><td>Conversation Summary and Transcript</td><td>Distingue summary de transcript. El transcript es el registro mas completo y debe enviarse explicitamente al workflow si se quiere guardar.</td></tr>
<tr><td>AI Agent Action</td><td>Conversation Memory es un rolling summary opcional. El output JSON existe como formato estructurado y debe conectarse a pasos posteriores.</td></tr>
<tr><td>Bot Goals / Update Contact Field</td><td>El mapeo de cada pregunta a un campo es explicito. Si no se mapea, la respuesta puede no actualizar el campo esperado; los tipos deben coincidir.</td></tr>
<tr><td>Custom Fields</td><td>Los campos tienen tipos y niveles; deben crearse antes de usarse y sus valores deben respetar el tipo.</td></tr></table>
<h2>Decision</h2>
<table><tr><th>Criterio</th><th>A: solo memory</th><th>B: hibrida</th></tr>
<tr><td>Transcript completo</td><td>Solo si se implementa aparte.</td><td>Si, como raw evidence separado.</td></tr>
<tr><td>Telefono para envio</td><td>Puede perderse en un resumen.</td><td>Se detecta, normaliza y escribe antes del trigger.</td></tr>
<tr><td>Contaminacion</td><td>Depende mucho del prompt.</td><td>Schema + tipos + null + reglas backend.</td></tr>
<tr><td>Operacion</td><td>Menos campos, mas responsabilidad en IA.</td><td>Indices operativos limitados y auditables.</td></tr>
<tr><td>Recomendacion</td><td>Usarla como componente.</td><td><b>Escogerla.</b></td></tr></table>
<h2>Fuentes consultadas</h2>
<p class="source">HighLevel - Update Contact Field: <a href="https://help.gohighlevel.com/support/solutions/articles/155000002688-workflow-action-update-contact-field">help.gohighlevel.com/.../update-contact-field</a></p>
<p class="source">HighLevel - AI Extract Data: <a href="https://help.gohighlevel.com/support/solutions/articles/155000007992-workflow-action-ai-extract-data">help.gohighlevel.com/.../ai-extract-data</a></p>
<p class="source">HighLevel - Conversation Summary and Transcript: <a href="https://help.gohighlevel.com/support/solutions/articles/155000006597">help.gohighlevel.com/.../conversation-summary-transcript</a></p>
<p class="source">HighLevel - AI Agent Action: <a href="https://help.gohighlevel.com/support/solutions/articles/155000007600-workflow-action-ai-agent">help.gohighlevel.com/.../workflow-action-ai-agent</a></p>
<p class="source">HighLevel - Bot Goals / field mapping: <a href="https://help.gohighlevel.com/support/solutions/articles/155000004095-bot-goals-feature-complete-guide">help.gohighlevel.com/.../bot-goals</a></p>
<p class="source">HighLevel - Custom Fields: <a href="https://help.gohighlevel.com/support/solutions/articles/155000008031-how-to-use-custom-fields">help.gohighlevel.com/.../custom-fields</a></p>
</div><div class="footer"><span>dealerADMIN | fuentes verificadas en la fecha de corte</span><span>7</span></div></section>

<section class="page"><div class="top">
<div class="kicker">6. Plan de solucion</div><h1>Lo que debe ocurrir manana</h1>
<p>La prioridad no es escoger un nombre de campo: es hacer que ningun telefono ni respuesta se pierda entre conversacion, recolector y trigger.</p>
<ol><li>Congelar cambios en los cuatro workflows y capturar un execution log por dealer. No borrar campos antes de revisar dependencias.</li><li>Definir el contrato JSON: transcript, campos, tipos, null, evidencia por campo, confianza, version y estado de completitud.</li><li>Implementar la regla P0: numero detectado -> normalizacion -> escritura en <code>contact.phone</code> -> evaluacion del trigger.</li><li>Probar Carmen y un caso Easterns con telefono ya escrito; repetir Fredericksburg, Fredericksburg 2 y Stafford.</li><li>Verificar cada salida: telefono, nombre, vehiculo, down, trade-in, ID, comprobante, timeline, ciudad/estado/ZIP, memory y transcript.</li><li>Validar dealerADMIN: payload completo, normalizacion, routing, idempotencia, <code>processed</code> en Neon y una sola fila correcta.</li><li>Solo despues retirar campos que no tengan funcion. Conservar los que sean necesarios para Phone, condiciones, routing, reportes o trazabilidad.</li></ol>
<h2>Matriz minima de aceptacion</h2>
<table><tr><th>Caso</th><th>Debe pasar</th><th>Bloquea si...</th></tr>
<tr><td>Telefono en mensaje</td><td>Se normaliza y queda en <code>contact.phone</code> antes del trigger.</td><td>La conversacion tiene numero pero Phone queda vacio.</td></tr>
<tr><td>Respuesta Si a ID/documentos</td><td>Se enlaza con la pregunta activa y se guarda con evidencia.</td><td>Se marca sin contexto o se pierde.</td></tr>
<tr><td>Numero 20</td><td>No se convierte en down payment sin etiqueta.</td><td>Se guarda como down por inferencia.</td></tr>
<tr><td>Informacion parcial</td><td>Se conserva raw y se marca lo faltante.</td><td>Se fuerza lead completo o se inventan valores.</td></tr>
<tr><td>Texto repetido / concatenado</td><td>Cada mensaje aparece una sola vez y los campos se separan por significado.</td><td>El vehiculo contiene frases duplicadas, <code>20EI</code> o mezcla de trade-in/down.</td></tr>
<tr><td>Lead repetido</td><td>Merge/idempotencia sin duplicar ni borrar un estado enviado.</td><td>Aparecen dos filas o se pierde el telefono.</td></tr></table>
<div class="callout"><b>Conclusion:</b> el problema descrito es coherente con una frontera de captura defectuosa: el trigger puede estar Published y aun asi recibir Phone vacio o informacion contaminada. La solucion mas segura es transcript completo + JSON con schema + Phone gate obligatorio + normalizacion final en dealerADMIN, usando custom fields solo donde aporten una funcion operativa comprobable.</div>
<p class="muted">Documento preparado para decidir el cambio de enfoque. No representa una prueba live ni una autorizacion para editar cuentas externas.</p>
</div><div class="footer"><span>dealerADMIN | criterio de cierre end-to-end</span><span>8</span></div></section>

</body></html>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\Dell\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log(out);
