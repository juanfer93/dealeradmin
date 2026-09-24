import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildProblemTicketMarkdown,
  ProblemTicketsService,
  resetTestProblemTicketStore,
} from '../../application/problem-tickets.service';

describe('ProblemTicketsService', () => {
  beforeEach(() => {
    resetTestProblemTicketStore();
  });

  it('generates a user-story Markdown ticket with the required validation contract', () => {
    const markdown = buildProblemTicketMarkdown(7, {
      problem: 'El ticket no conserva el contexto del problema.',
      evidence: 'Conversación de prueba y pasos para reproducir.',
      scope: 'Módulo de problemas.',
      outOfScope: 'No cambiar la cola de leads.',
    }, '2026-09-24T12:00:00.000Z');

    expect(markdown).toContain('# Ticket 0007');
    expect(markdown).toContain('## Historia de usuario');
    expect(markdown).toContain('## Problema reportado\n\nEl ticket no conserva el contexto del problema.');
    expect(markdown).toContain('## Criterios de aceptación');
    expect(markdown).toContain('Las pruebas unitarias deben ejecutarse y pasar al 100%.');
    expect(markdown).toContain('Las pruebas E2E deben ejecutarse con backend y frontend corriendo y pasar al 100%.');
    expect(markdown).toContain('La validación contra la base de datos local debe ejecutarse y pasar al 100%');
    expect(markdown).toContain('## Restricciones');
    expect(markdown).toContain('## Flujo de Git');
    expect(markdown).toContain('docs/problems/README.md');
    expect(markdown).toContain('resolverlos preservando cambios ajenos');
  });

  it('creates, lists, and finds an isolated ticket in test mode', async () => {
    const service = new ProblemTicketsService();
    const ticket = await service.create({
      problem: 'El formulario debe generar un archivo Markdown.',
      evidence: 'Prueba unitaria.',
    });

    expect(ticket.ticketNumber).toBe(1);
    expect(ticket.markdown).toContain('# Ticket 0001');
    expect(ticket.markdown).toContain('El formulario debe generar un archivo Markdown.');
    expect(await service.list()).toHaveLength(1);
    await expect(service.findByNumber(1)).resolves.toMatchObject({ id: ticket.id, ticketNumber: 1 });
    await expect(service.findByNumber(99)).resolves.toBeNull();
  });

  it('rejects an empty problem before generating a ticket', async () => {
    const service = new ProblemTicketsService();

    await expect(service.create({ problem: '   ' })).rejects.toThrow('El problema es obligatorio.');
    await expect(service.list()).resolves.toEqual([]);
  });
});
