import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  RecordExpenseCommand,
  ReviewExpenseCommand,
  CreateExpenseCategoryCommand,
  SetExpenseThresholdCommand,
  ExpenseView,
  ExpenseReport,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { emitNotification } from './notification';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import type { RequestMeta } from './admin-auth';

interface OutletRow {
  organization_id: string;
  franchise_id: string | null;
  timezone: string;
  status: string;
}

async function loadOutlet(client: PoolClient, outletId: string): Promise<OutletRow> {
  const { rows } = await client.query<OutletRow>(
    `select organization_id, franchise_id, timezone, status from billing.outlets where id = $1`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0];
}

async function highValueThreshold(
  client: PoolClient,
  outletId: string,
  orgId: string,
): Promise<number> {
  const override = await client.query<{ high_value_threshold: string | null }>(
    `select high_value_threshold from billing.outlet_expense_settings where outlet_id = $1`,
    [outletId],
  );
  if (override.rows[0]?.high_value_threshold != null) {
    return Number(override.rows[0].high_value_threshold);
  }
  const def = await client.query<{ default_high_value_threshold: string }>(
    `select default_high_value_threshold from billing.expense_config where organization_id = $1`,
    [orgId],
  );
  return Number(def.rows[0]?.default_high_value_threshold ?? '5000');
}

/** A Store Employee records an outlet expense instantly - it is immutable
 *  and affects reports and the Cash session immediately, staying
 *  "highlighted" (unreviewed) until owner review
 *  (`docs/architecture/outlet-expenses.md`). */
export async function recordExpense(
  pool: Pool,
  actor: ActorContext,
  cmd: RecordExpenseCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'billing.expense.record', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: cmd.outletId,
  });
  const employeeId = actor.kind === 'operator' ? actor.employeeId : undefined;
  const result = await withActorContext(pool, contextForActor(actor), async (client) => {
    const existing = await client.query<{ id: string }>(
      `select id from billing.outlet_expenses where outlet_id = $1 and idempotency_key = $2`,
      [cmd.outletId, cmd.idempotencyKey],
    );
    if (existing.rows[0]) return { id: existing.rows[0].id, isNew: false, threshold: 0 };

    const outlet = await loadOutlet(client, cmd.outletId);
    if (outlet.status !== 'active') {
      throw new IdentityError('outlet_not_active', 'Outlet is not active');
    }
    const businessDate = businessDateString(new Date(), outlet.timezone);

    // A drawer-paid expense links to the currently open cash session so it
    // reduces expected closing Cash. Any other source never touches the drawer.
    let cashSessionId: string | null = null;
    if (cmd.paymentSource === 'shared_cash_drawer') {
      const cash = await client.query<{ id: string }>(
        `select id from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
        [cmd.outletId],
      );
      if (!cash.rows[0]) {
        throw new IdentityError('conflict', 'No open cash session to pay this from', {
          details: { code: 'cash_session_required' },
        });
      }
      cashSessionId = cash.rows[0].id;
    }

    const id = randomUUID();
    await client.query(
      `insert into billing.outlet_expenses
         (id, organization_id, franchise_id, outlet_id, category_id, category_name, amount,
          payment_source, reason, receipt_url, recorded_by_employee_id, recorded_by_account_id,
          business_date, cash_session_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        outlet.organization_id,
        outlet.franchise_id,
        cmd.outletId,
        cmd.categoryId ?? null,
        cmd.categoryName,
        cmd.amount,
        cmd.paymentSource,
        cmd.reason,
        cmd.receiptUrl ?? null,
        employeeId ?? null,
        employeeId ? null : (actor.accountId ?? null),
        businessDate,
        cashSessionId,
        cmd.idempotencyKey,
      ],
    );
    await recordAudit(client, {
      action: 'expense.recorded',
      result: 'success',
      actorAccountId: actor.accountId,
      actorEmployeeId: employeeId,
      organizationId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { expenseId: id, amount: cmd.amount, paymentSource: cmd.paymentSource },
    });
    const threshold = await highValueThreshold(client, cmd.outletId, outlet.organization_id);
    return {
      id,
      isNew: true,
      threshold,
      orgId: outlet.organization_id,
      franchiseId: outlet.franchise_id,
    };
  });

  if (result.isNew) {
    const high = Number(cmd.amount) >= result.threshold;
    await emitNotification(pool, {
      organizationId: actor.scope.organizationId,
      ...('franchiseId' in result && result.franchiseId ? { franchiseId: result.franchiseId } : {}),
      outletId: cmd.outletId,
      recipientRole: 'franchise_owner',
      category: 'expenses',
      severity: high ? 'warning' : 'info',
      title: high
        ? `High-value expense: ₹${cmd.amount} (${cmd.categoryName})`
        : `Expense pending review: ₹${cmd.amount} (${cmd.categoryName})`,
      body: cmd.reason,
      entityType: 'outlet_expense',
      entityId: result.id,
      dedupKey: `expense:${result.id}`,
    });
  }
  return { id: result.id };
}

/** Owner review: approve (clears the highlight) or reverse (a linked
 *  correction - "An owner who rejects an incorrect record creates a
 *  reversal/correction instead of deleting it"). */
export async function reviewExpense(
  pool: Pool,
  actor: ActorContext,
  expenseId: string,
  cmd: ReviewExpenseCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    // Auth-check off a plain read (accountant/etc. can see it via the read
    // policy) before the FOR UPDATE lock, which is gated by the narrower
    // write policy and would otherwise silently hide the row.
    const seen = await client.query<{
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string;
    }>(
      `select organization_id, franchise_id, outlet_id from billing.outlet_expenses where id = $1`,
      [expenseId],
    );
    if (!seen.rows[0]) throw new IdentityError('not_found', 'Expense not found');
    ensureAllowed(actor, 'billing.expense.oversee', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId: seen.rows[0].outlet_id,
    });
    const exp = await client.query<{
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string;
      reversed_at: Date | null;
    }>(
      `select organization_id, franchise_id, outlet_id, reversed_at
         from billing.outlet_expenses where id = $1 for update`,
      [expenseId],
    );
    if (!exp.rows[0]) throw new IdentityError('not_found', 'Expense not found');
    if (exp.rows[0].reversed_at) {
      throw new IdentityError('conflict', 'This expense is already reversed');
    }

    if (cmd.action === 'approve') {
      await client.query(
        `update billing.outlet_expenses
            set reviewed_at = now(), reviewed_by_account_id = $2 where id = $1`,
        [expenseId, actor.accountId ?? null],
      );
    } else {
      if (!cmd.reason) {
        throw new IdentityError('validation', 'A reversal needs a reason');
      }
      await client.query(
        `update billing.outlet_expenses
            set reversed_at = now(), reversed_by_account_id = $2, reversal_reason = $3,
                reviewed_at = coalesce(reviewed_at, now()),
                reviewed_by_account_id = coalesce(reviewed_by_account_id, $2)
          where id = $1`,
        [expenseId, actor.accountId ?? null, cmd.reason],
      );
    }
    await recordAudit(client, {
      action: cmd.action === 'reverse' ? 'expense.reversed' : 'expense.reviewed',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: exp.rows[0].organization_id,
      franchiseId: exp.rows[0].franchise_id,
      outletId: exp.rows[0].outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { expenseId, action: cmd.action, ...(cmd.reason ? { reason: cmd.reason } : {}) },
    });
    return exp.rows[0];
  }).then(async (row) => {
    if (cmd.action === 'reverse') {
      await emitNotification(pool, {
        organizationId: row.organization_id,
        ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
        outletId: row.outlet_id,
        recipientRole: 'franchise_owner',
        category: 'expenses',
        severity: 'info',
        title: 'An expense was reversed',
        ...(cmd.reason ? { body: cmd.reason } : {}),
        entityType: 'outlet_expense',
        entityId: expenseId,
        dedupKey: `expense-reversed:${expenseId}`,
      });
    }
  });
}

export async function createExpenseCategory(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateExpenseCategoryCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'billing.expense.config', { organizationId: actor.scope.organizationId });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const id = randomUUID();
    await client.query(
      `insert into billing.expense_categories (id, organization_id, brand_id, name, created_by)
       values ($1,$2,$3,$4,$5)`,
      [id, actor.scope.organizationId, cmd.brandId ?? null, cmd.name, actor.accountId ?? null],
    );
    await recordAudit(client, {
      action: 'expense.category_created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { categoryId: id, name: cmd.name },
    });
    return { id };
  });
}

export async function setExpenseThreshold(
  pool: Pool,
  actor: ActorContext,
  cmd: SetExpenseThresholdCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    if (cmd.outletId) {
      // A Franchise Owner may set a stricter per-outlet override.
      ensureAllowed(actor, 'billing.expense.oversee', {
        organizationId: actor.scope.organizationId,
        ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
        outletId: cmd.outletId,
      });
      await client.query(
        `insert into billing.outlet_expense_settings (outlet_id, high_value_threshold, updated_by)
         values ($1,$2,$3)
         on conflict (outlet_id) do update set high_value_threshold = excluded.high_value_threshold,
           updated_by = excluded.updated_by`,
        [cmd.outletId, cmd.threshold, actor.accountId ?? null],
      );
    } else {
      ensureAllowed(actor, 'billing.expense.config', {
        organizationId: actor.scope.organizationId,
      });
      await client.query(
        `insert into billing.expense_config (organization_id, default_high_value_threshold, updated_by)
         values ($1,$2,$3)
         on conflict (organization_id) do update set
           default_high_value_threshold = excluded.default_high_value_threshold,
           updated_by = excluded.updated_by`,
        [actor.scope.organizationId, cmd.threshold, actor.accountId ?? null],
      );
    }
    await recordAudit(client, {
      action: 'expense.threshold_set',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(cmd.outletId ? { outletId: cmd.outletId } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { threshold: cmd.threshold, scope: cmd.outletId ? 'outlet' : 'org' },
    });
  });
}

export async function listExpenses(
  pool: Pool,
  actor: ActorContext,
  opts: { outletId: string; businessDate?: string; unreviewedOnly?: boolean },
): Promise<ExpenseView[]> {
  ensureAllowed(actor, 'billing.expense.read', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: opts.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await loadOutlet(client, opts.outletId);
    const threshold = await highValueThreshold(client, opts.outletId, outlet.organization_id);
    const params: unknown[] = [opts.outletId];
    let where = `e.outlet_id = $1`;
    if (opts.businessDate) {
      params.push(opts.businessDate);
      where += ` and e.business_date = $${String(params.length)}`;
    }
    if (opts.unreviewedOnly) where += ` and e.reviewed_at is null and e.reversed_at is null`;
    const { rows } = await client.query<{
      id: string;
      outlet_id: string;
      category_name: string;
      amount: string;
      payment_source: ExpenseView['paymentSource'];
      reason: string;
      receipt_url: string | null;
      recorded_by_name: string | null;
      business_date: string;
      reviewed_at: Date | null;
      reversed_at: Date | null;
      reversal_reason: string | null;
      created_at: Date;
    }>(
      `select e.id, e.outlet_id, e.category_name, e.amount, e.payment_source, e.reason,
              e.receipt_url, coalesce(se.full_name, ap.display_name) as recorded_by_name,
              e.business_date::text as business_date, e.reviewed_at, e.reversed_at,
              e.reversal_reason, e.created_at
         from billing.outlet_expenses e
         left join identity.store_employees se on se.id = e.recorded_by_employee_id
         left join identity.account_profiles ap on ap.id = e.recorded_by_account_id
        where ${where}
        order by e.created_at desc`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      outletId: r.outlet_id,
      categoryName: r.category_name,
      amount: r.amount,
      paymentSource: r.payment_source,
      reason: r.reason,
      receiptUrl: r.receipt_url,
      recordedByName: r.recorded_by_name,
      businessDate: r.business_date,
      affectsDrawer: r.payment_source === 'shared_cash_drawer' && !r.reversed_at,
      isHighValue: Number(r.amount) >= threshold,
      reviewedAt: r.reviewed_at?.toISOString() ?? null,
      reversedAt: r.reversed_at?.toISOString() ?? null,
      reversalReason: r.reversal_reason,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export async function getExpenseReport(
  pool: Pool,
  actor: ActorContext,
  opts: { outletId: string; from: string; to: string },
): Promise<ExpenseReport> {
  ensureAllowed(actor, 'billing.expense.read', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: opts.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const base = `from billing.outlet_expenses
       where outlet_id = $1 and business_date between $2 and $3 and reversed_at is null`;
    const p = [opts.outletId, opts.from, opts.to];
    const totals = await client.query<{ total: string; drawer_total: string; unreviewed: string }>(
      `select coalesce(sum(amount),0)::numeric(12,2) as total,
              coalesce(sum(amount) filter (where payment_source = 'shared_cash_drawer'),0)::numeric(12,2) as drawer_total,
              count(*) filter (where reviewed_at is null) as unreviewed
       ${base}`,
      p,
    );
    const byCat = await client.query<{ category_name: string; total: string }>(
      `select category_name, sum(amount)::numeric(12,2) as total ${base}
        group by category_name order by total desc`,
      p,
    );
    const bySrc = await client.query<{
      payment_source: ExpenseView['paymentSource'];
      total: string;
    }>(
      `select payment_source, sum(amount)::numeric(12,2) as total ${base}
        group by payment_source`,
      p,
    );
    return {
      from: opts.from,
      to: opts.to,
      total: totals.rows[0]?.total ?? '0.00',
      drawerTotal: totals.rows[0]?.drawer_total ?? '0.00',
      byCategory: byCat.rows.map((r) => ({ categoryName: r.category_name, total: r.total })),
      byPaymentSource: bySrc.rows.map((r) => ({ paymentSource: r.payment_source, total: r.total })),
      unreviewedCount: Number(totals.rows[0]?.unreviewed ?? 0),
    };
  });
}
