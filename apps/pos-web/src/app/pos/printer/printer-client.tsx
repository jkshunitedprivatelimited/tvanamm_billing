'use client';

import { useEffect, useState } from 'react';
import { bluetoothSupported, pairBluetoothPrinter, smartPrintTest } from '@/lib/printer';
import {
  forgetPrinterConfig,
  readPrinterConfig,
  savePrinterConfig,
  type PrinterConfig,
} from '@/lib/printer-store';

export function PrinterClient() {
  const [config, setConfig] = useState<PrinterConfig>({ kind: 'browser' });
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('9100');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const current = readPrinterConfig();
    setConfig(current);
    if (current.kind === 'network') {
      setIp(current.ip);
      setPort(String(current.port));
    }
  }, []);

  async function testPrint(target: PrinterConfig) {
    setBusy(true);
    setMsg(null);
    const result = await smartPrintTest(target);
    setBusy(false);
    if (result.via === target.kind && result.ok) {
      setMsg({ text: 'Test ticket sent — check the printer.', ok: true });
    } else {
      setMsg({
        text:
          result.error ?? 'Could not reach that printer — opened the browser print dialog instead.',
        ok: false,
      });
    }
  }

  async function connectBluetooth() {
    setBusy(true);
    setMsg(null);
    try {
      const { deviceId, deviceName } = await pairBluetoothPrinter();
      const next: PrinterConfig = { kind: 'bluetooth', deviceId, deviceName };
      savePrinterConfig(next);
      setConfig(next);
      setMsg({ text: `Paired with ${deviceName}. Sending a test ticket…`, ok: true });
      await testPrint(next);
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : 'Pairing failed.', ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveNetwork() {
    const portNum = Number(port);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) {
      setMsg({ text: 'Enter the printer’s IP address, e.g. 192.168.1.50', ok: false });
      return;
    }
    const next: PrinterConfig = { kind: 'network', ip: ip.trim(), port: portNum || 9100 };
    savePrinterConfig(next);
    setConfig(next);
    await testPrint(next);
  }

  function useBrowserDialog() {
    forgetPrinterConfig();
    setConfig({ kind: 'browser' });
    setMsg({ text: 'Switched to the browser’s own print dialog.', ok: true });
  }

  const statusLine =
    config.kind === 'bluetooth'
      ? `Bluetooth · ${config.deviceName}`
      : config.kind === 'network'
        ? `WiFi · ${config.ip}:${String(config.port)}`
        : 'Browser print dialog (no printer connected)';

  return (
    <>
      <div className="card">
        <strong>Current printer</strong>
        <p className="muted" style={{ marginTop: 4 }}>
          {statusLine}
        </p>
        {config.kind !== 'browser' ? (
          <button className="secondary sm" disabled={busy} onClick={useBrowserDialog}>
            Forget this printer
          </button>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <strong>Bluetooth printer</strong>
        <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
          Works with printers that support Bluetooth Low Energy. Pair once here — the receipt prints
          directly to it from then on, no dialog. Older thermal printers that only speak classic
          Bluetooth (SPP) won’t show up; use WiFi below instead if yours doesn’t.
        </p>
        {bluetoothSupported() ? (
          <button disabled={busy} onClick={() => void connectBluetooth()}>
            {busy ? 'Working…' : 'Pair Bluetooth printer'}
          </button>
        ) : (
          <p className="error">
            This browser/device doesn’t support Bluetooth printing (needs Chrome on Android or
            desktop).
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <strong>WiFi printer</strong>
        <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
          Connect the printer to this outlet’s WiFi first (most thermal printers print their IP
          address on a self-test ticket, or have a small screen/app to show it), then enter it here.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ flex: 1, minWidth: 140 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Printer IP address
            </div>
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.50"
              style={{ marginBottom: 0 }}
            />
          </label>
          <label style={{ width: 100 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Port
            </div>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="9100"
              style={{ marginBottom: 0 }}
            />
          </label>
          <button disabled={busy || !ip.trim()} onClick={() => void saveNetwork()}>
            {busy ? 'Working…' : 'Save & test print'}
          </button>
        </div>
      </div>

      {config.kind !== 'browser' ? (
        <button
          className="secondary"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => void testPrint(config)}
        >
          Send test ticket again
        </button>
      ) : null}

      {msg ? <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p> : null}
    </>
  );
}
