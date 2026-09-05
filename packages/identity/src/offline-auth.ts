import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A signed, stateless offline-billing authorization. Issued while a terminal
 * is online (`billing-data-api-plan.md` Phase 4 ; `offline-billing.md`): a POS
 * may keep selling for up to 24 hours disconnected, then must reconnect
 * before creating new bills. Not an authentication token - PIN login / the
 * operator session cookie still gate who is acting; this bounds *how long*
 * offline selling is allowed, *which employees* it covers, *which* published
 * menu snapshot it vouches for, and the maximum discount an offline bill may
 * apply without live oversight.
 */

const PREFIX = 'jksh_off_v1';
export const OFFLINE_AUTH_HOURS = 24;

export interface DiscountPolicy {
  /** max discount as a percent of a line's base total */
  maxLineDiscountPercent: string;
  /** max discount as a percent of the whole bill's post-line-discount total */
  maxBillDiscountPercent: string;
}

export const DEFAULT_OFFLINE_DISCOUNT_POLICY: DiscountPolicy = {
  maxLineDiscountPercent: '20',
  maxBillDiscountPercent: '20',
};

export interface OfflineAuthBundle {
  organizationId: string;
  outletId: string;
  terminalId: string;
  /** Store Employees permitted to sell offline on this terminal - a device may
   *  hand off between staff during the window without re-contacting the server. */
  employeeIds: string[];
  /** the published menu version this bundle vouches for, plus its immutable
   *  checksum (billing.outlet_menu_versions.checksum) - proves at sync time
   *  that the cached snapshot the device priced offline bills against was the
   *  real, untampered one at issuance. */
  menuVersion: string;
  menuChecksum: string;
  discountPolicy: DiscountPolicy;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
}

function sign(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

function isOfflineAuthBundleShape(value: unknown): value is OfflineAuthBundle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.organizationId !== 'string' ||
    typeof v.outletId !== 'string' ||
    typeof v.terminalId !== 'string' ||
    !Array.isArray(v.employeeIds) ||
    typeof v.menuVersion !== 'string' ||
    typeof v.menuChecksum !== 'string' ||
    typeof v.issuedAt !== 'string' ||
    typeof v.expiresAt !== 'string' ||
    typeof v.discountPolicy !== 'object' ||
    v.discountPolicy === null
  ) {
    return false;
  }
  const policy = v.discountPolicy as Record<string, unknown>;
  return (
    typeof policy.maxLineDiscountPercent === 'string' &&
    typeof policy.maxBillDiscountPercent === 'string'
  );
}

export function mintOfflineAuthBundle(
  secret: string,
  input: {
    organizationId: string;
    outletId: string;
    terminalId: string;
    employeeIds: string[];
    menuVersion: string;
    menuChecksum: string;
    discountPolicy?: DiscountPolicy;
  },
  now = new Date(),
): { token: string; bundle: OfflineAuthBundle } {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + OFFLINE_AUTH_HOURS * 3_600_000).toISOString();
  const bundle: OfflineAuthBundle = {
    organizationId: input.organizationId,
    outletId: input.outletId,
    terminalId: input.terminalId,
    employeeIds: input.employeeIds,
    menuVersion: input.menuVersion,
    menuChecksum: input.menuChecksum,
    discountPolicy: input.discountPolicy ?? DEFAULT_OFFLINE_DISCOUNT_POLICY,
    issuedAt,
    expiresAt,
  };
  const body = Buffer.from(JSON.stringify(bundle)).toString('base64url');
  return { token: `${PREFIX}.${body}.${sign(secret, body)}`, bundle };
}

/** Parses and verifies the signature only - callers must still check
 *  expiry/scope against the bill being created (`assertOfflineAuthCovers`). */
export function parseOfflineAuthBundle(secret: string, token: string): OfflineAuthBundle | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, body, sig] = parts as [string, string, string];
  if (prefix !== PREFIX) return null;
  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!isOfflineAuthBundleShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The offline bill must have been struck by the same terminal, for one of the
 * bundle's permitted employees, against the exact menu snapshot the bundle
 * vouches for, and its claimed occurrence time must fall inside the
 * authorized window - a bundle never legitimizes a bill claimed to have
 * happened before it was issued or more than 24h after.
 */
export function assertOfflineAuthCovers(
  bundle: OfflineAuthBundle,
  claim: {
    outletId: string;
    terminalId: string;
    employeeId: string;
    menuVersion: string;
    menuChecksum: string;
    terminalOccurredAt: string;
  },
): { ok: true } | { ok: false; reason: string } {
  if (bundle.outletId !== claim.outletId || bundle.terminalId !== claim.terminalId) {
    return { ok: false, reason: 'offline authorization does not match this outlet/terminal' };
  }
  if (!bundle.employeeIds.includes(claim.employeeId)) {
    return { ok: false, reason: 'this employee is not covered by the offline authorization' };
  }
  if (bundle.menuVersion !== claim.menuVersion || bundle.menuChecksum !== claim.menuChecksum) {
    return { ok: false, reason: 'offline authorization does not match the priced menu snapshot' };
  }
  const occurred = new Date(claim.terminalOccurredAt).getTime();
  if (
    occurred < new Date(bundle.issuedAt).getTime() ||
    occurred > new Date(bundle.expiresAt).getTime()
  ) {
    return { ok: false, reason: 'offline authorization window has expired' };
  }
  return { ok: true };
}
