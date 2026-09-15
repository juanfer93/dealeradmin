# DealerADMIN local media worker

This worker is intentionally outside the HTTP request and GHL workflow. The API stores attachment metadata in `conversation_attachments`; the worker claims pending rows, downloads each resource to a temporary file, runs local ASR/OCR, stores derived evidence, and removes the temporary file.

## Local run

Build and run it only after the API migration has been applied and `DATABASE_URL` has been injected by the operator:

```powershell
docker build -t dealeradmin-media-worker .\media-worker
docker run --rm --env-file .env --name dealeradmin-media-worker dealeradmin-media-worker
```

The worker must also receive `DEALERADMIN_API_URL` (the API base URL, without a trailing slash) and `DEALERADMIN_WEBHOOK_SECRET`. After saving extracted text, it calls the guarded `reconcile-media` endpoint. That endpoint recalculates qualification from all conversation messages, including the derived inbound text, and can move a conversation into the normal queue. A missing or failed callback is treated as retryable so media cannot silently remain unqualified.

Optional injected settings include `WHISPER_MODEL=small`, `MEDIA_MAX_BYTES`, `MEDIA_MAX_ATTEMPTS`, `MEDIA_POLL_SECONDS`, and `GHL_MEDIA_BEARER_TOKEN` when a GHL resource is not a signed URL. Secrets are never printed by the worker.

The worker does not persist media binaries. It records the SHA-256, processing metadata, derived text, and failure status. The derived audio text is inserted into `conversation_messages.body` as an inbound message with `raw_payload.source = audio_transcription`, so it is explicitly visible to the qualification transcript. A duplicate attachment hash reuses the existing evidence and does not create a second derived message.
