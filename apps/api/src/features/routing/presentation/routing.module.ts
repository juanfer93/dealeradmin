import { Module } from '@nestjs/common';
import { GeoroutingService } from '../domain/services/georouting.service';

const routingProviders = process.env.NODE_ENV === 'test' && process.env.E2E_USE_DATABASE !== 'true' ? [] : [GeoroutingService];

@Module({
  providers: routingProviders,
  exports: routingProviders,
})
export class RoutingModule {}
