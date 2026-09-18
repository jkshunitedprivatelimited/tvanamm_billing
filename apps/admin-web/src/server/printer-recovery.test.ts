/// <reference path="../../../pos-web/src/types/web-bluetooth.d.ts" />
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  config: { kind: 'bluetooth', deviceId: 'printer-1', deviceName: 'Test printer' },
}));
vi.mock('../../../pos-web/src/lib/printer-store', () => ({
  readPrinterConfig: () => state.config,
  savePrinterConfig: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { print: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());
it('keeps a disconnected Bluetooth failure visible instead of opening the print dialog', async () => {
  const { smartPrintTest } = await import('../../../pos-web/src/lib/printer');
  const r = await smartPrintTest({
    kind: 'bluetooth',
    deviceId: 'printer-1',
    deviceName: 'Test printer',
  });
  expect(r.ok).toBe(false);
  expect(r.via).toBe('bluetooth');
  expect(r.error).toContain('Reconnect');
  expect(window.print).not.toHaveBeenCalled();
});
it('shows a configured Bluetooth device as disconnected until a real connection exists', async () => {
  const { printerConnectionStatus } = await import('../../../pos-web/src/lib/printer');
  expect(printerConnectionStatus()).toBe('Test printer · disconnected');
});
