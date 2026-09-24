import { Controller, Post } from '@nestjs/common';
import { resetTestLeadStore } from '../../leads/application/test-lead-store';
import { resetTestProblemTicketStore } from '../../problems/application/problem-tickets.service';

@Controller('test')
export class TestFixturesController {
  @Post('reset')
  reset(): { ok: true } {
    resetTestLeadStore();
    resetTestProblemTicketStore();
    return { ok: true };
  }
}
