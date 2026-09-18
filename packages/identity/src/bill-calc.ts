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
  /** A combo component's proportionally-allocated share of the combo's total
   *  selling price. When set, this is the line's exact base total and
   *  `unitPrice * quantity` is not recomputed - a proportional allocation
   *  generally does not divide evenly per unit
   *  (`menu-publishing.md` "Billing proportionally allocates combo value and
   *  discounts across component sale lines"). */
  baseTotalOverride?: string;
  /** An automatic scheduled-offer discount, in paise, applied to this line
   *  BEFORE any manual employee `lineDiscount` (which then computes on the
   *  post-offer amount) - "Employee discount may apply afterward ... but
   *  total discount cannot exceed remaining payable value"
   *  (`scheduled-offers.md`). Clamped to the line base. */
  autoLineDiscountPaise?: number;
}

export interface CalcInput {
  paymentMethod: 'cash' | 'upi' | null;
  lines: CalcLineInput[];
  billDiscount?: CalcDiscount;
}

export interface CalcLineResult {
  baseTotal: string; // unit*qty + addons, before any discount
  autoDiscount: string; // scheduled-offer portion of the line discount
  discount: string; // offer + line discount + allocated share of the bill discount
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

export function toPaise(decimal: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(decimal.trim())) {
    throw new Error(`invalid money value: ${decimal}`);
  }
  const neg = decimal.trim().startsWith('-');
  const [whole, frac = ''] = decimal.trim().replace('-', '').split('.');
  const paise = Number(whole) * PAISE + Number((frac + '00').slice(0, 2));
  return neg ? -paise : paise;
}

export function fromPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  return `${neg ? '-' : ''}${String(Math.floor(abs / PAISE))}.${String(abs % PAISE).padStart(2, '0')}`;
}

/** Discount in paise, clamped to [0, base]. Percent rounds half-up. */
export function discountPaise(base: number, d: CalcDiscount | undefined): number {
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

/** Splits `totalPaise` across `weightsPaise` in proportion to each weight,
 *  remainder to the last positive-weight entry - the same pattern already
 *  used for bill-discount allocation across lines. Used to allocate a
 *  combo's total selling price across its components by their own
 *  standalone prices. */
export function allocateProportionally(totalPaise: number, weightsPaise: number[]): number[] {
  const weightTotal = weightsPaise.reduce((s, w) => s + w, 0);
  const shares = new Array<number>(weightsPaise.length).fill(0);
  if (totalPaise === 0 || weightTotal === 0) return shares;
  let allocated = 0;
  let lastIdx = -1;
  for (let i = 0; i < weightsPaise.length; i += 1) {
    const w = weightsPaise[i] ?? 0;
    if (w <= 0) continue;
    const share = Math.floor((totalPaise * w) / weightTotal);
    shares[i] = share;
    allocated += share;
    lastIdx = i;
  }
  if (lastIdx >= 0) shares[lastIdx] = (shares[lastIdx] ?? 0) + (totalPaise - allocated);
  return shares;
}

export function calculateBill(input: CalcInput): CalcResult {
  if (input.lines.length === 0) throw new Error('a bill needs at least one line');

  // 1. Per-line base + line-level discount.
  const bases = input.lines.map((line) => {
    if (line.quantity <= 0 || !Number.isInteger(line.quantity)) {
      throw new Error('line quantity must be a positive integer');
    }
    let base: number;
    if (line.baseTotalOverride !== undefined) {
      base = toPaise(line.baseTotalOverride);
    } else {
      // An add-on's quantity is per unit of the item it's attached to (the
      // POS merges repeated identical item+addon selections into one line by
      // incrementing `quantity`, never by growing the addons array), so the
      // add-on cost scales with the line quantity the same way the item
      // price does — matching the POS's own display total
      // (`apps/pos-web/src/app/pos/pos-client.tsx`'s `lineTotal`). Omitting
      // that multiplication under-billed every multi-quantity line with an
      // add-on.
      base = toPaise(line.unitPrice) * line.quantity;
      for (const a of line.addons) {
        if (a.quantity <= 0 || !Number.isInteger(a.quantity)) {
          throw new Error('add-on quantity must be a positive integer');
        }
        base += toPaise(a.unitPrice) * a.quantity * line.quantity;
      }
    }
    if (base < 0) throw new Error('line base cannot be negative');
    const autoDisc = Math.min(Math.max(line.autoLineDiscountPaise ?? 0, 0), base);
    const afterAuto = base - autoDisc;
    const lineDisc = discountPaise(afterAuto, line.lineDiscount);
    return { base, autoDisc, lineDisc, afterLine: afterAuto - lineDisc };
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
    const discount = b.autoDisc + b.lineDisc + (alloc[i] ?? 0);
    const finalTotal = Math.max(b.base - discount, 0);
    return {
      baseTotal: fromPaise(b.base),
      autoDiscount: fromPaise(b.autoDisc),
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
