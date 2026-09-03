import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { InsecureAuthBanner } from '@/components/InsecureAuthBanner';

export const metadata: Metadata = {
  title: 'JKSH Admin',
  description: 'Central, Accountant, and Franchise Owner workspace',
};

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
