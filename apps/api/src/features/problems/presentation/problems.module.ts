import { Module } from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import { ProblemTicketsService } from '../application/problem-tickets.service';
import { ProblemsController } from './problems.controller';

@Module({
  controllers: [ProblemsController],
  providers: [AuthService, ProblemTicketsService],
})
export class ProblemsModule {}
