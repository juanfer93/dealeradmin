import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`CREATE TABLE dealers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR UNIQUE NOT NULL,
      name VARCHAR NOT NULL,
      ghl_location_id VARCHAR UNIQUE NOT NULL,
      timezone VARCHAR NOT NULL DEFAULT 'America/Bogota',
      routing_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await queryRunner.query(`CREATE TABLE leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      canonical_phone VARCHAR,
      email VARCHAR,
      first_name VARCHAR,
      last_name VARCHAR,
      ghl_contact_id VARCHAR NOT NULL,
      ghl_location_id VARCHAR NOT NULL,
      source VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_ghl_location_contact UNIQUE (ghl_location_id, ghl_contact_id)
    )`);
    await queryRunner.query(`CREATE TABLE lead_dealers (
      lead_id UUID NOT NULL REFERENCES leads(id),
      dealer_id UUID NOT NULL REFERENCES dealers(id),
      vehicle_type VARCHAR(80),
      down_payment VARCHAR(120),
      purchase_timeline VARCHAR(40),
      documents VARCHAR(250),
      easterns_zone VARCHAR(120),
      routing_status VARCHAR(30) NOT NULL,
      assigned_dealer_id UUID REFERENCES dealers(id),
      routing_override BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      message_text TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lead_id, dealer_id)
    )`);
    await queryRunner.query(`CREATE TABLE webhook_events (
      event_id VARCHAR PRIMARY KEY,
      event_type VARCHAR NOT NULL,
      ghl_location_id VARCHAR NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMPTZ,
      status VARCHAR(30) NOT NULL,
      error_code VARCHAR,
      payload_hash VARCHAR NOT NULL
    )`);
    await queryRunner.query(`CREATE INDEX leads_ghl_location_idx ON leads (ghl_location_id)`);
    await queryRunner.query(`CREATE INDEX lead_dealers_status_idx ON lead_dealers (status)`);
    await queryRunner.query(`CREATE INDEX webhook_events_received_idx ON webhook_events (received_at)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS lead_dealers`);
    await queryRunner.query(`DROP TABLE IF EXISTS leads`);
    await queryRunner.query(`DROP TABLE IF EXISTS dealers`);
  }
}
