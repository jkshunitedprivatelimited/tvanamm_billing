/**
 * Migration / seed CLI.
 *   tsx packages/db/src/cli.ts migrate
 *   tsx packages/db/src/cli.ts status
 *   tsx packages/db/src/cli.ts seed
 *
 * Reads DATABASE_URL from the environment. Loads .env if present.
 */
import { createPool } from './pg.js';
import { migrate, migrationStatus } from './migrate.js';
import { seedDevData } from './seed.js';

async function loadDotEnv(): Promise<void> {
  try {
    const { config } = await import('dotenv');
    config();
  } catch {
    // dotenv is optional; env may already be populated by the shell / CI.
  }
}

async function main(): Promise<void> {
  await loadDotEnv();
  const command = process.argv[2] ?? 'status';
  // Migrations run over the session-mode / direct connection, never pgbouncer.
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  const pool = createPool(connectionString);

  try {
    if (command === 'migrate') {
      const result = await migrate(pool);
      if (result.alreadyCurrent) {
        console.log('Database is up to date. No migrations applied.');
      } else {
        console.log(`Applied ${String(result.applied.length)} migration(s):`);
        for (const id of result.applied) console.log(`  + ${id}`);
      }
    } else if (command === 'status') {
      const status = await migrationStatus(pool);
      console.log(`Applied: ${String(status.applied.length)}`);
      for (const row of status.applied) console.log(`  = ${row.id}`);
      console.log(`Pending: ${String(status.pending.length)}`);
      for (const file of status.pending) console.log(`  + ${file.name}`);
      if (status.drift.length > 0) {
        console.error(`Drift: ${String(status.drift.length)}`);
        for (const entry of status.drift) console.error(`  ! ${entry.id}`);
        process.exitCode = 1;
      }
    } else if (command === 'seed') {
      await migrate(pool);
      await seedDevData(pool);
      console.log('Seed complete.');
    } else {
      console.error(`Unknown command: ${command}`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
