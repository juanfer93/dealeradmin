import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../../auth/application/auth.service';
import { CreateProblemTicketInput, ProblemTicketsService } from '../application/problem-tickets.service';

@Controller('problems')
export class ProblemsController {
  constructor(
    private readonly problemTicketsService: ProblemTicketsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  list(@Req() request: Request) {
    this.requireSession(request);
    return this.problemTicketsService.list();
  }

  @Post()
  create(@Req() request: Request, @Body() body: Partial<CreateProblemTicketInput>) {
    this.requireSession(request);
    const problem = typeof body.problem === 'string' ? body.problem.trim() : '';
    if (!problem) throw new BadRequestException('El problema es obligatorio.');
    return this.problemTicketsService.create({
      problem,
      evidence: typeof body.evidence === 'string' ? body.evidence : '',
      scope: typeof body.scope === 'string' ? body.scope : '',
      outOfScope: typeof body.outOfScope === 'string' ? body.outOfScope : '',
    });
  }

  @Get(':ticketNumber/markdown')
  async markdown(@Req() request: Request, @Param('ticketNumber') ticketNumberValue: string, @Res() response: Response): Promise<void> {
    this.requireSession(request);
    const ticket = await this.getTicket(ticketNumberValue);
    const fileName = `ticket-${String(ticket.ticketNumber).padStart(4, '0')}.md`;
    response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    response.send(ticket.markdown);
  }

  @Get(':ticketNumber')
  async get(@Req() request: Request, @Param('ticketNumber') ticketNumberValue: string) {
    this.requireSession(request);
    return this.getTicket(ticketNumberValue);
  }

  private async getTicket(ticketNumberValue: string) {
    if (!/^\d+$/.test(ticketNumberValue)) throw new BadRequestException('El número de ticket no es válido.');
    const ticket = await this.problemTicketsService.findByNumber(Number(ticketNumberValue));
    if (!ticket) throw new NotFoundException('Ticket no encontrado.');
    return ticket;
  }

  private requireSession(request: Request): void {
    if (!this.authService.verifySession(request.cookies?.dealeradmin_session)) {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
