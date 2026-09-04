import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { InsecureAuthBanner } from '@/components/InsecureAuthBanner';

export const metadata: Metadata = {
  title: 'JKSH Admin',
  description: 'Central, Accountant, and Franchise Owner workspace',
};

// The Edge proxy issues a per-request CSP nonce; Next only threads that nonce
// into its own <script> tags on a dynamic render, so every route must be
// dynamic (a prerendered page would ship scripts the CSP then blocks).
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InsecureAuthBanner />
        {children}
      </body>
    </html>
  );
}
