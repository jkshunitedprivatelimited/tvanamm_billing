'use client';
import Link from 'next/link';
import { useRef } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { NotificationBell } from '@/components/NotificationBell';
import { AppNav, type NavItem } from './AppNav';
import { LogoutButton } from './LogoutButton';

export function AppHeader({ items, role }: { items: NavItem[]; role: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <header className="topbar app-header">
      <Link href="/" className="brand" aria-label="T Vanamm home">
        <BrandMark />
        <span>
          T VANAMM<small>Business workspace</small>
        </span>
      </Link>
      <div className="desktop-nav">
        <AppNav items={items} />
      </div>
      <div className="header-actions">
        <Link href="/help">Help</Link>
        <NotificationBell />
        <span className="badge desktop-account">{role}</span>
        <div className="desktop-account">
          <LogoutButton />
        </div>
        <details
          className="mobile-menu"
          ref={menu}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && menu.current) menu.current.open = false;
          }}
        >
          <summary aria-label="Open navigation menu">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span>Menu</span>
          </summary>
          <div className="mobile-menu-panel">
            <p className="eyebrow">{role}</p>
            <div
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a') && menu.current)
                  menu.current.open = false;
              }}
            >
              <AppNav items={items} />
            </div>
            <div className="mobile-menu-footer">
              <LogoutButton />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
