# API

The NestJS API exposes:

- `POST /api/auth/login` for the single configured operator. It uses Argon2id verification and an HttpOnly, SameSite=Lax session cookie.
- `POST /api/webhooks` for the GHL lead webhook. It requires `X-GHL-Signature` to be an HMAC-SHA256 digest of the exact raw body.

TypeORM is configured with `synchronize: false`. Run migrations explicitly after setting `DATABASE_URL`:

```bash
pnpm --filter api migrate
```

The Vercel build also runs that command automatically before compiling the app. It creates the routing tables and the `lead_ingestion_batches` / `lead_ingestion_rows` audit tables for bulk uploads.

## Reglas de calificación para dealerADMIN

Estas reglas son la fuente de verdad para el ingreso automático a la cola:

- Todos los dealers requieren nombre, teléfono y un interés real de vehículo.
- Solo los dealers Offlease (Stafford, Fredericksburg y Fredericksburg 2) requieren además el enganche mínimo del vehículo. La promoción de $1,000 se acepta únicamente cuando la conversación demuestra que el comprador ya financió antes.
- En los demás dealers el down payment, la fecha de compra, los documentos y la cuenta bancaria son evidencia adicional, no bloqueos de ingreso.
- Fuera de Offlease esos campos se conservan como evidencia informativa: no crean `down_payment_minimum` ni muestran el lead como insuficiente en la cola.
- Easterns conserva su requisito separado de ciudad/estado o zona para poder georutear al dealer correcto.
- Un lead puede existir en varios dealers independientes. La deduplicación solo bloquea una segunda relación del mismo lead en el mismo dealer; nunca debe impedirlo en otro dealer.
- Una relación que ya entró en la cola o fue enviada no se elimina por una actualización o por latencia de GHL. Las reconciliaciones son aditivas e idempotentes.

## GHL Guard y auditoría de latencia

El webhook continúa siendo la fuente primaria de mensajes. Cada ciclo del guard selecciona primero las conversaciones locales activas con `last_message_at` más reciente, consulta los mensajes de esa conversación en GHL con el token privado de su subcuenta, persiste cualquier mensaje faltante y llama a la misma reconciliación/normalización del webhook. El guard no modifica la asignación por dealer y excluye relaciones `queued`, `sent`, `duplicate_ignored`, `ignored_channel` y `stale_phone_ignored`.

Las migraciones `1710000034000-GhlGuardLogs` y `1710000035000-GhlGuardLifecycle` crean y completan `ghl_guard_logs`. Para cerrar una investigación se deben comparar, en este orden, `webhook_ingress_logs`, `webhook_processing_attempts`, `conversations`, `conversation_messages`, `conversation_attachments` y `ghl_guard_logs`. Un `200` de GHL o un log `succeeded` solo prueba una consulta; la prueba de reparación es que aparezcan los mensajes en `conversation_messages`, que el `qualification_snapshot` se actualice y que `ghl_guard_logs.reconciled = true`.

Cada fila conserva el ciclo `pending` → `running` → `succeeded`/`failed`/`skipped` en `metadata.lifecycle`, junto con `scheduled_at`, `started_at`, `finished_at`, `duration_ms`, `http_status`, `request_path`, `error_code` y `response_payload`.

El ciclo automático de cinco minutos lo ejecuta GitHub Actions mediante `.github/workflows/process-due-conversations.yml`. El repositorio debe tener configurado el secreto `CRON_SECRET`, con el mismo valor que usa la API. El cron mensual permanece en Vercel; no se debe mover el guard de cinco minutos a `vercel.json` mientras el proyecto esté en el plan Hobby.

Variables opcionales:

```env
GHL_GUARD_ENABLED=true
GHL_GUARD_INTERVAL_MS=300000
GHL_GUARD_BATCH_SIZE=5
GHL_GUARD_CONCURRENCY=4
GHL_GUARD_TIMEOUT_MS=10000
GHL_GUARD_MESSAGE_PAGE_LIMIT=100
GHL_GUARD_MAX_PAGES=10
```

El guard procesa una conversación por ciclo por defecto (se puede ampliar hasta dos), con una sola lectura concurrente y un deadline total de 20 segundos por conversación. Cada intento deja `scheduled_at`, `started_at`, `finished_at`, `attempt_count`, `next_retry_at` y `lease_expires_at` en `ghl_guard_logs`: una fila `pending`/`running` con lease vigente no se duplica, y un fallo vuelve a intentarse en el siguiente ciclo de cinco minutos. `duration_ms` conserva la duración calculada de cada intento, incluyendo los fallidos. El guard sigue siendo aditivo: nunca borra ni reemplaza datos existentes.
