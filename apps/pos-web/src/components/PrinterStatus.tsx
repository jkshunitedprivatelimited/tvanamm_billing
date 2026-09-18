'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { printerConnectionStatus, reconnectPrinter } from '@/lib/printer';
import { readPrinterConfig } from '@/lib/printer-store';
export function PrinterStatus() {
  const [status, setStatus] = useState('Printer');
  const [ble, setBle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => {
      setStatus(printerConnectionStatus());
      setBle(readPrinterConfig().kind === 'bluetooth');
    };
    refresh();
    window.addEventListener('jksh-printer-status', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('jksh-printer-status', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return (
    <div className="no-print" style={{ fontSize: 13, padding: '8px 16px' }}>
      <Link href="/pos/printer">Printer: {status}</Link>
      {ble && (status.includes('disconnected') || status.includes('needs attention')) ? (
        <button
          className="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void reconnectPrinter()
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Could not reconnect'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Connecting…' : 'Reconnect'}
        </button>
      ) : null}
      {error ? <span role="alert"> {error}</span> : null}
    </div>
  );
}
