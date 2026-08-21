import { CreateManualLeadSchema } from '@dealeradmin/contracts';
import { BadRequestException, Body, Controller, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../../auth/application/auth.service';
import { ManualLeadService } from '../application/manual-lead.service';

@Controller('dealers')
export class DealerLeadsController {
  constructor(
    private readonly manualLeadService: ManualLeadService,
    private readonly authService: AuthService,
  ) {}

  @Post(':dealerId/leads')
  async createManualLead(
    @Req() request: Request,
    @Param('dealerId') dealerId: string,
    @Body() body: unknown,
  ) {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }

    const parsed = CreateManualLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Datos del lead inválidos', issues: parsed.error.issues });
    }

    return this.manualLeadService.execute(dealerId, parsed.data);
  }
}
