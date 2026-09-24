import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type CreateProblemTicketInput = {
  problem: string;
  evidence?: string;
  scope?: string;
  outOfScope?: string;
};

export type ProblemTicket = {
  id: string;
  ticketNumber: number;
  problem: string;
  evidence: string;
  scope: string;
  outOfScope: string;
  markdown: string;
  createdAt: string;
};

const EMPTY_VALUE = 'No se proporcionó.';

const GENERATED_ACCEPTANCE_CRITERIA = [
  'El problema reportado debe quedar reproducido o respaldado por la evidencia disponible.',
  'La solución debe cubrir el comportamiento esperado descrito en este ticket.',
  'Las pruebas unitarias deben ejecutarse y pasar al 100%.',
  'Las pruebas E2E deben ejecutarse con backend y frontend corriendo y pasar al 100%.',
  'La validación contra la base de datos local debe ejecutarse y pasar al 100% cuando el ticket persista o consulte datos.',
  'La funcionalidad existente fuera del alcance debe conservar su comportamiento.',
  'El reporte final debe separar la evidencia unitaria, E2E, backend/frontend local, base de datos local, Docker y producción.',
];

const GENERATED_RESTRICTIONS = [
  'Modificar únicamente las áreas necesarias para resolver este ticket.',
  'No tocar funcionalidades no relacionadas ni cambios existentes del worktree.',
  'No modificar datos reales, enviar mensajes, desplegar ni publicar sin autorización explícita para ese paso.',
  'Las imágenes o archivos visuales de prueba se adjuntarán por separado y no se almacenan dentro del Markdown.',
  'El ticket no se considera terminado si alguna de las validaciones requeridas no pasa al 100%.',
];

const testProblemTickets: ProblemTicket[] = [];
let nextTestTicketNumber = 1;

function normalize(value: string | undefined): string {
  return value?.trim() ?? '';
}

function markdownSection(title: string, value: string): string {
  return `## ${title}\n\n${value || EMPTY_VALUE}`;
}

export function buildProblemTicketMarkdown(ticketNumber: number, input: CreateProblemTicketInput, createdAt: string): string {
  const problem = normalize(input.problem);
  const evidence = normalize(input.evidence);
  const scope = normalize(input.scope);
  const outOfScope = normalize(input.outOfScope);
  const criteria = GENERATED_ACCEPTANCE_CRITERIA.map((item) => `- ${item}`).join('\n');
  const restrictions = GENERATED_RESTRICTIONS.map((item) => `- ${item}`).join('\n');

  return [
    `# Ticket ${String(ticketNumber).padStart(4, '0')}`,
    '',
    `Creado: ${createdAt}`,
    '',
    '## Historia de usuario',
    '',
    'Como responsable de la operación de dealerADMIN,',
    'quiero reportar este problema con su contexto y evidencia,',
    'para que pueda ser investigado, corregido y validado sin afectar funcionalidades no relacionadas.',
    '',
    markdownSection('Problema reportado', problem),
    '',
    markdownSection('Evidencia', evidence),
    '',
    markdownSection('Alcance', scope),
    '',
    markdownSection('Fuera de alcance', outOfScope),
    '',
    '## Criterios de aceptación',
    '',
    criteria,
    '',
    '## Restricciones',
    '',
    restrictions,
    '',
    '## Flujo de Git',
    '',
    '- Antes de trabajar, leer `docs/problems/README.md`, que define el procedimiento completo para este tipo de ticket.',
    `- Crear una rama de trabajo desde \`main\`: \`codex/ticket-${String(ticketNumber).padStart(4, '0')}\`.`,
    '- Mantener los cambios de este ticket aislados de otras funcionalidades y del worktree existente.',
    '- Ejecutar y documentar todas las pruebas requeridas antes de hacer commit.',
    '- Hacer commit y push únicamente de los archivos pertenecientes a este ticket.',
    '- Hacer merge de la rama a `main` solamente después de que la validación esté al 100%.',
    '- Si hay conflictos, resolverlos preservando cambios ajenos y el alcance del ticket; después repetir todas las pruebas.',
    '- Si el conflicto requiere una decisión de negocio o no tiene una resolución respaldada por evidencia, detenerse y solicitar instrucciones.',
    '',
    '## Estado',
    '',
    'Pendiente de análisis e implementación.',
    '',
    '---',
    '',
    'Generado por dealerADMIN para el flujo de trabajo de Codex.',
    '',
  ].join('\n');
}

function toIsoTimestamp(value: unknown, fallback: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function queryRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as Array<Record<string, unknown>>;
  }
  return result as Array<Record<string, unknown>>;
}

function toTicket(row: Record<string, unknown>, fallbackCreatedAt: string): ProblemTicket {
  const value = (snakeCase: string, camelCase: string): unknown => row[snakeCase] ?? row[camelCase];
  return {
    id: String(value('id', 'id')),
    ticketNumber: Number(value('ticket_number', 'ticketNumber')),
    problem: String(value('problem', 'problem')),
    evidence: String(value('evidence', 'evidence') ?? ''),
    scope: String(value('scope', 'scope') ?? ''),
    outOfScope: String(value('out_of_scope', 'outOfScope') ?? ''),
    markdown: String(value('markdown', 'markdown')),
    createdAt: toIsoTimestamp(value('created_at', 'createdAt'), fallbackCreatedAt),
  };
}

@Injectable()
export class ProblemTicketsService {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  async create(input: CreateProblemTicketInput): Promise<ProblemTicket> {
    const problem = normalize(input.problem);
    if (!problem) throw new Error('El problema es obligatorio.');

    const createdAt = new Date().toISOString();
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      const ticketNumber = nextTestTicketNumber++;
      const ticket: ProblemTicket = {
        id: `test-problem-ticket-${ticketNumber}`,
        ticketNumber,
        problem,
        evidence: normalize(input.evidence),
        scope: normalize(input.scope),
        outOfScope: normalize(input.outOfScope),
        markdown: buildProblemTicketMarkdown(ticketNumber, input, createdAt),
        createdAt,
      };
      testProblemTickets.unshift(ticket);
      return ticket;
    }

    if (!this.dataSource) throw new Error('Database connection is not available');

    const rows = queryRows(await this.dataSource.query(
      `INSERT INTO problem_tickets (problem, evidence, scope, out_of_scope, markdown)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), '')
       RETURNING id, ticket_number, problem, evidence, scope, out_of_scope, created_at`,
      [problem, normalize(input.evidence), normalize(input.scope), normalize(input.outOfScope)],
    ));
    const ticketNumber = Number(rows[0]?.ticket_number);
    const persistedCreatedAt = toIsoTimestamp(rows[0]?.created_at, createdAt);
    const markdown = buildProblemTicketMarkdown(ticketNumber, input, persistedCreatedAt);
    const updated = queryRows(await this.dataSource.query(
      `UPDATE problem_tickets SET markdown = $2 WHERE id = $1
       RETURNING id, ticket_number, problem, evidence, scope, out_of_scope, markdown, created_at`,
      [rows[0]?.id, markdown],
    ));
    return toTicket(updated[0], persistedCreatedAt);
  }

  async list(): Promise<ProblemTicket[]> {
    if (!this.dataSource && process.env.NODE_ENV === 'test') return [...testProblemTickets];
    if (!this.dataSource) throw new Error('Database connection is not available');

    const rows = queryRows(await this.dataSource.query(
      `SELECT id, ticket_number, problem, evidence, scope, out_of_scope, markdown, created_at
       FROM problem_tickets ORDER BY ticket_number DESC LIMIT 50`,
    ));
    return rows.map((row) => toTicket(row, new Date().toISOString()));
  }

  async findByNumber(ticketNumber: number): Promise<ProblemTicket | null> {
    if (!this.dataSource && process.env.NODE_ENV === 'test') {
      return testProblemTickets.find((ticket) => ticket.ticketNumber === ticketNumber) ?? null;
    }
    if (!this.dataSource) throw new Error('Database connection is not available');

    const rows = queryRows(await this.dataSource.query(
      `SELECT id, ticket_number, problem, evidence, scope, out_of_scope, markdown, created_at
       FROM problem_tickets WHERE ticket_number = $1`,
      [ticketNumber],
    ));
    return rows[0] ? toTicket(rows[0], new Date().toISOString()) : null;
  }
}

export function resetTestProblemTicketStore(): void {
  testProblemTickets.splice(0, testProblemTickets.length);
  nextTestTicketNumber = 1;
}
