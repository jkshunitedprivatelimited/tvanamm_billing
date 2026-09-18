import Link from 'next/link';
import { getOperatorSummary } from '@jksh/identity';
import { requireOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { PrinterClient } from './printer-client';

export default async function PrinterPage() {
  const actor = await requireOperator();
  const me = await getOperatorSummary(db(), actor);

  return (
    <main className="pos">
      <div className="statusbar" style={{ margin: '-32px -20px 20px' }}>
        <span>
          <strong>{me?.outletName ?? 'Outlet'}</strong> · Printer
        </span>
        <Link href="/pos">&larr; Back to billing</Link>
      </div>
      <h1>Connect your receipt printer</h1>
      <p>Choose Bluetooth, USB or Wi-Fi, then print a test receipt.</p>
      <PrinterClient allowLocalNetwork={!process.env.VERCEL} />
      <div className="receipt printer-test-receipt">
        <strong>T VANAMM</strong>
        <p>PRINTER TEST</p>
        <p>Receipt printing is ready.</p>
        <p>0123456789</p>
        <p>Thank you!</p>
      </div>
    </main>
  );
}
