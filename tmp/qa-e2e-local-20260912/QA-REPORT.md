# dealerADMIN — E2E general local QA

Fecha: 2026-09-12. Resultado final: **PASS para AC-01 a AC-20**.

La ejecución fue completamente local: PostgreSQL Docker del usuario (`c20d4b05ae50be641c04709c5bff0b91ef3229abbab50e669115e175b2c6144e`, `dealeradmin-postgres`, `postgres:18`), API `http://127.0.0.1:3010` y frontend `http://127.0.0.1:3000`. Se inyectó un HMAC simulado de prueba sin imprimirlo ni guardarlo en evidencia. No se usaron GHL, Neon ni cuentas reales.

## Baseline y esquema

- Commit: `3470776ed3ec0e72adb4583fa015291a9e9e3985` (`fix: reconcile inbound qualification before queueing`).
- Migración final aplicada: `RepairCustomerRepliedSourceAliases1710000020000`.
- Salud API: `GET /api/auth/session` HTTP 200.
- Frontend: login local, `/app`, selección de Offlease Fredericksburg y lead QA visible: PASS.
- Reloj controlado: 10:00 Bogota (`2026-09-12T15:00:00Z`), 20:00 Bogota (`2026-09-13T01:00:00Z`), +15 s, +30 s, +30 min y +3 h simulados.
- Tablas verificadas: `conversation_messages`, `conversations`, `dealer_location_aliases`, `dealer_round_robin_state`, `dealers`, `lead_dealers`, `locations`, `leads`, `migrations`, `webhook_events`.
- Conteo final dentro del namespace QA: 37 leads, 45 webhook events y 34 conversations; no se modificaron filas fuera de ese namespace.

## Matriz de aceptación

| Criterio | Resultado | Evidencia principal |
|---|---|---|
| AC-01 trazabilidad event → message → conversation → lead → lead_dealer | PASS | SQL de unión y snapshots por caso en `evidence.json` |
| AC-02 HMAC inválido rechazado | PASS | `invalid_signature`, HTTP 401 |
| AC-03 idempotencia de mensaje/evento | PASS | `idempotent-message-retry`, mismo message count y `duplicate_ignored` |
| AC-04 identidad Messenger/WhatsApp | PASS | `source-stafford` y fuentes Messenger; WhatsApp exige nombre declarado |
| AC-05 no contaminar `real_name` | PASS | `contamination-question` |
| AC-06 evidencia de vehículo | PASS | fuentes y `busco un Mustang` / `tengo un truck` |
| AC-07 separar enganche y timeline | PASS | `years-and-down`, 1000/2000/3000 y plazos |
| AC-08 documentos no bloquean | PASS | colas completas con documentos faltantes |
| AC-09 reparación/poll de 30 s | PASS | `late-repair`, misma conversación reparada |
| AC-10 no mezclar campos | PASS | preguntas del bot, botones, años, Mustang aislado |
| AC-11 ventanas horarias Bogota | PASS | `window-day` +30 min y `window-night` +3 h |
| AC-12 waiting_window con next_attempt_at null | PASS | `manual-waiting-null` |
| AC-13 Action Cars ES/EN separado | PASS | `action-es`, `action-en`, dealers distintos |
| AC-14 Millersville round-robin | PASS | secuencia Millersville, White Marsh, Millersville, White Marsh |
| AC-15 Easterns Rosedale/Laurel/Sterling y colisiones | PASS | Rosedale, Laurel ambiguo MD, Laurel VA, Sterling, Newark |
| AC-16 duplicado queued no crea cola nueva | PASS | `duplicate-retry` → `duplicate_ignored` |
| AC-17 coherencia de estados | PASS | snapshots before/after y estados en cada caso |
| AC-18 sin fuga entre dealers | PASS | source aliases, `dealer_id`, `assigned_dealer_id` por caso |
| AC-19 sent y poll concurrente seguros | PASS | `sent-reprocess`, `concurrent-poll`, una relación |
| AC-20 frontend refleja BD local | PASS | `frontend-result.json` y `frontend-dashboard.png` |

## Regla nueva: teléfono enviado hace >= 3 días

Implementada y probada localmente: un teléfono con `lead_dealers.status='sent'` y `sent_at <= now - 3 days` queda `stale_phone_ignored`, no crea nueva relación de cola; uno enviado hace 2 días sigue permitido. Casos: `stale-phone-exact-3-days` y `recent-phone-allowed`.

## Fallos capturados, correcciones y reejecución

La historia completa, con consultas, causa raíz, archivos y retest, está en `failure-evidence.json`. Se corrigieron después de capturar cada fallo: deriva de esquema/migración, aliases Fredericksburg ausentes, pérdida de saltos de línea, contaminación de nombre en georouting, Laurel-MD sin rama y configuración/selectores del frontend local.

Reejecución final: **34 casos PASS, 0 FAIL, 0 BLOCKED**. Regresión completa con estrés habilitado: **333 tests PASS en 28 archivos**, incluyendo carga, duplicados, orden invertido y rollback.

## Artefactos

- `evidence.json`: hashes SHA-256, event/conversation/message IDs, estados, snapshots, ubicación, dealer, next attempt, routing reason y SQL por caso.
- `failure-evidence.json`: fallos observados antes de cada corrección y retests.
- `frontend-result.json`: resultado de login/dashboard local.
- `frontend-dashboard.png`: captura de UI local autenticada.
- `run-qa.mjs`: harness E2E DB-backed local.
- `check-frontend.mjs`: smoke E2E autenticado del frontend local.
