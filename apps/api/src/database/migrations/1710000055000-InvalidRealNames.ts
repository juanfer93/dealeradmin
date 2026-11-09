import { MigrationInterface, QueryRunner } from 'typeorm';

export class InvalidRealNames1710000055000 implements MigrationInterface {
  name = 'InvalidRealNames1710000055000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS invalid_real_names (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
        normalized_value TEXT NOT NULL,
        display_value TEXT NOT NULL,
        reason VARCHAR(80) NOT NULL,
        observation_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT invalid_real_names_channel_valid CHECK (channel IN ('all', 'whatsapp')),
        CONSTRAINT invalid_real_names_value_length CHECK (length(normalized_value) BETWEEN 1 AND 180),
        CONSTRAINT invalid_real_names_normalized_unique UNIQUE (channel, normalized_value)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS invalid_real_names_channel_idx ON invalid_real_names (channel, normalized_value)`);
    await queryRunner.query(`
      INSERT INTO invalid_real_names (channel, normalized_value, display_value, reason)
      SELECT 'all', lower(regexp_replace(trim(display_value), '\\s+', ' ', 'g')), display_value, 'seeded_invalid_real_name'
      FROM (VALUES
        ('.'), ('..'), ('...'), ('unknown'), ('n/a'), ('na'), ('lead'), ('location'), ('whatsapp'), ('facebook'),
        ('opportunity created'), ('employee action log created'), ('dnd enabled by customer'),
        ('for sure'), ('sorry'), ('hola le saluda'), ('le saluda'), ('les saluda'), ('mañana'), ('manana'), ('mkt'),
        ('saludos'), ('hello'), ('hi'), ('hey'), ('hola'), ('ola'), ('greetings'), ('buen dia'), ('buen día'),
        ('buen dis'), ('buenos dias'), ('buenos días'), ('buenas tardes'), ('buenas noches'),
        ('bendiciones'), ('buenos dias bendiciones'), ('buenas tardes bendiciones'), ('buenas noches bendiciones'),
        ('solo whatsapp'), ('solo whasap'), ('thu chikitha linda'), ('primera vez'), ('exacto'), ('exactamente'),
        ('stop'), ('estaré pendiente'), ('estare pendiente'),
        ('in pa'), ('in messenger'), ('tienes tacomas'), ('información'), ('informacion'), ('más información'),
        ('mas informacion'), ('más info'), ('mas info'), ('more information'), ('more info'), ('details'), ('detalles'),
        ('como asi'), ('como así'), ('cómo asi'), ('cómo así'), ('how so'), ('what do you mean'),
        ('me lo puede explicar'), ('me puede explicar'), ('me lo puedes explicar'), ('me puedes explicar'),
        ('mes'), ('estoy'), ('ahorita estoy trabajando'), ('estoy trabajando luego chat'), ('trabajando luego chat'),
        ('esa era la pregunta'), ('una ven talvez'), ('una ven tal vez'), ('puedo llamar'),
        ('por donde está el local'), ('por donde esta el local'), ('usada'), ('usado'), ('usadas'), ('usados'),
        ('disculpe son un dealer'), ('para aprobar'), ('precio'), ('nose depende cuánto pidan'), ('nose depende cuanto pidan'),
        ('no sé depende cuánto pidan'), ('no se depende cuanto pidan'), ('español'), ('espanol'), ('inglés'), ('ingles'),
        ('itin'), ('excelente señorita'), ('licencia y social'), ('licencia y tax id'), ('licencia y taxid'),
        ('pero madame fotos'), ('madame fotos'), ('estoy entre ambos'), ('estoy entre los dos'),
        ('estoy entre las dos'), ('between both'), ('between the two'),
        ('Samantha ede Easterns Motors'), ('Samantha de Easterns Motors')
      ) AS seed(display_value)
      ON CONFLICT (channel, normalized_value) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS invalid_real_names_channel_idx');
    await queryRunner.query('DROP TABLE IF EXISTS invalid_real_names');
  }
}
