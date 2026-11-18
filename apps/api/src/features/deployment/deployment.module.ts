import { Module } from '@nestjs/common';
import { DeploymentController } from './deployment.controller';
import { DeploymentRegistryService } from './deployment-registry.service';

@Module({
  controllers: [DeploymentController],
  providers: [DeploymentRegistryService],
})
export class DeploymentModule {}
