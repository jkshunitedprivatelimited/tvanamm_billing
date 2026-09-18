# Central admin experience

## Separation from the franchise-owner workspace

Owners operate their own outlet(s). Central admin runs supply, fulfilment and
organization-wide oversight. Navigation, default reports and activity views must
reflect this distinction; authorization remains enforced on the server.

Implemented in this pass:

- Owner with one outlet: direct dashboard with today's real sales, bills, cash/UPI,
  setup attention and task cards. No redundant outlet picker.
- Owner with multiple outlets: portfolio metrics and named outlet cards.
- Owner activity: operational events by default; sign-ins, shifts and attendance
  grouped under Team; detailed timeline and support references on demand.
- Central activity: all organization events by default, with account/device detail.
- Central stock control: shortages by outlet, configurable item limits, direct
  access to fulfilment, purchasing and recalls. Alert data requires migration 0012.
- Responsive header with compact mobile menu; mobile reports use a category
  selector instead of clipped horizontal navigation.

## Next central-admin screens, in priority order

1. **Operations home**: actionable queues rather than an undifferentiated metric
   wall. Paid orders awaiting allocation, ready-to-dispatch orders, overdue
   deliveries, unresolved discrepancies and material shortages. Show age, outlet,
   responsible role and next action on every row. Never invent counts when a
   service is unavailable.
2. **Fulfilment**: status tabs, outlet/warehouse filters, stock allocation and
   dispatch timeline. Keep payment confirmation separate from fulfilment status.
   Preserve partial dispatch and receipt quantities.
3. **Inventory & replenishment**: warehouse/outlet switch, available/reserved/
   quarantined stock, expiry and item-specific minimum levels with units. Bulk
   rule editing should preview affected outlets before saving.
4. **Exceptions**: one queue for receipt differences, returns, count variances
   and failed integrations, with clear owners and resolution notes. Keep money
   adjustments and stock movements auditable and permission-gated.
5. **Organization reports**: franchise → outlet drill-down, consistent date
   context, comparable performance metrics and scoped downloads.
6. **Administration**: outlet onboarding, team/device setup, supply catalog and
   recipes grouped away from daily operations. Avoid owner-visible technical
   configuration screens.

## Design requirements

- One primary action per page; use descriptive cards/buttons instead of loose
  collections of links. Place exceptions ahead of routine work.
- Persistent outlet/warehouse/franchise context; automatic selection for a
  single permitted outlet, explicit switcher only when there is a choice.
- Mobile: compact header, readable controls, single-column task cards,
  two-column metric cards and contained scrolling for wide accounting tables.
- Show event facts: actor, outlet, action, time, amounts/reasons where recorded.
  Do not pretend separate attendance and authentication records are one event.
- Validate using owner and central sessions, small/wide screens and failed
  service conditions. Performance claims require measured representative data.
