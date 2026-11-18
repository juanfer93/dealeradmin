import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';

type DeploymentRow = {
  commit_sha: string;
  instance_id: string;
  started_at: Date | string;
  confirmed_at: Date | string | null;
};

@Injectable()
export class DeploymentRegistryService implements OnApplicationBootstrap {
  private readonly target = process.env.DEALERADMIN_DEPLOYMENT_TARGET?.trim() || '';
  private readonly runtimeCommitSha = process.env.DEALERADMIN_GIT_SHA?.trim().toLowerCase() || '';

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.target || !/^[a-f0-9]{7,40}$/.test(this.runtimeCommitSha)) return;
    await this.dataSource.query(
      `INSERT INTO deployment_registry (target, commit_sha, instance_id)
       VALUES ($1, $2, $3)`,
      [this.target, this.runtimeCommitSha, hostname()],
    );
  }

  async getStatus() {
    const rows = this.target
      ? await this.dataSource.query<DeploymentRow[]>(
        `SELECT commit_sha, instance_id, started_at, confirmed_at
         FROM deployment_registry
         WHERE target = $1
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
        [this.target],
      )
      : [];
    const latest = rows[0];
    const runtimeCommitSha = /^[a-f0-9]{7,40}$/.test(this.runtimeCommitSha) ? this.runtimeCommitSha : null;
    const databaseCommitSha = latest?.commit_sha ?? null;
    return {
      target: this.target || null,
      runtimeCommitSha,
      databaseCommitSha,
      instanceId: latest?.instance_id ?? null,
      startedAt: latest?.started_at ?? null,
      confirmedAt: latest?.confirmed_at ?? null,
      matches: Boolean(runtimeCommitSha && databaseCommitSha === runtimeCommitSha),
    };
  }

  async confirmRunningCommit() {
    const status = await this.getStatus();
    if (!status.matches || !this.target || !status.runtimeCommitSha) return status;
    await this.dataSource.query(
      `UPDATE deployment_registry
       SET confirmed_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id
         FROM deployment_registry
         WHERE target = $1
         ORDER BY started_at DESC, id DESC
         LIMIT 1
       ) AND commit_sha = $2`,
      [this.target, status.runtimeCommitSha],
    );
    return this.getStatus();
  }
}
