import { IdentityError } from './errors';

/** Use existing Central settings without changing the GST-inclusive price. */
export function inheritOutletItemTax(settings: { gst_rate: string; hsn_code: string | null }[]): {
  gstRate: string;
  hsnCode: string | null;
} {
  if (settings.length !== 1 || !settings[0]) {
    throw new IdentityError(
      'validation',
      'Central must configure a default item tax setting because the master menu has missing or mixed tax settings.',
    );
  }
  return { gstRate: settings[0].gst_rate, hsnCode: settings[0].hsn_code };
}
