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
