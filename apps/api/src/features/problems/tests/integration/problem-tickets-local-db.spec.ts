import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemTicketsService } from '../../application/problem-tickets.service';

const databaseUrl = process.env.PROBLEM_TICKETS_DATABASE_URL || process.env.DATABASE_URL;
const runLocalDatabase = process.env.RUN_PROBLEM_TICKETS_DB === '1';
const describeDatabase = runLocalDatabase && databaseUrl && /(localhost|127\.0\.0\.1)/i.test(databaseUrl) ? describe : describe.skip;
const problem = `Local PostgreSQL ticket ${Date.now()}`;

describeDatabase('Problem tickets against local PostgreSQL', () => {
  let dataSource: DataSource;
  let service: ProblemTicketsService;
  let ticketNumber: number;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PROBLEM_TICKETS_DATABASE_URL or DATABASE_URL is required');
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [],
      ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
    await dataSource.initialize();
    const table = await dataSource.query("SELECT to_regclass('public.problem_tickets') AS table_name") as Array<{ table_name: string | null }>;
    if (table[0]?.table_name !== 'problem_tickets') {
      throw new Error('problem_tickets is missing. Run the API migrations against the local database first.');
    }
    service = new ProblemTicketsService(dataSource);
  }, 30_000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query('DELETE FROM problem_tickets WHERE problem = $1', [problem]);
    await dataSource.destroy();
  });

  it('persists Markdown, reads it back, and exposes the generated ticket number', async () => {
    const ticket = await service.create({
      problem,
      evidence: 'Local PostgreSQL evidence.',
      scope: 'Problem tickets only.',
      outOfScope: 'Existing lead queue.',
    });
    ticketNumber = ticket.ticketNumber;

    expect(ticket.markdown).toContain(`# Ticket ${String(ticketNumber).padStart(4, '0')}`);
    expect(ticket.markdown).toContain('Las pruebas unitarias deben ejecutarse y pasar al 100%.');
    expect(ticket.markdown).toContain('Las pruebas E2E deben ejecutarse con backend y frontend corriendo y pasar al 100%.');
    expect(await service.findByNumber(ticketNumber)).toMatchObject({
      ticketNumber,
      problem,
      evidence: 'Local PostgreSQL evidence.',
      scope: 'Problem tickets only.',
      outOfScope: 'Existing lead queue.',
    });
    expect((await service.list()).some((item) => item.ticketNumber === ticketNumber)).toBe(true);
    const stored = await dataSource.query('SELECT markdown FROM problem_tickets WHERE ticket_number = $1', [ticketNumber]) as Array<{ markdown: string }>;
    expect(stored[0]?.markdown).toBe(ticket.markdown);
  });
});
