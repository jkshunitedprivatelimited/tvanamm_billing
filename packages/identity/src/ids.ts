import { randomInt } from 'node:crypto';

// Crockford base32 without I, L, O, U to avoid transcription errors.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomToken(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return out;
}

/** Employee code shown to Franchise Owners, e.g. EMP-7Q2K9F. */
export function generateEmployeeCode(): string {
  return `EMP-${randomToken(6)}`;
}

/** Terminal activation code entered by hand on the device. Grouped for reading. */
export function generateActivationCode(): string {
  return `${randomToken(4)}-${randomToken(4)}`;
}

/** Opaque server-issued terminal credential body (before HMAC signing). */
export function generateCredentialId(): string {
  return randomToken(24);
}

const RECEIPT_NUMBER_PATTERN = /^\d{8}-T\d{2}-\d{6}$/;

export function isReceiptNumber(value: string): boolean {
  return RECEIPT_NUMBER_PATTERN.test(value);
}

/** Build `YYYYMMDD-T01-000001` from parts. `businessDate` is a store-local date. */
export function formatReceiptNumber(
  businessDate: { year: number; month: number; day: number },
  receiptPrefix: string,
  sequence: number,
): string {
  const y = String(businessDate.year).padStart(4, '0');
  const m = String(businessDate.month).padStart(2, '0');
  const d = String(businessDate.day).padStart(2, '0');
  const seq = String(sequence).padStart(6, '0');
  return `${y}${m}${d}-${receiptPrefix}-${seq}`;
}

/** Smallest unused `T\d\d` prefix given the prefixes already taken at an outlet. */
export function nextReceiptPrefix(taken: readonly string[]): string {
  const used = new Set(taken);
  for (let n = 1; n <= 99; n += 1) {
    const candidate = `T${String(n).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('No receipt prefix available for this outlet (max 99 terminals)');
}
