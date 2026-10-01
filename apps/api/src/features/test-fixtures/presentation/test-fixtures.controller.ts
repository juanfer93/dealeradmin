import { Controller, Post } from '@nestjs/common';
import { resetTestLeadStore } from '../../leads/application/test-lead-store';

@Controller('test')
export class TestFixturesController {
  @Post('reset')
  reset(): { ok: true } {
    resetTestLeadStore();
    return { ok: true };
  }
}
