import { describe, expect, it } from 'vitest';
import type { ReceiptSnapshot } from '@jksh/contracts';
import { buildReceiptEscPos } from './escpos';

const base: ReceiptSnapshot = {
  outletName: 'Tvanamm Test',
  outletAddress: 'Main Road',
  outletPhone: '9876500000',
  gstin: '36ABCDE1234F1Z5',
  receiptNumber: '20261125-T02-000001',
  businessDate: '2026-11-25',
  committedAt: '2026-11-25T13:00:00.000Z',
  lines: [
    {
      itemName: 'Tea',
      quantity: 1,
      unitPrice: '20.00',
      discount: '0.00',
      finalTotal: '20.00',
      note: 'less sugar',
      comboName: null,
      offerLabel: null,
      addons: [],
    },
  ],
  subtotal: '20.00',
  discountTotal: '0.00',
  roundAdjustment: '0.00',
  finalTotal: '20.00',
  paymentMethod: 'upi',
  isComplimentary: false,
};
const text = (r: ReceiptSnapshot) => new TextDecoder('latin1').decode(buildReceiptEscPos(r, 80));

describe('thermal receipt layout', () => {
  it('prints everything for receipts without settings (older snapshots)', () => {
    const t = text(base);
    expect(t).toContain('Main Road');
    expect(t).toContain('Note: less sugar');
    expect(t).toContain('Thank you, visit again!');
  });

  it('follows the outlet settings', () => {
    const t = text({
      ...base,
      customerName: 'Priya',
      customerMobile: '******3210',
      cashierName: 'Ravi',
      headerNote: 'FSSAI 123',
      footerNote: null,
      layout: {
        showAddress: false,
        showOutletPhone: false,
        showTime: true,
        showPaymentMethod: false,
        showItemNotes: false,
      },
    });
    for (const s of ['Customer: Priya', 'Phone: ******3210', 'Cashier: Ravi', 'FSSAI 123', 'GSTIN'])
      expect(t).toContain(s);
    for (const s of ['Main Road', '9876500000', 'less sugar', 'Payment', 'Thank you'])
      expect(t).not.toContain(s);
  });
});
