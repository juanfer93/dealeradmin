import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateManualLeadRequestDto, BulkDeleteRequestDto } from '../../presentation/lead-request.dto';

const strictPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('lead request validation', () => {
  it('rejects mass-assignment properties instead of passing them to the service', async () => {
    await expect(strictPipe.transform({
      name: 'Ana',
      phone: '3019876543',
      vehicle_type: 'Honda Civic',
      role: 'admin',
      dealer_id: 'other-tenant',
    }, { type: 'body', metatype: CreateManualLeadRequestDto })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects extra nested properties in bulk deletion requests', async () => {
    await expect(strictPipe.transform({
      items: [{ leadId: 'lead-1', dealerId: 'dealer-1', ownerId: 'other-tenant' }],
    }, { type: 'body', metatype: BulkDeleteRequestDto })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized text before the application service executes', async () => {
    await expect(strictPipe.transform({
      name: 'Ana',
      phone: '3019876543',
      documents: 'x'.repeat(10_001),
    }, { type: 'body', metatype: CreateManualLeadRequestDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
