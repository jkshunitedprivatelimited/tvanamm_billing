'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav>
      {items.map((it) => {
        const active =
          it.href === '/'
            ? pathname === '/'
            : pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link key={it.href} href={it.href} aria-current={active ? 'page' : undefined}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
