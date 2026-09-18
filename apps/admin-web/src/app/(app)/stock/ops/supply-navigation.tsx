'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const items = [
  ['', 'Overview'],
  ['catalog', 'Items & prices'],
  ['warehouses', 'Warehouses'],
  ['suppliers', 'Suppliers'],
  ['purchase-orders', 'Purchases'],
  ['fulfilment', 'Outlet deliveries'],
  ['recipes', 'Recipes'],
  ['sop', 'SOP standards'],
  ['recalls', 'Stock recalls'],
  ['integration', 'Billing sync'],
] as const;
export function SupplyNavigation() {
  const path = usePathname();
  return (
    <nav aria-label="Supply operations">
      {items.map(([segment, name]) => {
        const href = `/stock/ops${segment ? `/${segment}` : ''}`;
        return (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            {name}
            <span aria-hidden="true">→</span>
          </Link>
        );
      })}
    </nav>
  );
}
