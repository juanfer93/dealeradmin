import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { AuthService } from '../../auth/application/auth.service';

@Module({
  controllers: [LeadsController],
  providers: [AuthService],
})
export class LeadsModule {}
