import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { AuthService } from '../../auth/application/auth.service';
import { DealerLeadsController } from './dealer-leads.controller';
import { ManualLeadService } from '../application/manual-lead.service';
import { CopyLeadService } from '../application/copy-lead.service';
import { BulkLeadService } from '../application/bulk-lead.service';

@Module({
  controllers: [LeadsController, DealerLeadsController],
  providers: [AuthService, ManualLeadService, BulkLeadService, CopyLeadService],
})
export class LeadsModule {}
