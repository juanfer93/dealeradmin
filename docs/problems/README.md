# Flujo de trabajo de tickets para Codex

Este documento define el procedimiento para cualquier ticket generado desde la sección **Problemas** de `dealerADMIN`.

## Regla de entrada

El ticket Markdown creado por el operador es la fuente de verdad para el problema, la evidencia, el alcance y las restricciones. El agente no debe inventar un problema ni ampliar el alcance sin autorización.

## Flujo obligatorio

1. Leer el ticket completo y este README antes de tocar código.
2. Partir de `main` actualizado y crear una rama exclusiva para el ticket con el formato `codex/ticket-<numero>`.
3. Revisar el estado del worktree y preservar cualquier cambio que no pertenezca al ticket.
4. Convertir el ticket en un plan corto de implementación y criterios verificables.
5. Implementar únicamente dentro del alcance indicado.
6. Ejecutar y hacer pasar al 100% las pruebas unitarias.
7. Levantar backend y frontend localmente y ejecutar las pruebas E2E; deben pasar al 100%.
8. Ejecutar la validación contra la base de datos PostgreSQL local cuando el ticket persista o consulte datos; debe pasar al 100%.
9. Separar en el reporte la evidencia unitaria, E2E, backend/frontend local, base de datos local, Docker, despliegue y producción.
10. Hacer commit únicamente de los archivos del ticket y subir la rama a GitHub.
11. Integrar la rama en `main`.
12. Si aparecen conflictos, resolverlos conservando cambios ajenos y el alcance del ticket. Después de resolverlos se deben repetir todas las pruebas.
13. Si el conflicto requiere una decisión de negocio o no hay evidencia suficiente para elegir una versión, detenerse y pedir instrucciones.
14. El ticket solo se considera terminado cuando unitarias, E2E con backend/frontend, base de datos local, merge y validación están completos al 100%.

## Comandos mínimos de validación

Desde la raíz del repositorio, el agente debe documentar por separado la salida de estos comandos:

```powershell
pnpm typecheck
pnpm test:unit
pnpm test:e2e
```

Para este módulo, la prueba de persistencia debe ejecutarse con PostgreSQL local, backend y frontend levantados cuando corresponda. Después de aplicar las migraciones, ejecutar la integración contra una URL `localhost` o `127.0.0.1`:

```powershell
$env:PROBLEM_TICKETS_DATABASE_URL='postgresql://test:test@127.0.0.1:5432/test'
$env:RUN_PROBLEM_TICKETS_DB='1'
pnpm test:unit
```

La evidencia no es 100% si el comando de integración queda omitido, si se usa una base remota en lugar de la base local o si backend/frontend no se levantaron para la validación E2E.

## Límites de seguridad

- No modificar datos reales, enviar mensajes, cambiar GHL, desplegar ni enviar correos sin autorización explícita para ese paso.
- No hacer `reset`, `checkout` destructivo ni borrar cambios ajenos del worktree.
- No declarar que producción está validada basándose solamente en pruebas locales.
- No resolver un conflicto sobrescribiendo silenciosamente trabajo de otro ticket.

## Evidencia final requerida

El reporte final debe indicar exactamente:

- archivos modificados;
- commit y rama;
- resultado de unitarias;
- resultado de typecheck/build;
- resultado de E2E;
- resultado de Docker/PostgreSQL, si aplica;
- resultado del merge;
- cualquier evidencia externa que todavía falte.
