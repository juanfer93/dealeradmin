# dealerADMIN

Monorepo for the dealerADMIN operator console. The workspace contains a NestJS API, a Next.js web app, and shared Zod contracts/configuration.

## Local setup

1. Copy `.env.example` to `.env` and fill in secrets locally. Never commit the real file.
2. Generate an Argon2id password hash with `node -e "require('argon2').hash('your-password').then(console.log)"` after dependencies are installed.
3. Run `pnpm install`.
4. Run the migration against Neon with the TypeORM migration command documented in `apps/api/README.md`.
5. Use `pnpm dev` from each app while developing, or run `pnpm build` for a production compilation check.

The API rejects invalid configuration at startup. The webhook endpoint accepts only a valid `X-GHL-Signature` HMAC over the raw request body.
