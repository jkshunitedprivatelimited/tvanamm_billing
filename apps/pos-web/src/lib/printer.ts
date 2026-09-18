import type { ReceiptSnapshot } from '@jksh/contracts';
import { buildReceiptEscPos } from './escpos';
import { readPrinterConfig, savePrinterConfig, type PrinterConfig } from './printer-store';

/** BLE writes are capped by the negotiated MTU (often as low as 20 bytes on
 *  older stacks); chunking conservatively avoids "value too long" write
 *  failures on cheap thermal printers rather than trying to negotiate MTU. */
const BLE_CHUNK_BYTES = 20;

// Kept across print calls within the same page load so a second sale reuses
// the live GATT connection instead of reconnecting every time. Lost on
// reload, same as any other in-memory browser API handle — see
// `resolveBluetoothDevice` for how a reload recovers it without re-pairing.
let cachedDevice: BluetoothDevice | null = null;
let lastPrintFailed = false;
let cachedCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

function printerChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('jksh-printer-status'));
}
function watchDevice(device: BluetoothDevice) {
  device.addEventListener('gattserverdisconnected', () => {
    cachedCharacteristic = null;
    printerChanged();
  });
}
export function printerConnectionStatus(): string {
  const config = readPrinterConfig();
  if (config.kind === 'browser') return 'System printer · status unavailable';
  if (config.kind === 'network') return 'Network printer · not checked';
  if (lastPrintFailed) return `${config.deviceName} · needs attention`;
  return cachedDevice?.id === config.deviceId && cachedDevice.gatt?.connected
    ? `${config.deviceName} · connected`
    : `${config.deviceName} · disconnected`;
}
export async function reconnectPrinter(): Promise<void> {
  const paired = await pairBluetoothPrinter();
  savePrinterConfig({ kind: 'bluetooth', ...paired });
  if (!cachedDevice?.gatt)
    throw new Error('This printer does not expose a Bluetooth Low Energy connection.');
  const server = await cachedDevice.gatt.connect();
  cachedCharacteristic = await findWritableCharacteristic(server);
  lastPrintFailed = false;
  printerChanged();
}

export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/** First-time pairing — must run from a user gesture (a button click).
 *  `acceptAllDevices` because thermal printers ship wildly inconsistent
 *  advertised service UUIDs; the actual writable characteristic is found
 *  afterwards by probing every service instead of filtering up front. */
export async function pairBluetoothPrinter(): Promise<{ deviceId: string; deviceName: string }> {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not supported on this device.');
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      '000018f0-0000-1000-8000-00805f9b34fb', // common generic-serial service used by many BLE thermal printers
      '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style UART bridge, also common
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Nordic UART service, used by some printer firmwares
    ],
  });
  cachedDevice = device;
  watchDevice(device);
  printerChanged();
  cachedCharacteristic = null; // rediscover on next print
  return { deviceId: device.id, deviceName: device.name ?? 'Bluetooth printer' };
}

/** Recovers the device handle after a page reload (no new pairing prompt —
 *  Chromium allows reconnecting to an already-authorized device without a
 *  user gesture, only the initial `requestDevice` needs one). Returns null
 *  if the browser doesn't support persisted-permission lookup or the device
 *  is no longer authorized, in which case the caller should ask the owner
 *  to reconnect from Printer settings. */
async function resolveBluetoothDevice(deviceId: string): Promise<BluetoothDevice | null> {
  if (cachedDevice?.id === deviceId) return cachedDevice;
  if (!navigator.bluetooth?.getDevices) return null;
  const known = await navigator.bluetooth.getDevices();
  const match = known.find((d) => d.id === deviceId) ?? null;
  cachedDevice = match;
  if (match) watchDevice(match);
  cachedCharacteristic = null;
  return match;
}

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (writable) return writable;
  }
  throw new Error('No writable characteristic found on this printer.');
}

async function printToBluetooth(deviceId: string, bytes: Uint8Array): Promise<void> {
  const device = await resolveBluetoothDevice(deviceId);
  if (!device?.gatt) {
    throw new Error('Bluetooth printer is not paired with this browser any more — reconnect it.');
  }
  if (!device.gatt.connected) cachedCharacteristic = null;
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  printerChanged();
  cachedCharacteristic ??= await findWritableCharacteristic(server);
  const char = cachedCharacteristic;
  for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_BYTES) {
    const chunk = bytes.slice(offset, offset + BLE_CHUNK_BYTES);
    if (char.properties.writeWithoutResponse) await char.writeValueWithoutResponse(chunk);
    else await char.writeValue(chunk);
  }
}

async function printToNetwork(ip: string, port: number, bytes: Uint8Array): Promise<void> {
  const res = await fetch('/api/v1/print/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, port, dataBase64: bytesToBase64(bytes) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Network printer did not accept the print job.');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Test line for the Printer settings page — a short cut-only ticket so the
 *  owner can confirm the connection without wasting a full receipt's paper. */
export function testTicketBytes(): Uint8Array {
  const bytes = [
    0x1b,
    0x40, // init
    0x1b,
    0x61,
    0x01, // center
    ...Array.from('T VANAMM').map((c) => c.charCodeAt(0)),
    0x0a,
    ...Array.from('Printer connected').map((c) => c.charCodeAt(0)),
    0x0a,
    0x0a,
    0x0a,
    0x1d,
    0x56,
    0x42,
    0x00, // cut
  ];
  return new Uint8Array(bytes);
}

export interface PrintResult {
  ok: boolean;
  via: 'bluetooth' | 'network' | 'browser';
  error?: string;
}

/** Prints straight to the configured hardware printer; falls back to the
 *  browser's own print dialog (unchanged prior behaviour) if none is
 *  configured, or if the direct print fails for any reason — a jammed or
 *  disconnected printer must never block the cashier from moving on. */
export async function smartPrintReceipt(
  receipt: ReceiptSnapshot,
  paperWidthMm: 58 | 80,
): Promise<PrintResult> {
  const config = readPrinterConfig();
  return smartPrintBytes(config, buildReceiptEscPos(receipt, paperWidthMm));
}

export async function smartPrintTest(config: PrinterConfig): Promise<PrintResult> {
  return smartPrintBytes(config, testTicketBytes());
}

/** For content that isn't a full `ReceiptSnapshot` yet (the offline-sale
 *  holding ticket) — reads the saved config itself, same as
 *  `smartPrintReceipt`. */
export async function smartPrint(bytes: Uint8Array): Promise<PrintResult> {
  return smartPrintBytes(readPrinterConfig(), bytes);
}

async function smartPrintBytes(config: PrinterConfig, bytes: Uint8Array): Promise<PrintResult> {
  try {
    if (config.kind === 'bluetooth') {
      await printToBluetooth(config.deviceId, bytes);
      lastPrintFailed = false;
      printerChanged();
      return { ok: true, via: 'bluetooth' };
    }
    if (config.kind === 'network') {
      await printToNetwork(config.ip, config.port, bytes);
      return { ok: true, via: 'network' };
    }
  } catch (error) {
    cachedCharacteristic = null;
    lastPrintFailed = true;
    printerChanged();
    return {
      ok: false,
      via: config.kind,
      error: `${error instanceof Error ? error.message : 'Printer disconnected'} Reconnect the printer and retry. Some lines may already have printed; check before retrying.`,
    };
  }

  try {
    window.print();
  } catch {
    /* ignore */
  }
  return { ok: true, via: 'browser' };
}
