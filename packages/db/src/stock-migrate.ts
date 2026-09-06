import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/** Forward-only Stock migration list, separate from Billing's. */
const STOCK_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../database/stock-migrations', import.meta.url),
);

export interface StockMigrationFile {
  name: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

export interface StockMigrationRecord {
  id: string;
  checksum: string;
  applied_at: string;
}

export async function loadStockMigrationFiles(
  dir = STOCK_MIGRATIONS_DIR,
): Promise<StockMigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const sqlFiles = entries
    .filter((entry) => entry.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const files: StockMigrationFile[] = [];
  for (const entry of sqlFiles) {
    const fullPath = path.join(dir, entry);
    const sql = await readFile(fullPath, 'utf8');
    files.push({
      name: entry,
      fullPath,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return files;
}

async function ensureStockMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    create schema if not exists stock;
    create table if not exists stock.schema_migrations (
      id          text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);
}

export async function stockMigrationStatus(pool: Pool): Promise<{
  applied: StockMigrationRecord[];
  pending: StockMigrationFile[];
  drift: { id: string; recorded: string; current: string }[];
}> {
  await ensureStockMigrationsTable(pool);
  const files = await loadStockMigrationFiles();
  const { rows } = await pool.query<StockMigrationRecord>(
    'select id, checksum, applied_at from stock.schema_migrations order by id',
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const pending = files.filter((file) => !byId.has(file.name));
  const drift = files
    .map((file) => ({ file, recorded: byId.get(file.name) }))
    .filter((entry) => entry.recorded && entry.recorded.checksum !== entry.file.checksum)
    .map((entry) => ({
      id: entry.file.name,
      recorded: entry.recorded?.checksum ?? '',
      current: entry.file.checksum,
    }));

  return { applied: rows, pending, drift };
}

export interface StockMigrateResult {
  applied: string[];
  alreadyCurrent: boolean;
}

/** Apply every pending Stock migration, each in its own transaction. */
export async function stockMigrate(pool: Pool): Promise<StockMigrateResult> {
  const status = await stockMigrationStatus(pool);

  if (status.drift.length > 0) {
    throw new Error(
      `Stock migration drift detected (edited after apply): ${status.drift
        .map((entry) => entry.id)
        .join(', ')}. Migrations are forward-only; add a new file instead.`,
    );
  }

  const applied: string[] = [];
  for (const file of status.pending) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(file.sql);
      await client.query('insert into stock.schema_migrations (id, checksum) values ($1, $2)', [
        file.name,
        file.checksum,
      ]);
      await client.query('commit');
      applied.push(file.name);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Stock migration ${file.name} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }

  return { applied, alreadyCurrent: applied.length === 0 };
}
