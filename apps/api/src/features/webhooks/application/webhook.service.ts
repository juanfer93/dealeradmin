import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { LeadWebhookDto, LeadWebhookSchema } from '@dealeradmin/contracts';

@Injectable()
export class WebhookService {
  acceptLead(payload: unknown): { accepted: true; eventId: string } {
    const lead = LeadWebhookSchema.safeParse(payload);
    if (!lead.success) {
      throw new UnprocessableEntityException({ code: 'INVALID_LEAD_PAYLOAD', issues: lead.error.issues });
    }
    return this.buildAcceptedResponse(lead.data);
  }

  private buildAcceptedResponse(payload: LeadWebhookDto): { accepted: true; eventId: string } {
    return { accepted: true, eventId: payload.event_id };
  }
}
