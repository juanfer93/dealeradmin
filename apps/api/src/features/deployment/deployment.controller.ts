import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { DeploymentRegistryService } from './deployment-registry.service';

@Controller('deployment')
export class DeploymentController {
  constructor(private readonly deploymentRegistry: DeploymentRegistryService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  getStatus() {
    return this.deploymentRegistry.getStatus();
  }

  @Get('commit')
  @Header('Cache-Control', 'no-store')
  async getVerifiedCommit(): Promise<string> {
    const status = await this.deploymentRegistry.confirmRunningCommit();
    if (!status.matches || !status.runtimeCommitSha || !status.confirmedAt) {
      throw new ServiceUnavailableException('Running commit is not confirmed in the deployment registry');
    }
    return status.runtimeCommitSha;
  }
}
