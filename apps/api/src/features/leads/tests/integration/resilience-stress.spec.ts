import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID, createHmac } from 'node:crypto';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LeadWebhookDto } from '@dealeradmin/contracts';
import { WebhookService } from '../../../webhooks/application/webhook.service';
import { GeoroutingService } from '../../../routing/domain/services/georouting.service';
import { InitialSchema1710000000000 } from '../../../../database/migrations/1710000000000-InitialSchema';
import { AddLeadFinancialDetails1710000001000 } from '../../../../database/migrations/1710000001000-AddLeadFinancialDetails';
import { Day5EasternsRouting1710000002000 } from '../../../../database/migrations/1710000002000-Day5EasternsRouting';
import { HmacSignatureGuard, verifyHmacSignature } from '../../../webhooks/presentation/hmac-signature.guard';
import { WebhooksController } from '../../../webhooks/presentation/webhooks.controller';

const RUN_STRESS_TESTS = process.env.RUN_RESILIENCE_STRESS === '1';
const WEBHOOK_SECRET = 'local-ghl-secret-123456';
const LOCAL_DATABASE_URL = process.env.RESILIENCE_STRESS_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:5432/test';
const RUN_TAG = `resilience-${Date.now()}-${randomUUID().slice(0, 8)}`;
const describeStress = RUN_STRESS_TESTS ? describe : describe.skip;

type DealerFixture = {
  id: string;
  code: string;
  locationId: string;
};

type SignedPayload = {
  payload: LeadWebhookDto;
  rawBody: string;
  signature: string;
};

type WebhookResult = Awaited<ReturnType<WebhookService['acceptLead']>>;

describeStress('Día 7 - Pruebas Masivas de Resiliencia y Concurrencia (15 Dealers)', () => {
  let dataSource: DataSource;
  let testingModule: TestingModule;
  let service: WebhookService;
  const dealers: DealerFixture[] = [];

  beforeAll(async () => {
    assertLocalDatabaseUrl(LOCAL_DATABASE_URL);
    dataSource = new DataSource({
      type: 'postgres',
      url: LOCAL_DATABASE_URL,
      synchronize: false,
      migrationsRun: false,
      migrations: [
        InitialSchema1710000000000,
        AddLeadFinancialDetails1710000001000,
        Day5EasternsRouting1710000002000,
      ],
      ssl: LOCAL_DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });

    await dataSource.initialize();
    await ensureLocalSchema(dataSource);
    await seedDealers(dataSource, dealers);

    testingModule = await Test.createTestingModule({
      providers: [
        {
          provide: WebhookService,
          useFactory: () => new WebhookService(dataSource, new GeoroutingService(dataSource)),
        },
      ],
    }).compile();
    service = testingModule.get(WebhookService);
  }, 30_000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;

    try {
      const dealerIds = dealers.map((dealer) => dealer.id);
      if (dealerIds.length > 0) {
        await dataSource.query('DELETE FROM lead_dealers WHERE dealer_id = ANY($1::uuid[])', [dealerIds]);
        await dataSource.query('DELETE FROM dealers WHERE id = ANY($1::uuid[])', [dealerIds]);
      }
      await dataSource.query('DELETE FROM leads WHERE ghl_contact_id LIKE $1', [`${RUN_TAG}-%`]);
      await dataSource.query('DELETE FROM webhook_events WHERE event_id LIKE $1', [`${RUN_TAG}-%`]);
    } finally {
      await testingModule?.close();
      await dataSource.destroy();
    }
  });

  it('procesa 150 webhooks en una ventana de 2 segundos sin deadlocks', async () => {
    const payloads = Array.from({ length: 150 }, (_, index) => {
      const dealer = dealers[index % dealers.length];
      return buildPayload(`${RUN_TAG}-stress-${index}`, dealer, index, {
        ghl_contact_id: `${RUN_TAG}-contact-${index}`,
        phone: `+1555123${String(index).padStart(4, '0')}`,
      });
    });

    const promises = payloads.map(
      (payload, index) =>
        new Promise<WebhookResult>((resolve, reject) => {
          setTimeout(() => {
            dispatch(payload).then(resolve).catch(reject);
          }, Math.floor((index * 2_000) / payloads.length));
        }),
    );
    const results = await Promise.allSettled(promises);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(150);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(0);
    expect(
      await scalar(
        `SELECT COUNT(*)::int AS count
         FROM webhook_events
         WHERE event_id LIKE $1 AND status = 'processed'`,
        [`${RUN_TAG}-stress-%`],
      ),
    ).toBe(150);
    expect(
      await scalar(
        `SELECT COUNT(*)::int AS count
         FROM lead_dealers ld
         JOIN leads l ON l.id = ld.lead_id
         WHERE l.ghl_contact_id LIKE $1`,
        [`${RUN_TAG}-contact-%`],
      ),
    ).toBe(150);
  }, 40_000);

  it('resuelve tres reintentos del mismo evento como duplicate_ignored sin duplicar lead_dealers', async () => {
    const dealer = dealers[0];
    const payload = buildPayload(`${RUN_TAG}-duplicate`, dealer, 200, {
      ghl_contact_id: `${RUN_TAG}-duplicate-contact`,
      phone: '+15551239999',
    });

    const first = await dispatch(payload);
    const retries = await Promise.all([dispatch(payload), dispatch(payload)]);

    expect(first).toMatchObject({ accepted: true, status: 'processed' });
    expect(retries).toEqual([
      { accepted: true, eventId: payload.event_id, status: 'duplicate_ignored' },
      { accepted: true, eventId: payload.event_id, status: 'duplicate_ignored' },
    ]);
    expect(
      await scalar(
        `SELECT COUNT(*)::int AS count
         FROM webhook_events
         WHERE event_id = $1`,
        [payload.event_id],
      ),
    ).toBe(1);
    expect(
      await scalar(
        `SELECT COUNT(*)::int AS count
         FROM lead_dealers ld
         JOIN leads l ON l.id = ld.lead_id
         WHERE l.ghl_contact_id = $1`,
        [payload.ghl_contact_id],
      ),
    ).toBe(1);
  }, 20_000);

  it('conserva la cualificación completa cuando el webhook actualizado llega antes que el base', async () => {
    const dealer = dealers[1];
    const contactId = `${RUN_TAG}-out-of-order-contact`;
    const phone = '+15551238888';
    const completeUpdate = buildPayload(`${RUN_TAG}-out-of-order-update`, dealer, 300, {
      ghl_contact_id: contactId,
      phone,
      name: 'Lead Completo',
      vehicle_type: 'SUV',
      down_payment: '$4,500',
      identification: 'ID-OUT-OF-ORDER',
      bank_account: 'Cuenta verificada',
      purchase_timeline: 'Este mes',
      documents: 'Licencia e ID',
    });
    const baseCreate = buildPayload(`${RUN_TAG}-out-of-order-base`, dealer, 301, {
      ghl_contact_id: contactId,
      phone,
      name: 'Lead Base',
    });

    expect(await dispatch(completeUpdate)).toMatchObject({ accepted: true, status: 'processed' });
    expect(await dispatch(baseCreate)).toMatchObject({ accepted: true, status: 'processed' });

    const rows = await dataSource.query(
      `SELECT ld.vehicle_type, ld.down_payment, ld.identification, ld.bank_account,
              ld.purchase_timeline, ld.documents, ld.message_text
       FROM lead_dealers ld
       JOIN leads l ON l.id = ld.lead_id
       WHERE l.ghl_contact_id = $1`,
      [contactId],
    ) as Array<Record<string, string>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vehicle_type: 'SUV',
      down_payment: '$4,500',
      identification: 'ID-OUT-OF-ORDER',
      bank_account: 'Cuenta verificada',
      purchase_timeline: 'Este mes',
      documents: 'Licencia e ID',
    });
    expect(rows[0].message_text).toContain('SUV');
    expect(rows[0].message_text).toContain('$4,500');
  }, 20_000);

  it('hace rollback ante una falla de conexión simulada y registra el webhook como failed', async () => {
    const dealer = dealers[2];
    const payload = buildPayload(`${RUN_TAG}-database-failure`, dealer, 400, {
      ghl_contact_id: `${RUN_TAG}-database-failure-contact`,
      phone: '+15551237777',
    });
    const fault = new Error('NEON_DB_CONNECTION_LOST');
    const faultDataSource = createFaultInjectingDataSource(dataSource, fault);
    const faultService = new WebhookService(faultDataSource, new GeoroutingService(dataSource));
    await expect(faultService.acceptLead(payload, signedPayload(payload).rawBody)).rejects.toThrow(fault.message);
    expect(
      await scalar('SELECT COUNT(*)::int AS count FROM leads WHERE ghl_contact_id = $1', [payload.ghl_contact_id]),
    ).toBe(0);
    const failedEvents = await dataSource.query(
      `SELECT status, error_code
       FROM webhook_events
       WHERE event_id = $1`,
      [payload.event_id],
    ) as Array<{ status: string; error_code: string | null }>;
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({ status: 'failed', error_code: fault.message });

    const httpModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhookService, useValue: { acceptLead: async () => { throw fault; } } },
        { provide: HmacSignatureGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();
    const httpApp = httpModule.createNestApplication({ rawBody: true, logger: false });
    await httpApp.listen(0, '127.0.0.1');

    try {
      const address = httpApp.getHttpServer().address();
      if (!address || typeof address === 'string') throw new Error('Nest did not expose an ephemeral HTTP port');
      const response = await postJson(address.port, signedPayload(payload));
      expect(response.statusCode).toBe(500);
    } finally {
      await httpApp.close();
    }
  }, 20_000);

  async function dispatch(payload: LeadWebhookDto): Promise<WebhookResult> {
    const request = signedPayload(payload);
    expect(verifyHmacSignature(Buffer.from(request.rawBody), request.signature, WEBHOOK_SECRET)).toBe(true);
    return service.acceptLead(request.payload, request.rawBody);
  }

  async function scalar(sql: string, parameters: unknown[]): Promise<number> {
    const rows = await dataSource.query(sql, parameters);
    return Number((rows as Array<{ count: number }>)[0].count);
  }
});

function buildPayload(
  eventId: string,
  dealer: DealerFixture,
  index: number,
  overrides: Partial<LeadWebhookDto['lead']> & Partial<Pick<LeadWebhookDto, 'ghl_contact_id'>> = {},
): LeadWebhookDto {
  const { ghl_contact_id: contactId, ...leadOverrides } = overrides;
  return {
    event_id: eventId,
    event_type: 'lead.ready_for_whatsapp',
    occurred_at: new Date(Date.now() + index).toISOString(),
    dealer_id: dealer.code,
    dealer_name: `Dealer Stress Test ${dealer.code}`,
    ghl_location_id: dealer.locationId,
    ghl_contact_id: contactId ?? `${RUN_TAG}-contact-default-${index}`,
    lead: {
      name: `Lead Resiliencia ${index}`,
      phone: `+1555000${String(index).padStart(4, '0')}`,
      vehicle_type: 'SUV',
      ...leadOverrides,
    },
  };
}

function signedPayload(payload: LeadWebhookDto): SignedPayload {
  const rawBody = JSON.stringify(payload);
  return {
    payload,
    rawBody,
    signature: `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`,
  };
}

function assertLocalDatabaseUrl(databaseUrl: string): void {
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error(`Resilience stress tests only allow a local PostgreSQL host; received ${hostname}`);
  }
}

async function ensureLocalSchema(dataSource: DataSource): Promise<void> {
  const [{ exists }] = await dataSource.query(
    `SELECT to_regclass('public.dealers') IS NOT NULL AS exists`,
  ) as Array<{ exists: boolean }>;
  if (!exists) {
    await dataSource.runMigrations();
    return;
  }

  await dataSource.query("ALTER TABLE lead_dealers ADD COLUMN IF NOT EXISTS identification VARCHAR(120) NOT NULL DEFAULT ''");
  await dataSource.query("ALTER TABLE lead_dealers ADD COLUMN IF NOT EXISTS bank_account VARCHAR(160) NOT NULL DEFAULT ''");
  await dataSource.query('ALTER TABLE lead_dealers ADD COLUMN IF NOT EXISTS routing_reason TEXT');
}

async function seedDealers(dataSource: DataSource, target: DealerFixture[]): Promise<void> {
  for (let index = 0; index < 15; index += 1) {
    const code = `${RUN_TAG}-DLR-${String(index + 1).padStart(2, '0')}`;
    const locationId = `${RUN_TAG}-loc-${String(index + 1).padStart(2, '0')}`;
    const rows = await dataSource.query(
      `INSERT INTO dealers (code, name, ghl_location_id, routing_config, active)
       VALUES ($1, $2, $3, '{}'::jsonb, true)
       RETURNING id`,
      [code, `Dealer Stress Test ${index + 1}`, locationId],
    ) as Array<{ id: string }>;
    target.push({ id: rows[0].id, code, locationId });
  }
}

function createFaultInjectingDataSource(dataSource: DataSource, fault: Error): DataSource {
  const faultDataSource = {
    query: dataSource.query.bind(dataSource),
    createQueryRunner: () => {
      const queryRunner = dataSource.createQueryRunner();
      const originalQuery = queryRunner.query.bind(queryRunner);
      queryRunner.query = (async (sql: string, parameters?: unknown[]) => {
        if (sql.includes('INSERT INTO lead_dealers')) throw fault;
        return originalQuery(sql, parameters as never);
      }) as typeof queryRunner.query;
      return queryRunner;
    },
  } as unknown as DataSource;
  return faultDataSource;
}

function postJson(port: number, signed: SignedPayload): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/webhooks',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(signed.rawBody),
          'x-ghl-signature': signed.signature,
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.resume();
        response.once('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
      },
    );
    clientRequest.once('error', reject);
    clientRequest.end(signed.rawBody);
  });
}
