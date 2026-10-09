# Corrección de leads manuales sin estado `queued`

Fecha: 2026-10-09
Alcance ejecutado: Carlitos Caguana (Easterns Automotive Group) y Ruben Albarenga (Koons Automotive / Culpeper). Anthony Carranza queda descartado por latencia/upstream, según la instrucción recibida.

## Evidencia y causa raíz

### Carlitos Caguana

- GHL: conversación `FGRsbxVudv8SwiS6td9z`, contacto `8wkClolod9dGWsQjHZ2R`.
- Transcript relevante: `Un auto`, `Pequeño`, `Baltimore`, `4438392149`.
- Neon ya tenía el teléfono `+14438392149` y la ubicación `Baltimore`, pero el snapshot había omitido el vehículo. La persistencia disponible en Neon no contenía todos los mensajes observados en GHL.
- Además, la normalización standalone evaluaba la ubicación únicamente contra el último mensaje. Cuando el último mensaje era el teléfono, perdía `Baltimore`.
- Corrección: la ubicación ahora se busca en el historial acotado completo y el replay del transcript produce `Sedan`, `Baltimore`, teléfono `+14438392149`, `qualification_complete=true`, `missing=[]`.

### Ruben Albarenga

- GHL: conversación `KZgyi3z1FafYlWuCCgY2`, contacto `ZPiZzJzRjqeryqSGz7es`.
- El mensaje persistido en Neon contiene el teléfono como `301,659,90 59`.
- El lead quedó `partial` porque el parser no aceptaba comas como separadores válidos, aunque los dígitos correspondían a un teléfono de 10 dígitos.
- Corrección: el normalizador ahora acepta comas en teléfonos directos y embebidos. El replay produce `truck`, teléfono `+13016599059`, `qualification_complete=true`, `missing=[]`.

### Anthony Carranza

- El teléfono final observado en GHL no estaba representado en los mensajes/webhooks persistidos en Neon.
- Se clasifica como latencia o pérdida upstream de entrega y se excluye del alcance de esta corrección; no se fuerza un replay ni se altera su registro.

## Cambios de código

- Soporte de coma como separador telefónico en el normalizador TypeScript y en el custom code GHL.
- Búsqueda de ubicación en el historial reciente, no solo en el último mensaje.
- Regeneración del entrypoint standalone GHL.
- Regresiones unitarias para el transcript exacto de Carlitos y el teléfono agrupado de Ruben.

## Validación

- Pruebas enfocadas: `501/501` pasando en 2 archivos.
- Suite Vitest directa: `809 passed`, `61 skipped` por diseño de integración; `34 passed`, `9 skipped` suites.
- TypeScript de `packages/config`: pasa.
- TypeScript de `packages/contracts`: pasa.
- Build API Nest: pasa.
- Build web Next: pasa.
- Docker PostgreSQL `c20d4b05ae50be641c04709c5bff0b91ef3229abbab50e669115e175b2c6144e`: activo como `dealeradmin-postgres`, puerto `5432` publicado.
- `pnpm test:unit`: no inicia por el wrapper local de pnpm, con error `unable to open database file`; la ejecución equivalente directa de Vitest sí pasó.
- E2E Playwright: `4 passed`, `24 failed`. Los fallos observados son de contrato/entorno E2E existente: fixtures que esperan HTTP `201` reciben `200`, y flujos autenticados/landing no llegan al estado esperado. No se presentan como evidencia de fallo del normalizador de Carlitos o Ruben.

No se hicieron escrituras en GHL ni Neon. Tampoco se incluyeron cambios previos no relacionados del workspace.
