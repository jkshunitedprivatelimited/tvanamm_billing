/**
 * The authoritative bill calculator. Pure, deterministic, integer-paise math -
 * the server runs it with authoritative published-menu prices, and an offline
 * PWA can run the identical function for a provisional preview.
 *
 * Money crosses the boundary as decimal strings ("12.50"); internally everything
 * is integer paise so there is no binary floating point in a financial path.
 */

export type DiscountKind = 'fixed' | 'percent';

export interface CalcDiscount {
  kind: DiscountKind;
  /** fixed: rupees ("10.00"); percent: whole/decimal percent ("15" or "12.5") */
  value: string;
}

export interface CalcAddonInput {
  unitPrice: string; // GST-inclusive
  quantity: number;
}

export interface CalcLineInput {
  unitPrice: string; // GST-inclusive
  quantity: number;
  addons: CalcAddonInput[];
  lineDiscount?: CalcDiscount;
}

export interface CalcInput {
  paymentMethod: 'cash' | 'upi' | null;
  lines: CalcLineInput[];
  billDiscount?: CalcDiscount;
}

export interface CalcLineResult {
  baseTotal: string; // unit*qty + addons, before any discount
  discount: string; // line discount + allocated share of the bill discount
  finalTotal: string; // baseTotal - discount, never negative
}

export interface CalcResult {
  lines: CalcLineResult[];
  subtotal: string; // Σ line baseTotal
  discountTotal: string; // Σ line discount (incl. allocated bill discount)
  preRoundTotal: string; // Σ line finalTotal
  roundAdjustment: string; // cash: nearest-rupee delta; upi: "0.00"
  finalTotal: string;
  isComplimentary: boolean;
}

const PAISE = 100;

function toPaise(decimal: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(decimal.trim())) {
    throw new Error(`invalid money value: ${decimal}`);
  }
  const neg = decimal.trim().startsWith('-');
  const [whole, frac = ''] = decimal.trim().replace('-', '').split('.');
  const paise = Number(whole) * PAISE + Number((frac + '00').slice(0, 2));
  return neg ? -paise : paise;
}

function fromPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  return `${neg ? '-' : ''}${String(Math.floor(abs / PAISE))}.${String(abs % PAISE).padStart(2, '0')}`;
}

/** Discount in paise, clamped to [0, base]. Percent rounds half-up. */
function discountPaise(base: number, d: CalcDiscount | undefined): number {
  if (!d) return 0;
  if (base <= 0) return 0;
  if (d.kind === 'fixed') {
    return Math.min(Math.max(toPaise(d.value), 0), base);
  }
  const pct = Number(d.value);
  if (!Number.isFinite(pct) || pct < 0) throw new Error(`invalid percent: ${d.value}`);
  const raw = Math.floor((base * pct) / 100 + 0.5);
  return Math.min(raw, base);
}

export function calculateBill(input: CalcInput): CalcResult {
  if (input.lines.length === 0) throw new Error('a bill needs at least one line');

  // 1. Per-line base + line-level discount.
  const bases = input.lines.map((line) => {
    if (line.quantity <= 0 || !Number.isInteger(line.quantity)) {
      throw new Error('line quantity must be a positive integer');
    }
    let base = toPaise(line.unitPrice) * line.quantity;
    for (const a of line.addons) {
      if (a.quantity <= 0 || !Number.isInteger(a.quantity)) {
        throw new Error('add-on quantity must be a positive integer');
      }
      base += toPaise(a.unitPrice) * a.quantity;
    }
    if (base < 0) throw new Error('line base cannot be negative');
    const lineDisc = discountPaise(base, line.lineDiscount);
    return { base, lineDisc, afterLine: base - lineDisc };
  });

  const subtotal = bases.reduce((s, b) => s + b.base, 0);
  const afterLineTotal = bases.reduce((s, b) => s + b.afterLine, 0);

  // 2. Bill-level discount, allocated across lines in proportion to the
  //    post-line-discount amount, remainder to the last non-zero line.
  const billDisc = discountPaise(afterLineTotal, input.billDiscount);
  const alloc = new Array<number>(bases.length).fill(0);
  if (billDisc > 0 && afterLineTotal > 0) {
    let allocated = 0;
    let lastIdx = -1;
    for (let i = 0; i < bases.length; i += 1) {
      const b = bases[i];
      if (!b || b.afterLine <= 0) continue;
      const share = Math.floor((billDisc * b.afterLine) / afterLineTotal);
      alloc[i] = share;
      allocated += share;
      lastIdx = i;
    }
    if (lastIdx >= 0) alloc[lastIdx] = (alloc[lastIdx] ?? 0) + (billDisc - allocated);
  }

  // 3. Per-line result.
  const lines: CalcLineResult[] = bases.map((b, i) => {
    const discount = b.lineDisc + (alloc[i] ?? 0);
    const finalTotal = Math.max(b.base - discount, 0);
    return {
      baseTotal: fromPaise(b.base),
      discount: fromPaise(Math.min(discount, b.base)),
      finalTotal: fromPaise(finalTotal),
    };
  });

  const preRound = lines.reduce((s, l) => s + toPaise(l.finalTotal), 0);
  const discountTotal = subtotal - preRound;

  // 4. Rounding.
  let roundAdjustment = 0;
  let finalTotal = preRound;
  if (input.paymentMethod === 'cash' && preRound > 0) {
    const rupees = Math.round(preRound / PAISE) * PAISE;
    roundAdjustment = rupees - preRound;
    finalTotal = rupees;
  }

  const isComplimentary = preRound === 0;
  if (!isComplimentary && input.paymentMethod === null) {
    throw new Error('a positive-total bill needs a payment method');
  }

  return {
    lines,
    subtotal: fromPaise(subtotal),
    discountTotal: fromPaise(discountTotal),
    preRoundTotal: fromPaise(preRound),
    roundAdjustment: fromPaise(roundAdjustment),
    finalTotal: fromPaise(finalTotal),
    isComplimentary,
  };
}
