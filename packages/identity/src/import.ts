import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  PreviewImportCommand,
  ConfirmImportCommand,
  ImportPreview,
  ImportRowResult,
  ImportJob,
  MenuItemImportRow,
  ExpenseCategoryImportRow,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

interface Classified {
  businessKey: string;
  action: ImportRowResult['action'];
  error: string | null;
}

async function classifyMenuItemRows(
  client: PoolClient,
  brandId: string,
  orgId: string,
  rows: MenuItemImportRow[],
): Promise<{ classes: Classified[]; existing: Map<string, string> }> {
  const brand = await client.query<{ organization_id: string }>(
    `select organization_id from billing.brands where id = $1`,
    [brandId],
  );
  const brandOk = brand.rows[0]?.organization_id === orgId;
  const names = rows.map((r) => r.name.trim());
  const cur = await client.query<{ id: string; name: string }>(
    `select id, name from billing.catalog_items
      where brand_id = $1 and owner_scope = 'master' and name = any($2::text[])`,
    [brandId, names],
  );
  const existing = new Map(cur.rows.map((r) => [r.name, r.id]));
  const seen = new Set<string>();
  const classes = rows.map((r): Classified => {
    const key = r.name.trim();
    if (!brandOk)
      return { businessKey: key, action: 'error', error: 'brand is outside your organization' };
    if (seen.has(key)) return { businessKey: key, action: 'error', error: 'duplicate row in file' };
    seen.add(key);
    if (Number(r.price) < 0)
      return { businessKey: key, action: 'error', error: 'price must be >= 0' };
    return { businessKey: key, action: existing.has(key) ? 'update' : 'create', error: null };
  });
  return { classes, existing };
}

async function classifyExpenseCategoryRows(
  client: PoolClient,
  brandId: string | undefined,
  orgId: string,
  rows: ExpenseCategoryImportRow[],
): Promise<{ classes: Classified[]; existing: Set<string> }> {
  const names = rows.map((r) => r.name.trim());
  const cur = await client.query<{ name: string }>(
    `select name from billing.expense_categories
      where organization_id = $1
        and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        and name = any($3::text[])`,
    [orgId, brandId ?? null, names],
  );
  const existing = new Set(cur.rows.map((r) => r.name));
  const seen = new Set<string>();
  const classes = rows.map((r): Classified => {
    const key = r.name.trim();
    if (seen.has(key)) return { businessKey: key, action: 'error', error: 'duplicate row in file' };
    seen.add(key);
    return { businessKey: key, action: existing.has(key) ? 'skip' : 'create', error: null };
  });
  return { classes, existing };
}

function tally(rows: ImportRowResult[]): Omit<ImportPreview, 'kind' | 'rows'> {
  return {
    rowCount: rows.length,
    createCount: rows.filter((r) => r.action === 'create').length,
    updateCount: rows.filter((r) => r.action === 'update').length,
    skipCount: rows.filter((r) => r.action === 'skip').length,
    errorCount: rows.filter((r) => r.action === 'error').length,
  };
}

/** Preview never writes (`bulk-import-and-data-quality.md` "Uploading never
 *  changes live data"). */
export async function previewImport(
  pool: Pool,
  actor: ActorContext,
  cmd: PreviewImportCommand,
): Promise<ImportPreview> {
  ensureAllowed(actor, 'billing.bulk_import', { organizationId: actor.scope.organizationId });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const classes =
      cmd.kind === 'menu_item'
        ? (await classifyMenuItemRows(client, cmd.brandId, actor.scope.organizationId, cmd.rows))
            .classes
        : (
            await classifyExpenseCategoryRows(
              client,
              cmd.brandId,
              actor.scope.organizationId,
              cmd.rows,
            )
          ).classes;
    const rows: ImportRowResult[] = classes.map((c, i) => ({
      rowNumber: i + 1,
      businessKey: c.businessKey,
      action: c.action,
      error: c.error,
      createdEntityId: null,
    }));
    return { kind: cmd.kind, ...tally(rows), rows };
  });
}

/** Confirmation creates the immutable job and processes rows synchronously
 *  in one bounded batch. Menu-item creations are draft authoring rows that
 *  still need a separate publish - they never touch a live menu. Retrying a
 *  row that already succeeded is a no-op via the (job, row_number) unique
 *  key plus the existing-record check. */
export async function confirmImport(
  pool: Pool,
  actor: ActorContext,
  cmd: ConfirmImportCommand,
  meta: RequestMeta = {},
): Promise<ImportJob> {
  ensureAllowed(actor, 'billing.bulk_import', { organizationId: actor.scope.organizationId });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const jobId = randomUUID();
    await client.query(
      `insert into billing.import_jobs
         (id, organization_id, kind, template_version, file_checksum, row_count, status,
          actor_account_id)
       values ($1,$2,$3,$4,$5,$6,'processing',$7)`,
      [
        jobId,
        actor.scope.organizationId,
        cmd.kind,
        cmd.templateVersion,
        cmd.fileChecksum ?? null,
        cmd.rows.length,
        actor.accountId ?? null,
      ],
    );

    const results: ImportRowResult[] = [];
    if (cmd.kind === 'menu_item') {
      const { classes, existing } = await classifyMenuItemRows(
        client,
        cmd.brandId,
        actor.scope.organizationId,
        cmd.rows,
      );
      for (let i = 0; i < cmd.rows.length; i += 1) {
        const row = cmd.rows[i];
        const c = classes[i];
        if (!row || !c) continue;
        const res: ImportRowResult = {
          rowNumber: i + 1,
          businessKey: c.businessKey,
          action: c.action,
          error: c.error,
          createdEntityId: null,
        };
        // A savepoint per row: one failing row is rolled back to here and
        // recorded as an error, without poisoning the whole job transaction.
        await client.query('savepoint import_row');
        try {
          if (c.action === 'create') {
            const id = randomUUID();
            await client.query(
              `insert into billing.catalog_items
                 (id, organization_id, brand_id, owner_scope, name, hsn_code, gst_rate, price,
                  is_available, created_by)
               values ($1,$2,$3,'master',$4,$5,$6,$7,$8,$9)`,
              [
                id,
                actor.scope.organizationId,
                cmd.brandId,
                row.name.trim(),
                row.hsnCode ?? null,
                row.gstRate,
                row.price,
                row.isAvailable ?? true,
                actor.accountId ?? null,
              ],
            );
            res.createdEntityId = id;
          } else if (c.action === 'update') {
            const id = existing.get(c.businessKey);
            if (id) {
              await client.query(
                `update billing.catalog_items
                    set price = $2, gst_rate = $3, hsn_code = $4, is_available = $5
                  where id = $1`,
                [id, row.price, row.gstRate, row.hsnCode ?? null, row.isAvailable ?? true],
              );
              res.createdEntityId = id;
            }
          }
          await client.query('release savepoint import_row');
        } catch (err) {
          await client.query('rollback to savepoint import_row');
          res.action = 'error';
          res.error = err instanceof Error ? err.message : String(err);
          res.createdEntityId = null;
        }
        await client.query(
          `insert into billing.import_job_rows
             (import_job_id, row_number, business_key, action, error, created_entity_id, processed_at)
           values ($1,$2,$3,$4,$5,$6, now())`,
          [jobId, res.rowNumber, res.businessKey, res.action, res.error, res.createdEntityId],
        );
        results.push(res);
      }
    } else {
      const { classes } = await classifyExpenseCategoryRows(
        client,
        cmd.brandId,
        actor.scope.organizationId,
        cmd.rows,
      );
      for (let i = 0; i < cmd.rows.length; i += 1) {
        const row = cmd.rows[i];
        const c = classes[i];
        if (!row || !c) continue;
        const res: ImportRowResult = {
          rowNumber: i + 1,
          businessKey: c.businessKey,
          action: c.action,
          error: c.error,
          createdEntityId: null,
        };
        await client.query('savepoint import_row');
        try {
          if (c.action === 'create') {
            const id = randomUUID();
            await client.query(
              `insert into billing.expense_categories (id, organization_id, brand_id, name, created_by)
               values ($1,$2,$3,$4,$5)`,
              [
                id,
                actor.scope.organizationId,
                cmd.brandId ?? null,
                row.name.trim(),
                actor.accountId ?? null,
              ],
            );
            res.createdEntityId = id;
          }
          await client.query('release savepoint import_row');
        } catch (err) {
          await client.query('rollback to savepoint import_row');
          res.action = 'error';
          res.error = err instanceof Error ? err.message : String(err);
          res.createdEntityId = null;
        }
        await client.query(
          `insert into billing.import_job_rows
             (import_job_id, row_number, business_key, action, error, created_entity_id, processed_at)
           values ($1,$2,$3,$4,$5,$6, now())`,
          [jobId, res.rowNumber, res.businessKey, res.action, res.error, res.createdEntityId],
        );
        results.push(res);
      }
    }

    const t = tally(results);
    const status =
      t.errorCount === 0 ? 'completed' : t.errorCount === results.length ? 'failed' : 'partial';
    await client.query(
      `update billing.import_jobs
          set status = $2, created_count = $3, updated_count = $4, skipped_count = $5,
              error_count = $6, completed_at = now()
        where id = $1`,
      [jobId, status, t.createCount, t.updateCount, t.skipCount, t.errorCount],
    );
    await recordAudit(client, {
      action: 'import.processed',
      result: t.errorCount === 0 ? 'success' : 'failure',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { jobId, kind: cmd.kind, ...t, status },
    });

    return {
      id: jobId,
      kind: cmd.kind,
      status,
      templateVersion: cmd.templateVersion,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...t,
      rows: results,
    };
  });
}

export async function getImportJob(
  pool: Pool,
  actor: ActorContext,
  jobId: string,
): Promise<ImportJob> {
  ensureAllowed(actor, 'billing.bulk_import', { organizationId: actor.scope.organizationId });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const j = await client.query<{
      id: string;
      kind: ImportJob['kind'];
      status: ImportJob['status'];
      template_version: string;
      row_count: number;
      created_count: number;
      updated_count: number;
      skipped_count: number;
      error_count: number;
      created_at: Date;
      completed_at: Date | null;
    }>(`select * from billing.import_jobs where id = $1`, [jobId]);
    const job = j.rows[0];
    if (!job) throw new IdentityError('not_found', 'Import job not found');
    const rows = await client.query<{
      row_number: number;
      business_key: string;
      action: ImportRowResult['action'];
      error: string | null;
      created_entity_id: string | null;
    }>(
      `select row_number, business_key, action, error, created_entity_id
         from billing.import_job_rows where import_job_id = $1 order by row_number`,
      [jobId],
    );
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      templateVersion: job.template_version,
      rowCount: job.row_count,
      createCount: job.created_count,
      updateCount: job.updated_count,
      skipCount: job.skipped_count,
      errorCount: job.error_count,
      createdAt: job.created_at.toISOString(),
      completedAt: job.completed_at?.toISOString() ?? null,
      rows: rows.rows.map((r) => ({
        rowNumber: r.row_number,
        businessKey: r.business_key,
        action: r.action,
        error: r.error,
        createdEntityId: r.created_entity_id,
      })),
    };
  });
}
