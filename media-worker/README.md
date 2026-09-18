# DealerADMIN local media worker

This worker is intentionally outside the HTTP request and GHL workflow. The API stores attachment metadata in `conversation_attachments`; the worker claims pending rows, downloads each resource to a temporary file, runs local ASR/OCR plus local visual interpretation, stores derived evidence, and removes the temporary file.

## Local run

Build and run it only after the API migration has been applied and `DATABASE_URL` has been injected by the operator:

```powershell
docker build -t dealeradmin-media-worker .\media-worker
docker run --rm --env-file .env --name dealeradmin-media-worker dealeradmin-media-worker
```

For a scheduled runner such as GitHub Actions, set `MEDIA_RUN_ONCE=true`. The
worker drains all currently available pending attachments and exits when the
queue is empty; this prevents a scheduled job from remaining alive forever.
The API callback URL must include the API prefix, for example
`https://dealeradmin-api-eight.vercel.app/api`.

The worker must also receive `DEALERADMIN_API_URL` (the API base URL, without a trailing slash) and `GHL_WEBHOOK_SECRET`. After saving extracted text, it calls the guarded `reconcile-media` endpoint. That endpoint recalculates qualification from all conversation messages, including the derived inbound text, and can move a conversation into the normal queue. A missing or failed callback is treated as retryable so media cannot silently remain unqualified. The worker keeps `DEALERADMIN_WEBHOOK_SECRET` only as a backwards-compatible fallback.

The scheduled GitHub runner expects these repository secrets using the same names already used by the API: `DATABASE_URL` (the production Neon URL) and `GHL_WEBHOOK_SECRET` (the shared value configured for the API). `GHL_MEDIA_BEARER_TOKEN` is optional and is only needed when GHL returns a resource that is not already signed. Secret values must stay in GitHub/Vercel environment settings, never in the repository.

For photos where the vehicle or document is visible but has no readable text, the worker uses the local Hugging Face multimodal model installed by `requirements.txt`. The model is downloaded and cached by the GitHub workflow; no OpenAI account, API key, or external vision endpoint is used. Its structured findings become an additive inbound message and are then processed by the same normalizer as ordinary conversation text:

```powershell
$env:MEDIA_LOCAL_VISION_MODEL = 'HuggingFaceTB/SmolVLM-500M-Instruct'
$env:MEDIA_LOCAL_VISION_REQUIRED = 'true'
```

When `MEDIA_LOCAL_VISION_REQUIRED=true`, an image is retried instead of being marked complete if the local model is not installed or fails. When it is false, OCR remains available as a backward-compatible fallback. Optional settings include `WHISPER_MODEL=small`, `MEDIA_MAX_BYTES`, `MEDIA_MAX_ATTEMPTS`, `MEDIA_POLL_SECONDS`, and `GHL_MEDIA_BEARER_TOKEN` when a GHL resource is not a signed URL. There is no `MEDIA_VISION_API_KEY` setting.

The worker does not persist media binaries. It records the SHA-256, processing metadata, derived text, and failure status. Derived audio and image interpretation text is inserted into `conversation_messages.body` as an inbound message with `raw_payload.source = audio_transcription` or `image_interpretation`, so it is explicitly visible to the qualification transcript. A duplicate attachment hash reuses the existing evidence and does not create a second derived message.
