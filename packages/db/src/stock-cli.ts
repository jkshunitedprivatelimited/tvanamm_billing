/**
 * Stock migration CLI (separate database from Billing).
 *   tsx packages/db/src/stock-cli.ts migrate
 *   tsx packages/db/src/stock-cli.ts status
 *
 * Reads STOCK_DIRECT_URL / STOCK_DATABASE_URL from the environment. Loads .env
 * if present.
 */
import { createStockPool } from './stock-pg';
import { stockMigrate, stockMigrationStatus } from './stock-migrate';

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
  const connectionString = process.env.STOCK_DIRECT_URL ?? process.env.STOCK_DATABASE_URL;
  const pool = createStockPool(connectionString);

  try {
    if (command === 'migrate') {
      const result = await stockMigrate(pool);
      if (result.alreadyCurrent) {
        console.log('Stock database is up to date. No migrations applied.');
      } else {
        console.log(`Applied ${String(result.applied.length)} Stock migration(s):`);
        for (const id of result.applied) console.log(`  + ${id}`);
      }
    } else if (command === 'status') {
      const status = await stockMigrationStatus(pool);
      console.log(`Applied: ${String(status.applied.length)}`);
      for (const row of status.applied) console.log(`  = ${row.id}`);
      console.log(`Pending: ${String(status.pending.length)}`);
      for (const file of status.pending) console.log(`  + ${file.name}`);
      if (status.drift.length > 0) {
        console.error(`Drift: ${String(status.drift.length)}`);
        for (const entry of status.drift) console.error(`  ! ${entry.id}`);
        process.exitCode = 1;
      }
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
