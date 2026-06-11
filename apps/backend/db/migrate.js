// ============================================================================
//  Runner de migrações — aplica os .sql canônicos (pasta database/) em ordem.
//  Conecta como ADMIN (owner) -> pode criar schema/roles e bypassa RLS.
//  Idempotente: os scripts usam IF NOT EXISTS / DROP ... IF EXISTS.
//  Também garante que o role barber_app tenha LOGIN + senha (para o app).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pasta dos .sql: env MIGRATIONS_DIR ou ../../database relativo ao backend.
const MIG_DIR = env.migrationsDir || path.resolve(__dirname, '../../../database');

// Ordem de aplicação (estrutura + views). Seed (04) só se SEED=true.
const ORDER = [
  '01_schema.sql',
  '02_triggers.sql',
  '05_improvements.sql',
  '06_extensions.sql',
  '07_whatsapp_crm.sql',
  '08_relational_hardening.sql',
  '09_product_media.sql',
  '10_indexes.sql',
  '11_remuneration.sql',
  '03_views.sql',
];
if (process.env.SEED === 'true') ORDER.push('04_seed.sql');

async function main() {
  const client = new pg.Client({ connectionString: env.db.adminUrl });
  await client.connect();
  console.log(`[migrate] usando ${MIG_DIR}`);
  try {
    for (const file of ORDER) {
      const full = path.join(MIG_DIR, file);
      if (!fs.existsSync(full)) throw new Error(`migração ausente: ${full}`);
      const sql = fs.readFileSync(full, 'utf8');
      process.stdout.write(`[migrate] aplicando ${file} ... `);
      await client.query(sql);
      console.log('ok');
    }

    // Seed mínimo de PLANOS (necessário para register-shop). Idempotente.
    await client.query(
      `INSERT INTO plans (code, name, max_barbers, max_units, monthly_price, features) VALUES
         ('basic','Básico',1,1,49.90,'{"reports":"basic","loyalty":false}'),
         ('pro','Profissional',5,1,99.90,'{"reports":"advanced","loyalty":true}'),
         ('premium','Premium',NULL,99,199.90,'{"reports":"advanced","loyalty":true,"multi_unit":true}')
       ON CONFLICT (code) DO NOTHING`,
    );
    console.log('[migrate] planos garantidos');

    // Garante que o role da aplicação loga (em Docker o initdb já faz isso;
    // aqui reforçamos para ambientes nativos/CI).
    const appUser = env.db.appUser;
    const appPass = env.db.appPassword;
    if (appUser && appPass) {
      await client.query(
        `DO $$
         BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
             EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${appUser}', '${appPass}');
           END IF;
         END $$;`,
      );
      console.log(`[migrate] role ${appUser} com LOGIN garantido`);
    }
    console.log('[migrate] CONCLUÍDO');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[migrate] FALHOU:', e.message);
  process.exit(1);
});
