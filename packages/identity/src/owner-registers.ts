import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, OwnerCloseRegisterCommand } from '@jksh/contracts';
import { ownerCloseRegisterCommandSchema } from '@jksh/contracts';
import { ensureAllowed } from './authz';
import { contextForActor } from './db-context';
import { IdentityError } from './errors';
import { expectedCashFor } from './shifts';
import { lockOutletWork } from './work-lock';
import { recordAudit } from './audit';
import { notifyCashDifference } from './cash-notifications';
import type { RequestMeta } from './admin-auth';

export interface OwnerRegisterReview {
  id: string;
  outletId: string;
  outletName: string;
  businessDate: string;
  openedBy: string;
  openingCash: string;
  cashSales: string;
  cashRefunds: string;
  drawerExpenses: string;
  expectedCash: string;
  overdue: boolean;
  shifts: { id: string; name: string; businessDate: string }[];
}

function requireOwner(actor: ActorContext): void {
  if (actor.kind !== 'admin' || actor.role !== 'franchise_owner' || !actor.accountId) {
    throw new IdentityError('forbidden', 'Only a franchise owner can manage registers here');
  }
}

async function review(
  client: PoolClient,
  actor: ActorContext,
  id: string,
): Promise<OwnerRegisterReview> {
  const { rows } = await client.query<{
    id: string;
    outlet_id: string;
    organization_id: string;
    franchise_id: string;
    outlet_name: string;
    business_date: string;
    opened_by_name: string;
    opening_cash: string;
    cash_sales: string;
    cash_refunds: string;
    drawer_expenses: string;
    overdue: boolean;
  }>(
    `select cs.id, cs.outlet_id, cs.organization_id, cs.franchise_id, o.display_name as outlet_name,
      cs.business_date::text, cs.opened_by_name, cs.opening_cash,
      cs.business_date < (now() at time zone o.timezone)::date as overdue,
      coalesce((select sum(p.amount) from billing.payments p join billing.bills b on b.id = p.bill_id
        where b.cash_session_id = cs.id and p.method = 'cash'), 0)::text as cash_sales,
      coalesce((select sum(r.amount) from billing.refunds r
        where r.cash_session_id = cs.id and r.payout_method = 'cash'), 0)::text as cash_refunds,
      coalesce((select sum(e.amount) from billing.outlet_expenses e
        where e.cash_session_id = cs.id and e.payment_source = 'shared_cash_drawer'
          and e.reversed_at is null), 0)::text as drawer_expenses
     from billing.cash_sessions cs join billing.outlets o on o.id = cs.outlet_id
     where cs.id = $1 and cs.status = 'open'`,
    [id],
  );
  const r = rows[0];
  if (!r)
    throw new IdentityError('not_found', 'Open register not found. It may already be closed.');
  ensureAllowed(actor, 'billing.cash_session.close', {
    organizationId: r.organization_id,
    franchiseId: r.franchise_id,
    outletId: r.outlet_id,
  });
  const shifts = await client.query<{ id: string; name: string; businessDate: string }>(
    `select id, employee_name as name, business_date::text as "businessDate"
     from billing.employee_shifts where outlet_id = $1 and status = 'open'
       and business_date <= $2 order by started_at`,
    [r.outlet_id, r.business_date],
  );
  return {
    id: r.id,
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    businessDate: r.business_date,
    openedBy: r.opened_by_name,
    openingCash: r.opening_cash,
    cashSales: r.cash_sales,
    cashRefunds: r.cash_refunds,
    drawerExpenses: r.drawer_expenses,
    expectedCash: (
      Number(r.opening_cash) +
      Number(r.cash_sales) -
      Number(r.cash_refunds) -
      Number(r.drawer_expenses)
    ).toFixed(2),
    overdue: r.overdue,
    shifts: shifts.rows,
  };
}

export async function listOwnerRegisters(
  pool: Pool,
  actor: ActorContext,
): Promise<OwnerRegisterReview[]> {
  requireOwner(actor);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id from billing.cash_sessions where status = 'open' order by business_date, opened_at",
    );
    return Promise.all(rows.map((r) => review(client, actor, r.id)));
  });
}

export async function getOwnerRegisterReview(
  pool: Pool,
  actor: ActorContext,
  id: string,
): Promise<OwnerRegisterReview> {
  requireOwner(actor);
  return withActorContext(pool, contextForActor(actor), (client) => review(client, actor, id));
}

export async function closeOwnerRegister(
  pool: Pool,
  actor: ActorContext,
  id: string,
  input: OwnerCloseRegisterCommand,
  meta: RequestMeta = {},
): Promise<{
  id: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  closedShifts: number;
}> {
  requireOwner(actor);
  const cmd = ownerCloseRegisterCommandSchema.parse(input);
  const result = await withActorContext(pool, contextForActor(actor), async (client) => {
    const initial = await review(client, actor, id);
    await lockOutletWork(client, initial.outletId);
    const locked = await client.query<{ status: string }>(
      'select status from billing.cash_sessions where id = $1 for update',
      [id],
    );
    if (locked.rows[0]?.status !== 'open')
      throw new IdentityError(
        'conflict',
        'Register is already closed. Refresh to see its closing report.',
      );
    const expected = await expectedCashFor(client, id);
    if (Number(expected) !== Number(cmd.expectedCash)) {
      throw new IdentityError(
        'conflict',
        'Cash activity changed during review. Refresh the register summary before closing.',
      );
    }
    const account = await client.query<{ display_name: string }>(
      'select display_name from identity.account_profiles where id = $1',
      [actor.accountId],
    );
    const variance = (Number(cmd.countedCash) - Number(expected)).toFixed(2);
    await client.query(
      `update billing.cash_sessions set status = 'closed', closed_at = now(),
        closed_by_account_id = $2, closed_by_name = $3, counted_cash = $4,
        expected_cash = $5, variance = $6, variance_reason = $7 where id = $1`,
      [
        id,
        actor.accountId,
        account.rows[0]?.display_name ?? 'Franchise owner',
        cmd.countedCash,
        expected,
        variance,
        cmd.reason,
      ],
    );
    let closedShifts = 0;
    if (cmd.closeOpenShifts) {
      const shifts = await client.query<{ id: string }>(
        `update billing.employee_shifts s set status = 'force_closed', ended_at = now(),
          forced_by_account_id = $2, force_close_reason = $3,
          bill_count = (select count(*) from billing.bills b where b.shift_id = s.id)
         where outlet_id = $1 and status = 'open' and business_date <= $4 returning id`,
        [initial.outletId, actor.accountId, cmd.reason, initial.businessDate],
      );
      closedShifts = shifts.rows.length;
      for (const shift of shifts.rows)
        await recordAudit(client, {
          action: 'shift.force_closed',
          result: 'success',
          actorAccountId: actor.accountId,
          organizationId: actor.scope.organizationId,
          franchiseId: actor.scope.franchiseId,
          outletId: initial.outletId,
          correlationId: meta.correlationId ?? randomUUID(),
          metadata: {
            shiftId: shift.id,
            cashSessionId: id,
            reason: cmd.reason,
            source: 'owner_register_close',
          },
        });
    }
    await recordAudit(client, {
      action: 'cash_session.closed',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      franchiseId: actor.scope.franchiseId,
      outletId: initial.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: {
        cashSessionId: id,
        variance,
        reason: cmd.reason,
        closedShifts,
        source: 'owner_register_close',
      },
    });
    return { id, expectedCash: expected, countedCash: cmd.countedCash, variance, closedShifts };
  });
  await notifyCashDifference(pool, result.id);
  return result;
}
