import 'server-only';
import type { ActorContext } from '@jksh/contracts';
import { contextForActor, listOutlets } from '@jksh/identity';
import { withActorContext, withStockActorContext } from '@jksh/db';
import { stockContextForActor } from '@jksh/stock';
import { db } from './pool';
import { stockDb, stockActorFor } from './stock';
export type ReportRow = Record<string, string | number | null>;
export async function getOperationalReports(
  actor: ActorContext,
  from: string,
  to: string,
  outletId?: string,
  franchiseId?: string,
) {
  const outlets = (await listOutlets(db(), actor)).filter(
    (o) => (!outletId || o.id === outletId) && (!franchiseId || o.franchiseId === franchiseId),
  );
  const ids = outlets.map((o) => o.id);
  const billing = await withActorContext(db(), contextForActor(actor), async (c) => {
    const expenses = await c.query<ReportRow>(
      `select o.display_name as outlet,e.category_name as category,count(*)::int as entries,sum(e.amount)::text as amount,count(*) filter(where e.reviewed_at is null)::int as awaiting_review from billing.outlet_expenses e join billing.outlets o on o.id=e.outlet_id where e.outlet_id=any($1::uuid[]) and e.business_date between $2::date and $3::date and e.reversed_at is null group by o.display_name,e.category_name order by sum(e.amount) desc`,
      [ids, from, to],
    );
    const attendance = await c.query<ReportRow>(
      `select o.display_name as outlet,a.employee_name as employee,count(*)::int as check_ins,count(*) filter(where a.status='open')::int as still_checked_in,count(*) filter(where a.status='missing_checkout')::int as missing_checkouts,round((sum(extract(epoch from (a.checked_out_at-a.checked_in_at))) / 3600)::numeric,2)::text as completed_hours from identity.attendance_sessions a join billing.outlets o on o.id=a.outlet_id where a.outlet_id=any($1::uuid[]) and a.business_date between $2::date and $3::date group by o.display_name,a.employee_id,a.employee_name order by o.display_name,a.employee_name`,
      [ids, from, to],
    );
    return { expenses: expenses.rows, attendance: attendance.rows };
  });
  const stock = await (async () => {
    try {
      const a = await stockActorFor(actor);
      return await withStockActorContext(stockDb(), stockContextForActor(a), async (c) => {
        const orders = await c.query<ReportRow>(
          `select outlet_id::text,status::text,count(*)::int as orders, (sum(total_paise)/100.0)::text as order_value,(sum(delivery_paise)/100.0)::text as delivery_charges from stock.stock_orders where outlet_id=any($1::uuid[]) and (created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date group by outlet_id,status order by outlet_id,status`,
          [ids, from, to],
        );
        const movements = await c.query<ReportRow>(
          `select l.outlet_id::text,i.name as item,i.base_unit as unit,
        coalesce(sum(m.quantity) filter(where (m.occurred_at at time zone 'Asia/Kolkata')::date<$2::date),0)::text as opening,
        coalesce(sum(m.quantity) filter(where (m.occurred_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date and m.quantity>0),0)::text as added,
        coalesce(-sum(m.quantity) filter(where (m.occurred_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date and m.quantity<0),0)::text as used_or_removed,
        coalesce(sum(m.quantity),0)::text as closing
        from stock.stock_movements m join stock.items i on i.id=m.item_id and i.is_active join stock.stock_locations l on l.id=m.stock_location_id and l.is_active
        where l.outlet_id=any($1::uuid[]) and (m.occurred_at at time zone 'Asia/Kolkata')::date<=$3::date group by l.outlet_id,i.id,i.name,i.base_unit order by i.name`,
          [ids, from, to],
        );
        const wastage = await c.query<ReportRow>(
          `select w.outlet_id::text,i.name as item,i.base_unit as unit,w.reason,sum(w.qty_base)::text as quantity from stock.wastage_events w join stock.items i on i.id=w.item_id and i.is_active where w.outlet_id=any($1::uuid[]) and (w.occurred_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date group by w.outlet_id,i.name,i.base_unit,w.reason`,
          [ids, from, to],
        );
        let suppliers: ReportRow[] | null = null;
        let purchases: ReportRow[] | null = null;
        if (actor.role === 'central_admin' && !outletId && !franchiseId) {
          suppliers = (
            await c.query<ReportRow>(
              `select s.name as supplier,i.invoice_number,i.invoice_date::text,i.due_date::text,(i.amount_paise/100.0)::text as invoiced,(coalesce(p.paid,0)/100.0)::text as paid,((i.amount_paise-coalesce(p.paid,0))/100.0)::text as outstanding from stock.supplier_invoices i join stock.suppliers s on s.id=i.supplier_id and s.is_active left join lateral(select sum(amount_paise) as paid from stock.supplier_payments where supplier_invoice_id=i.id and paid_on<=$3::date)p on true where i.organization_id=$1 and i.invoice_date between $2::date and $3::date order by i.due_date nulls last`,
              [a.organizationId, from, to],
            )
          ).rows;
          purchases = (
            await c.query<ReportRow>(
              `select s.name as supplier,w.name as warehouse,p.status::text,count(*)::int as orders,(sum(p.total_paise)/100.0)::text as order_value from stock.purchase_orders p join stock.suppliers s on s.id=p.supplier_id and s.is_active join stock.warehouses w on w.id=p.warehouse_id and w.is_active where p.organization_id=$1 and (p.created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date group by s.name,w.name,p.status`,
              [a.organizationId, from, to],
            )
          ).rows;
        }
        const names = (rows: ReportRow[]) =>
          rows.map(({ outlet_id, ...r }) => ({
            outlet: outlets.find((o) => o.id === outlet_id)?.displayName ?? 'Outlet',
            ...r,
          }));
        return {
          orders: names(orders.rows),
          movements: names(movements.rows),
          wastage: names(wastage.rows),
          suppliers,
          purchases,
        };
      });
    } catch {
      return null;
    }
  })();
  return { from, to, billing, stock };
}
