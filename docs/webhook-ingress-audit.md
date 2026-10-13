# Auditoría durable de webhooks GHL

## Objetivo

`webhook_ingress_logs` conserva la evidencia de entrada antes de que el guard de firma o el procesamiento de Dealeradmin puedan descartar el webhook. Su propósito es separar estas preguntas:

1. ¿La petición alcanzó el backend?
2. ¿La firma o el secreto fueron aceptados?
3. ¿El handler de negocio comenzó?
4. ¿Qué status HTTP devolvió Dealeradmin?
5. ¿El evento terminó procesado o falló antes de `webhook_events`?

El registro se realiza en `WebhookIngressAuditMiddleware`, antes de los guards. El body crudo, su SHA-256 y los metadatos se guardan antes de llamar al controlador. Después se actualizan los hitos de autenticación, handler y respuesta HTTP.

## Latencia de procesamiento

`webhook_processing_attempts` registra una fila por intento de procesamiento después de que el controlador termina. No guarda el texto del mensaje: conserva los IDs de correlación, el estado, los timestamps y un `duration_ms` calculado desde `handler_started_at` (o `received_at`) de `webhook_ingress_logs` hasta la finalización del intento.

La combinación de ambas tablas permite separar la latencia de transporte de la latencia de negocio:

```sql
SELECT i.received_at,
       i.handler_started_at,
       p.completed_at,
       p.persisted_at,
       p.duration_ms,
       p.processing_status,
       p.error_code,
       i.ghl_location_id,
       i.ghl_contact_id,
       i.ghl_conversation_id,
       p.event_id
FROM webhook_ingress_logs i
LEFT JOIN webhook_processing_attempts p ON p.request_id = i.request_id
WHERE i.ghl_contact_id = 'GHL_CONTACT_ID'
ORDER BY i.received_at, p.completed_at;
```

Lectura operacional:

- `webhook_ingress_logs` sin fila: el webhook no alcanzó la aplicación.
- Ingress presente y `webhook_processing_attempts` ausente: el request llegó, pero el handler no terminó o la telemetría falló.
- `processing_status=failed`: el procesamiento terminó con error; `error_code` conserva la causa.
- `persisted_at` no nulo: la transacción de negocio terminó antes de responder.
- `duration_ms` alto: hay que comparar `received_at`, `handler_started_at` y `completed_at` para ubicar la latencia.

## Convención de Fredericksburg

`FRED` y `FRED-2` son dealers distintos, pero ambos llegan intencionalmente a la ubicación de Fredericksburg. Esta relación es permanente y no debe clasificarse como una anomalía de routing o de entrega.

- Para operación, permisos y métricas por dealer, conservar `FRED` y `FRED-2` separados.
- Para auditorías por ubicación, agrupar ambos bajo el mismo `ghl_location_id` de Fredericksburg.
- No corregir ni eliminar el alias solo porque el `ghl_location_id` aparezca asociado a ambos dealers; verificar primero si la consulta está midiendo dealer o ubicación.

## Estados y lectura operacional

| Campo | Significado |
| --- | --- |
| `auth_status=unknown` | La petición fue capturada, pero todavía no se marcó el resultado del guard. |
| `auth_status=accepted` | Se aceptó HMAC, secreto compartido o secreto de cron. |
| `auth_status=rejected` | La petición llegó, pero fue rechazada antes del handler. `auth_reason` explica por qué. |
| `handler_started_at` no nulo | El controlador sí comenzó a procesar la petición. |
| `outcome=accepted` | La respuesta HTTP fue 2xx. No sustituye la confirmación de `webhook_events`. |
| `outcome=rejected` | La respuesta fue 4xx. |
| `outcome=failed` | La respuesta fue 5xx. `error_code` conserva el error controlado por el handler cuando existe. |
| `outcome=connection_closed` | El cliente cerró la conexión antes de terminar la respuesta. |

## Consultas para investigar un caso

Buscar por contacto, evento o ventana horaria:

```sql
SELECT request_id, received_at, source, event_id, event_type,
       ghl_location_id, ghl_contact_id, ghl_conversation_id,
       auth_status, auth_reason, handler_started_at,
       status_code, outcome, error_code, duration_ms, payload_hash
FROM webhook_ingress_logs
WHERE received_at >= TIMESTAMPTZ '2026-10-10 12:00:00+00'
  AND received_at <  TIMESTAMPTZ '2026-10-10 13:30:00+00'
  AND (ghl_contact_id ILIKE '%emmanuel%'
       OR raw_body ILIKE '%Emmanuel Teteh%'
       OR raw_body ILIKE '%15402870414%')
ORDER BY received_at;
```

Comparar la frontera de ingreso con el procesamiento de negocio:

```sql
SELECT i.received_at,
       i.event_id,
       i.auth_status,
       i.handler_started_at,
       i.status_code,
       i.outcome,
       i.error_code,
       e.status AS webhook_event_status,
       e.error_code AS webhook_event_error
FROM webhook_ingress_logs i
LEFT JOIN webhook_events e ON e.event_id = i.event_id
WHERE i.event_id = 'EVENT_ID_DE_GHL'
ORDER BY i.received_at;
```

Interpretación rápida:

- No existe fila en `webhook_ingress_logs`: la petición no alcanzó esta aplicación, o falló antes de que Nest pudiera ejecutar el middleware.
- Existe fila con `auth_status=rejected`: GHL sí llegó; el rechazo ocurrió en autenticación.
- Existe fila con `handler_started_at` y `outcome=failed`: el backend sí comenzó y falló dentro del procesamiento.
- Existe fila `outcome=accepted` sin `webhook_events`: hay que investigar la transacción o una respuesta aceptada antes de la persistencia de negocio.
- Existe `webhook_events.status=failed`: el evento sí fue persistido y el error está disponible en `webhook_events.error_code`.

## Seguridad y retención

`safe_headers` guarda presencia de secretos, timestamp, IDs de GHL, content type y user agent; no guarda `Authorization`, el secreto compartido ni el valor completo de la firma. `raw_body` y `payload` pueden contener PII de compradores, por lo que el acceso debe quedar restringido a operadores autorizados y debe definirse una política de retención antes de que el volumen crezca.

El logging es best-effort: si PostgreSQL está caído, no debe convertir el webhook en un segundo fallo. Por eso el endpoint continúa y el error de logging no reemplaza el resultado del negocio. Una indisponibilidad simultánea de la base y del backend requiere una cola o almacenamiento externo para tener garantía fuera de PostgreSQL.

Las migraciones `1710000030000-WebhookIngressLogs` y `1710000031000-WebhookProcessingAttempts` se aplican junto con las demás migraciones de API. La validación local cubre peticiones aceptadas y rechazadas, además de la persistencia de la traza de procesamiento.
