# Auditoría estática de SQLi y XSS

Fecha: 2026-09-28  
Repositorio: `dealeradmin`  
Rama: `chore/security-audit-sqli-xss`  
Alcance: `apps/api/src/` y `apps/web/src/`

## Resultado ejecutivo

No se identificaron vulnerabilidades confirmadas de Inyección SQL (SQLi) ni Cross-Site Scripting (XSS) en el código revisado.

La auditoría fue estática y manual. No se modificaron consultas, controladores, servicios ni componentes frontend. El único archivo nuevo de esta rama es este reporte.

## Método y cobertura

- Se revisaron los 108 archivos fuente bajo `apps/api/src/` y los 21 archivos fuente bajo `apps/web/src/`.
- En backend se buscaron `.query()`, `queryRunner.query()`, `runner.query()`, `queryClient.query()`, `createQueryBuilder()`, interpolaciones `${...}` y concatenaciones dentro de SQL.
- En frontend se buscaron `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `eval`, `new Function` y sinks indirectos de URL/DOM.
- Las migraciones y pruebas de integración se revisaron como contexto, pero la conclusión de riesgo de la aplicación se basa en el código de producción.

## Hallazgos SQLi

### H-SQL-00 — Sin vulnerabilidad confirmada

Se localizaron consultas raw de TypeORM/`pg`, pero los valores provenientes de parámetros se envían mediante placeholders PostgreSQL (`$1`, `$2`, `$3`, etc.). No se encontró `createQueryBuilder()` en el alcance.

Evidencias representativas:

- `apps/api/src/features/leads/presentation/leads.controller.ts:74-121`: `dealerFilter` solo selecciona entre un fragmento constante vacío o `AND d.id = ANY($2::uuid[])`; los valores se pasan en `params`.
- `apps/api/src/features/leads/presentation/leads.controller.ts:163-172`: `leadId` y `dealerId` se pasan como parámetros de las actualizaciones.
- `apps/api/src/features/reports/application/export-report.service.ts:70-114`: filtros de fechas y dealer usan `$1`, `$2` y `$3`; no se interpolan en la sentencia.
- `apps/api/src/features/reports/application/export-report.service.ts:260-279`: el historial de exportación usa placeholders para identificadores, fechas, nombres y mensajes de error.
- `apps/api/src/features/problems/application/problem-tickets.service.ts:164-200`: problema, evidencia, alcance, Markdown y número de ticket usan placeholders.
- `apps/api/src/features/reports/application/monthly-report.service.ts:138-210`: inserciones y actualizaciones del ciclo mensual usan valores parametrizados.

Observación no vulnerable: la presencia de muchas consultas raw aumenta el riesgo de regresión futura y merece una regla de revisión continua, pero por sí sola no constituye SQLi cuando la sentencia es fija y los datos se parametrizan.

## Hallazgos XSS

### H-XSS-00 — Sin vulnerabilidad confirmada

No se encontraron sinks HTML peligrosos ni evaluadores dinámicos en `apps/web/src/`:

`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `eval()` y `new Function()` no aparecen en el alcance.

Evidencias representativas:

- `apps/web/src/components/operator/OperatorDashboard.tsx:427-428`: nombre, teléfono, vehículo, dealer y `messageText` se renderizan como hijos de JSX. React escapa ese contenido por defecto.
- `apps/web/src/components/operator/OperatorDashboard.tsx:453`: los nombres usados en el diálogo de copia también se renderizan como texto JSX.
- `apps/web/src/app/app/problems/page.tsx:192`: `ticket.problem` se muestra como texto JSX; el enlace de descarga usa la ruta fija `/api/problems/` y el número de ticket, no HTML controlado por el usuario.
- Los usos de `window.location.assign` revisados apuntan a rutas internas fijas; la exportación construye su query string para la ruta de reportes y no inyecta HTML.

Observación no vulnerable: copiar mensajes mediante `navigator.clipboard.writeText()` no crea un sink de ejecución en el navegador; solo transfiere texto.

## Hallazgos por severidad

| ID | Vector | Severidad | Estado |
| --- | --- | --- | --- |
| H-SQL-00 | SQLi | Informativo | No vulnerable; consultas parametrizadas |
| H-XSS-00 | XSS | Informativo | No vulnerable; sin sinks peligrosos y JSX escapado |

## Validación ejecutada

- Frontend: `pnpm --filter web test` — 4 archivos y 12 pruebas aprobadas.
- E2E: `pnpm test:e2e` — build completo aprobado y 27/27 casos E2E reportados como `ok`, incluyendo login, reportes, tickets y pruebas de seguridad existentes. El proceso envolvente no cerró limpiamente después de completar los casos y fue detenido para no dejar servidores auxiliares persistentes; por ello se reporta la aprobación de casos, no un cierre limpio del comando.
- Backend: `apps/api/package.json` no define un script `test`; `pnpm --filter api test` no ejecutó una suite backend verificable.
- Docker: `docker ps` no pudo conectarse al daemon `dockerDesktopLinuxEngine`; no se levantó infraestructura ni se ejecutó una prueba de concepto dinámica.

Estas pruebas son evidencia local de estabilidad y no sustituyen una validación de producción.

## Acciones y autorización

No se propone aplicar parches porque no se confirmó una vulnerabilidad. Cualquier cambio futuro sobre consultas raw, serialización de Markdown o sinks de renderizado deberá revisarse y aprobarse por separado antes de modificar la lógica existente.
