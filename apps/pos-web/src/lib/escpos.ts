import type { ReceiptSnapshot } from '@jksh/contracts';

/**
 * Encodes a `ReceiptSnapshot` as raw ESC/POS commands for a thermal receipt
 * printer — the same fields `ReceiptView` renders on screen, just laid out
 * for a fixed-width character grid instead of HTML. Kept dependency-free
 * (a handful of well-known ESC/POS byte sequences) so it works equally over
 * Bluetooth (GATT write) or a raw network socket.
 */

const ESC = 0x1b;
const GS = 0x1d;

const INIT = [ESC, 0x40]; // reset printer state
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const CUT = [GS, 0x56, 0x42, 0x00]; // partial cut with feed
const FEED = (lines: number) => [ESC, 0x64, lines];

/** Characters per line for the two supported paper widths, at the printer's
 *  default (font A, 12x24) character size. */
function columnsFor(paperWidthMm: 58 | 80): number {
  return paperWidthMm === 58 ? 32 : 48;
}

function textToBytes(s: string): number[] {
  // Thermal printers are single-byte code pages; strip anything outside
  // printable ASCII plus the rupee sign, which we render as "Rs." instead
  // (no common ESC/POS code page maps ₹, and guessing wrong prints garbage).
  return Array.from(s.replace(/₹/g, 'Rs.')).map((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e ? code : 0x3f; // '?' for anything unmappable
  });
}

function line(s = ''): number[] {
  return [...textToBytes(s), 0x0a];
}

function hr(cols: number): number[] {
  return line('-'.repeat(cols));
}

/** Left-and-right justified pair on one line, truncating the left side
 *  rather than wrapping — matches the on-screen receipt's single-row rows. */
function twoCol(left: string, right: string, cols: number): number[] {
  const maxLeft = Math.max(1, cols - right.length - 1);
  const l = left.length > maxLeft ? left.slice(0, maxLeft - 1) + '…' : left;
  const pad = Math.max(1, cols - l.length - right.length);
  return line(l + ' '.repeat(pad) + right);
}

function centered(s: string): number[] {
  return [...ALIGN_CENTER, ...line(s), ...ALIGN_LEFT];
}

/** A sale made while offline has no server-assigned receipt yet (no bill id,
 *  no finalised line breakdown) — just enough to print a holding ticket
 *  until it syncs and a real receipt can be reprinted from History. */
export function buildOfflineTicketEscPos(
  receiptNumber: string,
  total: string,
  paperWidthMm: 58 | 80,
): Uint8Array {
  const cols = columnsFor(paperWidthMm);
  const out: number[] = [...INIT, ...ALIGN_CENTER, ...BOLD_ON];
  out.push(...line('T VANAMM'));
  out.push(...BOLD_OFF, ...line('Saved offline — will sync'), ...ALIGN_LEFT);
  out.push(...hr(cols));
  out.push(...twoCol('Receipt', receiptNumber, cols));
  out.push(...BOLD_ON, ...twoCol('Total', `Rs.${total}`, cols), ...BOLD_OFF);
  out.push(...hr(cols));
  out.push(...centered('Reprint from History once synced'));
  out.push(...FEED(3), ...CUT);
  return new Uint8Array(out);
}

export function buildReceiptEscPos(receipt: ReceiptSnapshot, paperWidthMm: 58 | 80): Uint8Array {
  const cols = columnsFor(paperWidthMm);
  const out: number[] = [...INIT];

  out.push(...ALIGN_CENTER, ...BOLD_ON, ...line(receipt.outletName), ...BOLD_OFF, ...ALIGN_LEFT);
  out.push(...centered(receipt.outletAddress));
  if (receipt.outletPhone) out.push(...centered(receipt.outletPhone));
  if (receipt.gstin) out.push(...centered(`GSTIN: ${receipt.gstin}`));
  out.push(...hr(cols));
  out.push(...twoCol(receipt.receiptNumber, receipt.businessDate, cols));
  out.push(...line(new Date(receipt.committedAt).toLocaleTimeString()));
  out.push(...hr(cols));

  for (const l of receipt.lines) {
    const name = l.comboName ?? l.itemName;
    out.push(...twoCol(`${String(l.quantity)} x ${name}`, `Rs.${l.finalTotal}`, cols));
    for (const a of l.addons) {
      out.push(...twoCol(`  + ${String(a.quantity)} x ${a.addonName}`, `Rs.${a.unitPrice}`, cols));
    }
    if (l.discount !== '0.00') out.push(...twoCol('  Discount', `-Rs.${l.discount}`, cols));
    if (l.note) out.push(...line(`  Note: ${l.note}`));
  }

  out.push(...hr(cols));
  out.push(...twoCol('Subtotal', `Rs.${receipt.subtotal}`, cols));
  if (receipt.discountTotal !== '0.00') {
    out.push(...twoCol('Discount', `-Rs.${receipt.discountTotal}`, cols));
  }
  if (receipt.roundAdjustment !== '0.00') {
    out.push(...twoCol('Round-off', `Rs.${receipt.roundAdjustment}`, cols));
  }
  out.push(...BOLD_ON, ...twoCol('Total', `Rs.${receipt.finalTotal}`, cols), ...BOLD_OFF);
  out.push(
    ...twoCol(
      'Payment',
      receipt.isComplimentary ? 'Complimentary' : (receipt.paymentMethod ?? '-'),
      cols,
    ),
  );
  out.push(...hr(cols));
  out.push(...centered('Thank you, visit again!'));
  out.push(...FEED(3), ...CUT);

  return new Uint8Array(out);
}
