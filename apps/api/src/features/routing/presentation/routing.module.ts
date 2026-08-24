import { Module } from '@nestjs/common';
import { GeoroutingService } from '../domain/services/georouting.service';

const routingProviders = process.env.NODE_ENV === 'test' ? [] : [GeoroutingService];

@Module({
  providers: routingProviders,
  exports: routingProviders,
})
export class RoutingModule {}
