import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'JKSH Billing',
  description: 'Store Billing terminal',
};

// The Edge proxy issues a per-request CSP nonce; Next only threads that nonce
// into its own <script> tags on a dynamic render, so every route must be
// dynamic (a prerendered page would ship scripts the CSP then blocks).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
