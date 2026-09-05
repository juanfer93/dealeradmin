import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

type LocationSeed = {
  state_code: string;
  state_name: string;
  name: string;
  normalized_name: string;
  place_type: string;
  latitude: number;
  longitude: number;
};

const BATCH_SIZE = 250;
const SOURCE = 'US Census Gazetteer 2024';

export class LocationCatalogSeed1710000009000 implements MigrationInterface {
  name = 'LocationCatalogSeed1710000009000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const filePath = resolve(__dirname, '../data/locations.us-2024.json');
    const rows = JSON.parse(readFileSync(filePath, 'utf8')) as LocationSeed[];
    if (!rows.length) throw new Error('Location seed is empty');

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row, index) => {
        const offset = index * 7;
        values.push(row.state_code, row.state_name, row.name, row.normalized_name, row.place_type, row.latitude, row.longitude);
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, '${SOURCE}')`;
      });

      await queryRunner.query(
        `INSERT INTO locations
           (state_code, state_name, name, normalized_name, place_type, latitude, longitude, source)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (state_code, normalized_name, place_type, latitude, longitude) DO UPDATE SET
           state_name = EXCLUDED.state_name,
           name = EXCLUDED.name,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           source = EXCLUDED.source,
           updated_at = CURRENT_TIMESTAMP`,
        values,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE FROM locations WHERE source = $1', [SOURCE]);
  }
}
