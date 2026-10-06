# Auditoría de seguridad de Leads

Fecha: 2026-10-06
Alcance: `apps/api/src/features/leads`, `apps/api/src/features/webhooks`, `apps/api/src/features/auth`, `apps/api/src/features/reports` y dependencias de `apps/api`/`apps/web`.

## Resultado

Se reforzaron los límites de entrada y transporte sin cambiar consultas SQL ni reglas de negocio:

- DTOs de escritura de Leads con `class-validator`, límites de tamaño y rechazo de propiedades no declaradas mediante `whitelist: true` y `forbidNonWhitelisted: true`.
- `helmet`, CORS mediante `CORS_ORIGINS`, filtro global de respuestas de error sanitizadas y rate limiting global de 100 solicitudes por minuto.
- HMAC con `timingSafeEqual`, rechazo de firmas nulas, alteradas o con timestamp opcional caducado, y logging del rechazo sin registrar secretos ni payloads.
- Se conserva la idempotencia existente por `event_id`; los reintentos del mismo evento procesado se ignoran mientras el lead siga presente.

## Hallazgos confirmados

### Autorización de reportes / IDOR — pendiente de diseño

La autenticación actual es una sesión administrativa única (`dealeradmin_session`) y no contiene un `dealerId` ni una política de roles por dealer. Los endpoints `/api/reports/preview` y `/api/reports/export` aceptan un `dealerId` solicitado y lo filtran con SQL parametrizado, pero no existe una autorización de objeto que limite un usuario de bajo privilegio a su dealer.

No se inventó una política de autorización en este spike. Para cerrar este hallazgo hace falta definir identidad, roles y pertenencia de usuario-dealer; después debe añadirse una prueba E2E de acceso cruzado.

### Dependencias

`pnpm audit --prod` pasó de 25 hallazgos (3 críticos, 13 altos, 8 moderados y 1 bajo) a 1 hallazgo moderado: `uuid` antiguo transitivo de ExcelJS. Se actualizaron Next.js/PostCSS y se fijaron versiones parcheadas para `proxy-addr`, `multer`, `sharp`, `qs`, `source-map-js` y ramas vulnerables de `brace-expansion`. No se forzó `uuid` 11 sobre ExcelJS por riesgo de compatibilidad mayor.

## Evidencia local

- Typecheck de API y web: aprobado.
- Build de API: aprobado.
- Build de web con Next.js 15.5.27: aprobado.
- Pruebas dirigidas de DTO/HMAC: 6/6 aprobadas.
- Regresión de webhooks, replay/idempotencia, reportes y leads: 31/31 aprobadas en la ejecución final.
- Docker está disponible, pero no hay un `docker-compose.yml` en este checkout; no se declaró una prueba PostgreSQL/Redis ni stress E2E como ejecutada.

La validación es local. No demuestra despliegue, configuración efectiva de producción, distribución multi-instancia del rate limit ni delivery real desde GHL.
