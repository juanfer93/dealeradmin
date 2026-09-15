"""Local DealerADMIN media worker.

The API stores attachment metadata only. This worker downloads one attachment
to a short-lived temp file, runs local ASR/OCR, stores derived evidence, and
deletes the temp file. It never logs URLs, tokens, message bodies, or PII.
"""

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import psycopg
import requests


LOG = logging.getLogger("dealeradmin.media-worker")
MAX_BYTES = int(os.getenv("MEDIA_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_ATTEMPTS = int(os.getenv("MEDIA_MAX_ATTEMPTS", "4"))
POLL_SECONDS = float(os.getenv("MEDIA_POLL_SECONDS", "2"))
RETRY_BASE_SECONDS = int(os.getenv("MEDIA_RETRY_BASE_SECONDS", "30"))
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DOWNLOAD_TIMEOUT = int(os.getenv("MEDIA_DOWNLOAD_TIMEOUT_SECONDS", "30"))
MAX_DURATION_SECONDS = int(os.getenv("MEDIA_MAX_DURATION_SECONDS", "180"))
DEALERADMIN_API_URL = os.getenv("DEALERADMIN_API_URL", "").strip().rstrip("/")
GHL_WEBHOOK_SECRET = os.getenv("GHL_WEBHOOK_SECRET", os.getenv("DEALERADMIN_WEBHOOK_SECRET", "")).strip()
RECONCILIATION_TIMEOUT = int(os.getenv("DEALERADMIN_RECONCILIATION_TIMEOUT_SECONDS", "15"))
MEDIA_RUN_ONCE = os.getenv("MEDIA_RUN_ONCE", "false").strip().lower() in {"1", "true", "yes", "on"}

_WHISPER_MODEL: Any | None = None


class NotRetrievable(Exception):
    pass


class RetryableMediaError(Exception):
    pass


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    return value


def safe_content_type(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).split(";", 1)[0].strip().lower()
    return text or None


def media_kind(content_type: str | None, filename: str | None) -> str:
    source = " ".join(item for item in (content_type or "", filename or "") if item).lower()
    if re.search(r"audio|\.(ogg|oga|opus|aac|m4a|mp3|wav|webm)(\?|$)", source):
        return "audio"
    if re.search(r"image|\.(jpg|jpeg|png|gif|webp|heic|bmp|tif|tiff)(\?|$)", source):
        return "image"
    return "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_attachment(row: dict[str, Any], destination: Path) -> tuple[str, int]:
    source_url = row.get("source_url")
    if not source_url:
        raise NotRetrievable("missing_source_url")

    token = os.getenv("GHL_MEDIA_BEARER_TOKEN", "").strip()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        response = requests.get(str(source_url), headers=headers, timeout=DOWNLOAD_TIMEOUT, stream=True)
    except requests.RequestException as exc:
        raise RetryableMediaError("download_request_failed") from exc

    if response.status_code in (401, 403, 404, 410):
        raise NotRetrievable(f"download_http_{response.status_code}")
    if response.status_code >= 500:
        raise RetryableMediaError(f"download_http_{response.status_code}")
    if response.status_code >= 400:
        raise NotRetrievable(f"download_http_{response.status_code}")

    total = 0
    try:
        with destination.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_BYTES:
                    raise NotRetrievable("media_size_limit_exceeded")
                output.write(chunk)
    except OSError as exc:
        raise RetryableMediaError("temporary_file_failed") from exc

    return safe_content_type(response.headers.get("content-type")) or safe_content_type(row.get("content_type")) or "application/octet-stream", total


def transcribe_audio(path: Path) -> tuple[str, dict[str, Any]]:
    global _WHISPER_MODEL
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RetryableMediaError("faster_whisper_unavailable") from exc

    if _WHISPER_MODEL is None:
        _WHISPER_MODEL = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
    model = _WHISPER_MODEL
    try:
        segments, info = model.transcribe(str(path), vad_filter=True)
        segment_rows: list[dict[str, Any]] = []
        text_parts: list[str] = []
        log_probs: list[float] = []
        for segment in segments:
            value = str(getattr(segment, "text", "")).strip()
            if value:
                text_parts.append(value)
            log_prob = getattr(segment, "avg_logprob", None)
            if isinstance(log_prob, (int, float)):
                log_probs.append(float(log_prob))
            segment_rows.append({
                "start": float(getattr(segment, "start", 0)),
                "end": float(getattr(segment, "end", 0)),
                "text": value,
                "avg_logprob": log_prob,
            })
        metadata: dict[str, Any] = {
            "engine": "faster-whisper",
            "model": WHISPER_MODEL_NAME,
            "language": getattr(info, "language", None),
            "duration": getattr(info, "duration", None),
            "segments": segment_rows,
        }
        if log_probs:
            metadata["avg_logprob"] = sum(log_probs) / len(log_probs)
        return "\n".join(text_parts).strip(), metadata
    except Exception as exc:  # pragma: no cover - depends on native model runtime
        raise RetryableMediaError("audio_processing_failed") from exc


def flatten_ocr(value: Any) -> tuple[list[str], list[float], list[Any]]:
    texts: list[str] = []
    scores: list[float] = []
    boxes: list[Any] = []
    if isinstance(value, dict):
        for key in ("rec_texts", "texts", "text", "transcription"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                texts.append(candidate.strip())
            elif isinstance(candidate, list):
                texts.extend(str(item).strip() for item in candidate if str(item).strip())
        for key in ("rec_scores", "scores", "confidence", "confidences"):
            candidate = value.get(key)
            if isinstance(candidate, (int, float)):
                scores.append(float(candidate))
            elif isinstance(candidate, list):
                scores.extend(float(item) for item in candidate if isinstance(item, (int, float)))
        for key in ("dt_polys", "polys", "boxes", "coordinates"):
            if isinstance(value.get(key), list):
                boxes.extend(value[key])
        for child in value.values():
            child_texts, child_scores, child_boxes = flatten_ocr(child)
            texts.extend(child_texts)
            scores.extend(child_scores)
            boxes.extend(child_boxes)
    elif isinstance(value, (list, tuple)):
        for child in value:
            child_texts, child_scores, child_boxes = flatten_ocr(child)
            texts.extend(child_texts)
            scores.extend(child_scores)
            boxes.extend(child_boxes)
    return texts, scores, boxes


def paddle_ocr(path: Path) -> tuple[str, dict[str, Any]]:
    from paddleocr import PaddleOCR  # type: ignore

    engine = PaddleOCR(lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
    result = engine.predict(str(path))
    raw = []
    for item in result:
        if hasattr(item, "json"):
            raw.append(item.json)
        elif hasattr(item, "to_json"):
            raw.append(item.to_json())
        else:
            raw.append(item)
    texts, scores, boxes = flatten_ocr(raw)
    unique_texts = list(dict.fromkeys(text for text in texts if text))
    metadata: dict[str, Any] = {"engine": "paddleocr", "boxes": boxes}
    if scores:
        metadata["confidence"] = sum(scores) / len(scores)
    return "\n".join(unique_texts), metadata


def tesseract_ocr(path: Path) -> tuple[str, dict[str, Any]]:
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
        text = pytesseract.image_to_string(Image.open(path), lang="eng+spa").strip()
    except Exception as exc:  # pragma: no cover - depends on native OCR runtime
        raise RetryableMediaError("tesseract_unavailable") from exc
    return text, {"engine": "tesseract", "fallback": True}


def process_image(path: Path) -> tuple[str, dict[str, Any]]:
    try:
        return paddle_ocr(path)
    except Exception as paddle_error:  # pragma: no cover - depends on native OCR runtime
        text, metadata = tesseract_ocr(path)
        metadata["paddleocr_error"] = "unavailable_or_failed"
        metadata["fallback_reason"] = type(paddle_error).__name__
        return text, metadata


def claim_attachment(connection: psycopg.Connection[Any]) -> dict[str, Any] | None:
    with connection.transaction():
        with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
            cursor.execute(
                """
                SELECT id, conversation_id, conversation_message_id, ghl_message_id,
                       source_url, content_type, media_kind, original_filename,
                       attempt_count
                FROM conversation_attachments
                WHERE (processing_status = 'pending'
                       OR (processing_status = 'failed' AND attempt_count < %s))
                  AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """,
                (MAX_ATTEMPTS,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            cursor.execute(
                """
                UPDATE conversation_attachments
                SET processing_status = 'processing', attempt_count = attempt_count + 1,
                    error_code = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (row["id"],),
            )
            row["attempt_count"] = int(row["attempt_count"] or 0) + 1
            return dict(row)


def save_failure(connection: psycopg.Connection[Any], row: dict[str, Any], status: str, error_code: str) -> None:
    next_attempt = None if status == "not_retrievable" or row["attempt_count"] >= MAX_ATTEMPTS else f"{RETRY_BASE_SECONDS * (2 ** max(row['attempt_count'] - 1, 0))} seconds"
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE conversation_attachments
                SET processing_status = %s, error_code = %s,
                    next_attempt_at = CASE WHEN %s::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + %s::interval END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (status, error_code[:160], next_attempt, next_attempt, row["id"]),
            )


def save_success(connection: psycopg.Connection[Any], row: dict[str, Any], digest: str, content_type: str, byte_size: int, text: str, metadata: dict[str, Any]) -> None:
    metadata = {**metadata, "sha256": digest, "content_type": content_type, "byte_size": byte_size}
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, extracted_text, processing_metadata
                FROM conversation_attachments
                WHERE ghl_message_id = %s AND sha256 = %s AND id <> %s
                LIMIT 1
                """,
                (row["ghl_message_id"], digest, row["id"]),
            )
            duplicate = cursor.fetchone()
            if duplicate:
                metadata["duplicate_of"] = str(duplicate[0])
                text = duplicate[1] or ""
                metadata["reused_metadata"] = duplicate[2] or {}

            cursor.execute(
                """
                UPDATE conversation_attachments
                SET sha256 = CASE WHEN %s THEN NULL ELSE %s END,
                    content_type = COALESCE(%s, content_type), byte_size = %s,
                    extracted_text = %s, processing_metadata = %s::jsonb,
                    processing_status = 'done', next_attempt_at = NULL,
                    error_code = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (bool(duplicate), digest, content_type, byte_size, text or None, json.dumps(metadata), row["id"]),
            )
            if text and not duplicate:
                cursor.execute(
                    """
                    INSERT INTO conversation_messages
                      (conversation_id, dedupe_key, ghl_message_id, direction, body, occurred_at, raw_payload)
                    SELECT ca.conversation_id, 'media:' || ca.id::text,
                           ca.ghl_message_id || ':media:' || ca.id::text, 'inbound', %s,
                           cm.occurred_at,
                           %s::jsonb
                    FROM conversation_attachments ca
                    JOIN conversation_messages cm ON cm.id = ca.conversation_message_id
                    WHERE ca.id = %s
                    ON CONFLICT (conversation_id, dedupe_key) DO NOTHING
                    """,
                    (
                        text,
                        json.dumps({
                            "source": "audio_transcription" if row["media_kind"] == "audio" else "image_ocr",
                            "attachment_id": str(row["id"]),
                            "ghl_message_id": row["ghl_message_id"],
                            "sha256": digest,
                            "model": metadata.get("model") or metadata.get("engine"),
                            "confidence": metadata.get("confidence") or metadata.get("avg_logprob"),
                            "processing_metadata": metadata,
                        }),
                        row["id"],
                    ),
                )
            cursor.execute(
                "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (row["conversation_id"],),
            )


def notify_reconciliation(conversation_id: Any) -> bool:
    """Ask the API to recalculate the snapshot after derived text is stored."""
    if not DEALERADMIN_API_URL or not GHL_WEBHOOK_SECRET:
        LOG.warning("media_reconciliation_skipped reason=missing_callback_config")
        return False
    try:
        response = requests.post(
            f"{DEALERADMIN_API_URL}/webhooks/ghl/conversations/{conversation_id}/reconcile-media",
            json={},
            headers={"X-DealerADMIN-Webhook-Secret": GHL_WEBHOOK_SECRET},
            timeout=RECONCILIATION_TIMEOUT,
        )
    except requests.RequestException:
        LOG.warning("media_reconciliation_failed conversation_id=%s reason=request_failed", conversation_id)
        return False
    if not 200 <= response.status_code < 300:
        LOG.warning("media_reconciliation_failed conversation_id=%s status_code=%s", conversation_id, response.status_code)
        return False
    LOG.info("media_reconciliation conversation_id=%s status=ok", conversation_id)
    return True


def process_one(connection: psycopg.Connection[Any], row: dict[str, Any]) -> None:
    suffix = Path(row.get("original_filename") or "").suffix or mimetypes.guess_extension(row.get("content_type") or "") or ".bin"
    with tempfile.TemporaryDirectory(prefix="dealeradmin-media-") as temporary:
        path = Path(temporary) / f"attachment{suffix}"
        content_type, byte_size = download_attachment(row, path)
        digest = sha256_file(path)
        kind = row.get("media_kind")
        if kind not in ("audio", "image"):
            kind = media_kind(content_type, row.get("original_filename"))
        if kind == "audio":
            try:
                probe = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                duration = float(probe.stdout.strip()) if probe.returncode == 0 and probe.stdout.strip() else None
            except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
                raise RetryableMediaError("audio_probe_failed") from exc
            if duration is not None and duration > MAX_DURATION_SECONDS:
                raise NotRetrievable("audio_duration_limit_exceeded")
            text, metadata = transcribe_audio(path)
        elif kind == "image":
            text, metadata = process_image(path)
        else:
            raise NotRetrievable("unsupported_media_kind")
        save_success(connection, row, digest, content_type, byte_size, text, metadata)
        if not notify_reconciliation(row["conversation_id"]):
            raise RetryableMediaError("reconciliation_callback_failed")


def process_pending_attachment() -> bool:
    """Process one available attachment and report whether work was found."""
    with psycopg.connect(database_url(), autocommit=False) as connection:
        row = claim_attachment(connection)
        if not row:
            return False
        try:
            process_one(connection, row)
            LOG.info("media_processed attachment_id=%s status=done", row["id"])
        except NotRetrievable as exc:
            save_failure(connection, row, "not_retrievable", str(exc))
            LOG.warning("media_processed attachment_id=%s status=not_retrievable", row["id"])
        except Exception as exc:  # pragma: no cover - native dependencies/network
            save_failure(connection, row, "failed", type(exc).__name__)
            LOG.warning("media_processed attachment_id=%s status=failed", row["id"])
        return True


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    while True:
        try:
            did_work = process_pending_attachment()
            if MEDIA_RUN_ONCE and not did_work:
                LOG.info("media_worker_complete reason=no_pending_attachments")
                return
            if not did_work:
                time.sleep(POLL_SECONDS)
        except Exception as exc:  # pragma: no cover - deployment/runtime
            LOG.error("media_worker_cycle_failed error=%s", type(exc).__name__)
            if MEDIA_RUN_ONCE:
                raise
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
