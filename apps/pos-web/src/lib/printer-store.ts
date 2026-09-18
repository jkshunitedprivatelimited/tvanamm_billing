const KEY = 'jksh_printer_config';

export type PrinterConfig =
  | { kind: 'browser' }
  | { kind: 'bluetooth'; deviceId: string; deviceName: string }
  | { kind: 'network'; ip: string; port: number; label?: string };

/** Per-device choice — a printer is physically wired to one terminal, not
 *  synced anywhere, so this stays in localStorage like the paper-width
 *  preference does. */
export function readPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { kind: 'browser' };
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
      const { kind } = parsed;
      if (kind === 'bluetooth' || kind === 'network' || kind === 'browser') {
        return parsed as PrinterConfig;
      }
    }
  } catch {
    /* corrupted or storage disabled — fall through */
  }
  return { kind: 'browser' };
}

export function savePrinterConfig(config: PrinterConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* storage disabled — the choice just won't survive a reload */
  }
}

export function forgetPrinterConfig(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
