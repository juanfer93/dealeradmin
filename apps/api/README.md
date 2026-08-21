# API

The NestJS API exposes:

- `POST /api/auth/login` for the single configured operator. It uses Argon2id verification and an HttpOnly, SameSite=Lax session cookie.
- `POST /api/webhooks` for the GHL lead webhook. It requires `X-GHL-Signature` to be an HMAC-SHA256 digest of the exact raw body.

TypeORM is configured with `synchronize: false`. Run migrations explicitly after setting `DATABASE_URL`; the migration creates the four tables used by the routing model.
