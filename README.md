# dealerADMIN

Monorepo for the dealerADMIN operator console. The workspace contains a NestJS API, a Next.js web app, and shared Zod contracts/configuration.

## Local setup

1. Copy `.env.example` to `.env` and fill in secrets locally. Never commit the real file.
2. Generate an Argon2id password hash with `node -e "require('argon2').hash('your-password').then(console.log)"` after dependencies are installed.
3. Run `pnpm install`.
4. Run the migration against the configured PostgreSQL database with the TypeORM migration command documented in `apps/api/README.md`.
5. Use `pnpm dev` from each app while developing, or run `pnpm build` for a production compilation check.

The API rejects invalid configuration at startup. The webhook endpoint accepts only a valid `X-GHL-Signature` HMAC over the raw request body.

## Reglas de calificación por dealer

- **Offlease (Stafford, Fredericksburg y Fredericksburg 2):** usa la misma calificación común que los demás dealers: vehículo y teléfono. Stafford puede usar el teléfono nativo de WhatsApp; Fredericksburg y Fredericksburg 2 requieren que el cliente entregue su número. El nombre, el enganche y las demás respuestas financieras se conservan como evidencia adicional, pero no bloquean el handoff.
- **Los demás dealers:** califican con vehículo y teléfono reciente del cliente; el nombre y el enganche no son requisitos de routing.
- Una relación que ya está en `waiting_window`, `queued` o `sent` no se elimina por mensajes posteriores incompletos. La duplicación se evalúa por relación dentro del mismo dealer, no entre dealers distintos.

## Production migrations

Render runs `pnpm --filter api migrate` after the production build, so every deployment applies pending TypeORM migrations against the configured `DATABASE_URL`. The command is idempotent: already-applied migrations are skipped.

## Verificación completa de conversaciones y GHL Guard

La recepción del webhook sigue siendo la fuente principal. El GHL Guard es una capa de auditoría y reparación que prioriza conversaciones con `last_message_at` más reciente, vuelve a leer sus mensajes mediante el token privado de la subcuenta y reutiliza la normalización existente únicamente cuando encuentra datos faltantes o atrasados por latencia. No reemplaza el webhook ni cambia las reglas de routing.

El scheduler del guard está en GitHub Actions, en `.github/workflows/process-due-conversations.yml`, y se ejecuta cada cinco minutos contra el API publicado en Render. El workflow usa el secreto de repositorio `CRON_SECRET` y también puede ejecutarse manualmente con `workflow_dispatch`. El reporte mensual se ejecuta mediante `.github/workflows/monthly-report.yml`, también contra Render.

Para diagnosticar una conversación se debe seguir toda la cadena en Neon:

1. `webhook_ingress_logs`: confirma si GHL entregó la petición.
2. `webhook_processing_attempts`: confirma si la aplicación intentó procesarla y cuánto tardó.
3. `conversations` + `conversation_messages`: confirma la relación, el estado, el snapshot y los mensajes persistidos. Solo los mensajes `inbound` son evidencia del cliente; los `outbound` se conservan para auditoría.
4. `conversation_attachments`: confirma extracción de texto o procesamiento de medios.
5. `ghl_guard_logs`: confirma si el guard consultó GHL, cuántos mensajes encontró, insertó o reparó, si ejecutó reconciliación y si falló. También conserva el ciclo de vida auditable (`pending`, `running`, `succeeded`/`failed`), el intento, el lease y el próximo reintento (`attempt_count`, `lease_expires_at`, `next_retry_at`).

Ejemplo de auditoría por conversación:

```sql
SELECT c.id, c.ghl_location_id, c.ghl_contact_id, c.ghl_conversation_id,
       c.status, c.qualification_snapshot, c.last_message_at,
       cm.id AS message_id, cm.direction, cm.body, cm.occurred_at,
       gl.status AS guard_status, gl.fetched_message_count,
       gl.inserted_message_count, gl.repaired_message_count,
       gl.reconciled, gl.lead_metadata, gl.completed_fields,
       gl.error_code, gl.created_at AS guard_checked_at
FROM conversations c
LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
LEFT JOIN LATERAL (
  SELECT * FROM ghl_guard_logs g
  WHERE g.conversation_id = c.id
  ORDER BY g.created_at DESC LIMIT 1
) gl ON true
WHERE c.ghl_conversation_id = '<GHL_CONVERSATION_ID>'
ORDER BY cm.occurred_at ASC NULLS LAST, cm.created_at ASC;
```
