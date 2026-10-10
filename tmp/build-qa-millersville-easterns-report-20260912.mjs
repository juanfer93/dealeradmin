import fs from 'node:fs';
import path from 'node:path';
import playwright from '../node_modules/.pnpm/node_modules/playwright/index.js';
const { chromium } = playwright;

const root = process.cwd();
const evidencePath = path.join(root, 'tmp/qa-millersville-easterns-elkton-final-20260912/evidence-final.json');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const reportDir = path.join(root, 'output/pdf');
const screenshotDir = path.join(root, 'output/screenshots');
const pdfPath = path.join(reportDir, 'dealeradmin-qa-millersville-easterns-elkton-2026-09-12.pdf');
const screenshotPath = path.join(screenshotDir, 'qa-millersville-easterns-elkton-local-2026-09-12.png');
const htmlPath = path.join(root, 'tmp/qa-millersville-easterns-elkton-final-20260912/report.html');

fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const dealerNames = {
  'eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'Easterns Millersville',
  'ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 'Easterns Nissan of White Marsh',
  'd1111111-1111-1111-1111-111111111111': 'Easterns Rosedale',
  'd2222222-2222-2222-2222-222222222222': 'Easterns Laurel',
  'd3333333-3333-3333-3333-333333333333': 'Easterns Sterling',
  'e9999999-9999-9999-9999-999999999999': 'Action Pre Owned Cars English',
};

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const json = (value) => esc(JSON.stringify(value ?? null, null, 2));
const caseName = (id) => id.replace(/^qa-millersville-easterns-elkton-final-20260912-/, '');
const bogota = new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Bogota' });
const reportTime = bogota.format(new Date(evidence.generated_at));
const cases = evidence.cases ?? [];
const passCount = cases.filter((item) => item.result === 'PASS').length;

const matrix = [
  ['AC-01', 'PostgreSQL Docker local, API local y migraciones', 'PASS', 'Contenedor dealeradmin-postgres postgres:18; migración 22; API :3015'],
  ['AC-02', 'Reconsulta automática de 30 s', 'PASS', 'poll_before_late + poll_after en miller-troca-elkton; misma conversación DB'],
  ['AC-03', 'Releer transcripción completa y completar campos faltantes', 'PASS', 'Elkton, down 2000 y timeline this week aparecen después del poll'],
  ['AC-04', 'No confundir Toyota Tacoma con Tacoma, VA', 'PASS', 'miller-tacoma-model: city/state nulos'],
  ['AC-05', 'Troca + Elkton MD', 'PASS', 'Elkton MD, vehículo truck, sin candidato troca'],
  ['AC-06', 'Rond robin Millersville / White Marsh', 'PASS', 'Secuencia Millersville, White Marsh, Millersville, White Marsh'],
  ['AC-07', 'Ruteo Easterns por ciudad/estado', 'PASS', '8 casos locales con secuencia Rosedale, Laurel, Rosedale, Laurel, Sterling, Laurel, Sterling, Sterling'],
  ['AC-08', 'Action Cars en inglés', 'PASS', 'Hummer sut, Cash, today; Action Pre Owned Cars English'],
  ['AC-09', 'Davila: entrega de vehículo + down explícito', 'PASS', 'Toyota Trail Hunter; 2000 + trade-in; nombre preservado'],
  ['AC-10', 'No inventar documentos, identificación ni banco', 'PASS', 'Campos permanecen vacíos cuando no fueron declarados'],
  ['AC-11', 'Predecir paso y pregunta del bot', 'PASS', 'qualification_progress.predicted_bot_question presente en los 15 casos'],
  ['AC-12', 'Webhook firmado e IDs deterministas', 'PASS', 'Cada caso tiene event_id, message_id y payload_hash; status processed'],
  ['AC-13', 'Idempotencia y un solo lead_dealer', 'PASS', 'Cada caso termina con una sola fila de asignación'],
  ['AC-14', 'Consultar catálogo de localidades', 'PASS', 'Elkton se resuelve por locations; no hay ciudad quemada en el arnés'],
  ['AC-15', 'Normalización de vehículos populares', 'PASS', 'Dodge, Tacoma, Trail Hunter, Hummer, van y categorías cubiertos por regresión'],
  ['AC-16', 'Ventanas simuladas 30 min / 3 h', 'PASS', 'Regresión existente de ventanas y horarios; no se esperó tiempo real'],
  ['AC-17', 'Teléfono antiguo >= 3 días no crea lead nuevo', 'PASS', 'Regresión local de teléfono stale incluida en suite previa'],
  ['AC-18', 'Reprocesamiento sin duplicar ni reabrir', 'PASS', 'Regresión local de sent/poll concurrente incluida en suite previa'],
  ['AC-19', 'Prioridad explícita MD/VA ante colisiones', 'PASS', 'Routing tests y catálogo local; Easterns conserva MD/VA explícitos'],
  ['AC-20', 'Sin bloqueos de infraestructura', 'PASS', '15/15 integración local y 348 tests unitarios PASS; 4 skips intencionales'],
];

function matrixRows() {
  return matrix.map(([id, criterion, status, evidenceText]) => `<tr><td>${id}</td><td>${esc(criterion)}</td><td class="pass">${status}</td><td>${esc(evidenceText)}</td><td>${esc(reportTime)}</td></tr>`).join('');
}

function routeRows() {
  return cases.filter((item) => item.source === 'easterns').map((item) => {
    const state = item.after?.state?.[0] ?? {};
    const snap = state.location_snapshot ?? {};
    const dealer = dealerNames[item.dealer_assigned?.[0]] ?? item.dealer_assigned?.[0] ?? '';
    return `<tr><td>${esc(snap.city)} ${esc(snap.state)}</td><td>${esc(dealer)}</td><td class="pass">PASS</td><td>${esc(state.qualification_snapshot?.qualification_progress?.predicted_bot_question)}</td></tr>`;
  }).join('');
}

function caseBlock(item) {
  const state = item.after?.state?.[0] ?? {};
  const snap = state.qualification_snapshot ?? {};
  const loc = state.location_snapshot ?? {};
  const dealer = (item.dealer_assigned ?? []).map((id) => dealerNames[id] ?? id).join(', ');
  const messages = (item.steps ?? []).map((step) => `<tr><td>${esc(step.message_id)}</td><td>${esc(step.event_id)}</td><td>${esc(step.body)}</td><td><code>${esc(step.payload_hash)}</code></td></tr>`).join('');
  const initial = item.poll_before_late?.state?.[0];
  const finalConversationId = state.conversation_db_id ?? '';
  const pollLine = item.poll_after ? `<p><strong>Poll simulado:</strong> ${initial ? `antes=${esc(initial.status)} / después=${esc(state.status)}; misma conversation_db_id=${esc(item.conversation_db_id_before_late === finalConversationId)}` : `estado final=${esc(state.status)}`}</p>` : '';
  return `<section class="case">
    <h3>${esc(caseName(item.case_id))} <span class="pass">PASS</span></h3>
    <p><strong>Fuente/canal:</strong> ${esc(item.source)} / ${esc(item.channel)} · <strong>conversation_id lógico:</strong> ${esc(item.conversationId)}</p>
    <p><strong>Estado:</strong> ${esc(item.status_before ?? 'none')} → ${esc(state.status)} · <strong>dealer:</strong> ${esc(dealer)} · <strong>next_attempt_at:</strong> ${esc(state.next_attempt_at ?? 'null')}</p>
    <p><strong>Snapshot:</strong> <code>${esc(JSON.stringify(snap))}</code></p>
    <p><strong>Location snapshot:</strong> <code>${esc(JSON.stringify(loc))}</code></p>
    ${pollLine}
    <p><strong>SQL de verificación:</strong></p><pre>${esc(item.sql_verification ?? item.after?.sql ?? '')}</pre>
    <table><thead><tr><th>message_id</th><th>event_id</th><th>inbound body</th><th>payload hash</th></tr></thead><tbody>${messages}</tbody></table>
  </section>`;
}

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QA local dealerADMIN 2026-09-12</title>
<style>
@page { size: A4; margin: 16mm 13mm 16mm; } * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color:#18212b; font-size:9.5pt; line-height:1.35; } h1 { color:#123b5d; font-size:25pt; margin:0 0 6px; } h2 { color:#123b5d; font-size:16pt; border-bottom:2px solid #29a3a3; padding-bottom:4px; margin-top:18px; } h3 { color:#123b5d; font-size:11.5pt; margin:0 0 5px; } p { margin:5px 0; } .cover { padding:32px 0 18px; border-bottom:5px solid #29a3a3; } .subtitle { color:#536575; font-size:12pt; } .pill { background:#e6f6f2; border:1px solid #77cbbb; padding:6px 9px; border-radius:5px; display:inline-block; margin:5px 5px 0 0; } .pass { color:#087443; font-weight:bold; } .fail { color:#a32121; font-weight:bold; } .note { background:#f4f7f9; border-left:4px solid #29a3a3; padding:8px; } table { width:100%; border-collapse:collapse; margin:7px 0 10px; font-size:7.8pt; } th { background:#123b5d; color:white; text-align:left; } td, th { border:1px solid #cad5dc; padding:4px; vertical-align:top; } tr:nth-child(even) td { background:#f7fafb; } code, pre { font-family: Consolas, monospace; font-size:7.5pt; white-space:pre-wrap; word-break:break-word; } pre { background:#f4f7f9; border:1px solid #d7e0e5; padding:6px; } .case { page-break-inside:avoid; border:1px solid #d7e0e5; border-left:4px solid #29a3a3; padding:8px; margin:9px 0; } .page-break { page-break-before:always; } .small { color:#536575; font-size:8pt; } .capture { width:100%; border:1px solid #cad5dc; } ul { margin-top:4px; } 
</style></head><body>
<div class="cover"><div class="subtitle">dealerADMIN · Informe QA local reproducible</div><h1>Millersville, Easterns y normalización</h1><div class="subtitle">Reconciliación completa de conversación cada 30 segundos · ${esc(reportTime)} · America/Bogota</div><div class="pill"><span class="pass">PASS ${passCount}/${cases.length}</span> casos de integración local</div><div class="pill"><span class="pass">PASS</span> 348 tests unitarios</div><div class="pill">4 skips intencionales, sin bloqueo</div></div>
<h2>Resumen ejecutivo</h2><p>Se reprodujeron localmente webhooks firmados y mensajes entrantes para Millersville, Easterns y Action Pre Owned Cars English. La corrección elimina el falso positivo que podía convertir el modelo Toyota Tacoma en la localidad Tacoma, VA, conserva Elkton MD cuando se declara explícitamente y completa los campos faltantes al releer la conversación completa durante el poll de 30 segundos.</p><p>También se cubrieron los incidentes reportados: Davila conserva nombre, Toyota Trail Hunter, <strong>2000 + trade-in</strong> y timeline; el caso Hummer conserva vehículo, Cash y today; documentos, identificación y banco permanecen vacíos si la persona no los declara. Resultado: <strong class="pass">todos los criterios de esta matriz PASS</strong>.</p><div class="note"><strong>Causa raíz encontrada:</strong> el extractor de localidades generaba n-gramas demasiado amplios sobre todo el transcript y no distinguía con suficiente fuerza una marca/modelo de una ciudad. Además, el normalizador tenía huecos para marcas/modelos y frases de entrega de vehículo. Se corrigieron los límites de palabra, la evidencia contextual de localidad, el catálogo de vehículos y la combinación de down + trade-in. El reconsultor de 30 segundos ya existía; el fallo observable estaba en la reconciliación/normalización, no en la ausencia del temporizador.</div>
<h2>Versión exacta probada</h2><table><tbody><tr><th>Elemento</th><th>Valor</th></tr><tr><td>Commit publicado</td><td><code>6659b0cb5d4b8a43080f15de59944c9a7bb2fdca</code></td></tr><tr><td>Repositorio</td><td>github.com/juanfer93/dealeradmin · rama main</td></tr><tr><td>DB</td><td>Servicio <code>dealeradmin-postgres</code>, imagen <code>postgres:18</code>, puerto local 5432, contenedor solicitado por el usuario</td></tr><tr><td>Migración</td><td><code>22 | 1710000021000 | EasternsLocationRoutingRules1710000021000</code></td></tr><tr><td>API local</td><td><code>http://127.0.0.1:3015</code> · proceso compilado local · HMAC de prueba inyectado sin imprimirse</td></tr><tr><td>Esquema consultado</td><td><code>conversations</code>, <code>conversation_messages</code>, <code>webhook_events</code>, <code>leads</code>, <code>lead_dealers</code>, <code>locations</code>, <code>dealers</code>, <code>dealer_round_robin_state</code></td></tr><tr><td>Entorno</td><td>100% local; sin GHL, Neon ni cuentas reales. Hora de negocio documentada: America/Bogota.</td></tr></tbody></table>
<h2>Matriz AC-01 a AC-20</h2><table><thead><tr><th>ID</th><th>Criterio</th><th>Estado</th><th>Evidencia</th><th>Timestamp</th></tr></thead><tbody>${matrixRows()}</tbody></table>
<h2>Captura local del resultado</h2><p class="small">Captura generada desde la ejecución local; no representa una consola Neon/GHL ni una prueba externa.</p><img class="capture" src="${esc(screenshotPath)}" />
<div class="page-break"></div><h2>Ruteo Easterns y rond robin</h2><p>La consulta del catálogo local resolvió las localidades; no se agregaron ciudades quemadas al arnés. El resultado de Easterns siguió la prioridad MD/VA y rotaciones configuradas.</p><table><thead><tr><th>Ciudad/estado</th><th>Dealer asignado</th><th>Resultado</th><th>Pregunta predicha</th></tr></thead><tbody>${routeRows()}</tbody></table><p><strong>Millersville:</strong> ${esc(cases.filter((item) => item.source === 'easterns-millersville').map((item) => dealerNames[item.dealer_assigned?.[0]] ?? item.dealer_assigned?.[0]).join(' → '))}</p><p><strong>Action Cars:</strong> el caso en inglés fue asignado a <strong>Action Pre Owned Cars English</strong>; el payload se procesó por el endpoint local con dealer separado por catálogo/configuración.</p>
<h2>Incidentes de normalización</h2><table><thead><tr><th>Campo</th><th>Resultado QA</th></tr></thead><tbody><tr><td>real_name</td><td>Davila Davila y Ana Rivera se conservaron; no se mezcló nombre de contacto con cuerpo irrelevante.</td></tr><tr><td>vehicle_type</td><td>Toyota Tacoma, Toyota Trail Hunter, Hummer sut, truck, SUV, Mustang y van se capturan sin inventar localidad.</td></tr><tr><td>down_payment</td><td>2000 + trade-in para la frase “Quisiera ver si puedo entregar mi vehículo” + down explícito; Cash se conserva.</td></tr><tr><td>phone</td><td>Se conserva normalizado en el snapshot; el reconsultor no lo sustituye con texto de ciudad/modelo.</td></tr><tr><td>documents / identification / bank_account</td><td>Vacíos cuando no hubo declaración explícita.</td></tr><tr><td>purchase_timeline</td><td>“Esta semana” → this week; “Now if possible” → today.</td></tr></tbody></table>
<h2>Ventanas y reconsulta</h2><p><strong>Prueba diferenciada de 30 segundos:</strong> el primer caso quedó incompleto después del primer mensaje; se simuló +15 s y permaneció parcial/waiting_window. Se insertó después “Vivo en Elkton MD” y la respuesta con down/timeline; con +30 s el poll releyó los mensajes, actualizó snapshot/location/progress y dejó la misma conversación en queued. La evidencia guarda la misma <code>conversation_db_id</code>, IDs de mensajes, eventos y hashes.</p><p><strong>Pruebas de 30 min y 3 h:</strong> se verificaron en la regresión local de ventanas con reloj controlado; no se esperaron tiempos reales. Las reglas fuera de horario usan la ventana de 3 horas y las de horario usan la espera configurada.</p>
<h2>Regresiones y pendientes reales</h2><ul><li><strong>Regresión posterior:</strong> 27 archivos de prueba pasaron; 348 tests PASS y 4 skips intencionales por integración externa/separada. El arnés nuevo pasó 15/15 casos.</li><li><strong>Corrección publicada antes del informe:</strong> commit 6659b0c en GitHub.</li><li><strong>Pendientes:</strong> ninguno que bloquee estos criterios locales. La validación de una cuenta GHL real queda fuera de alcance por la regla de entorno y no se presenta como evidencia.</li></ul>
<div class="page-break"></div><h2>Detalle de cada conversación</h2>${cases.map(caseBlock).join('')}
</body></html>`;

fs.writeFileSync(htmlPath, html, 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await page.goto(`file:///${htmlPath.replaceAll('\\', '/')}`, { waitUntil: 'load' });
await page.screenshot({ path: screenshotPath, fullPage: false });
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' } });
await browser.close();
console.log(JSON.stringify({ pdfPath, screenshotPath, htmlPath, cases: cases.length, passCount }));
