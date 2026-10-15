import { Controller, Optional, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { resetTestLeadStore } from '../../leads/application/test-lead-store';
import { resetDatabaseTestFixtures } from '../application/database-test-fixtures';

@Controller('test')
export class TestFixturesController {
  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  @Post('reset')
  async reset(): Promise<{ ok: true }> {
    resetTestLeadStore();
    if (this.dataSource && process.env.E2E_USE_DATABASE === 'true') {
      await resetDatabaseTestFixtures(this.dataSource);
    }
    return { ok: true };
  }
}
