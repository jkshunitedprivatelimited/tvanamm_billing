import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const CRED_PREFIX = 'jksh_t_v1';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(secret: string, message: string): string {
  return b64url(createHmac('sha256', secret).update(message).digest());
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface MintedCredential {
  /** Give to the device. Bearer token; store only its hash server-side. */
  credential: string;
  /** Persist on identity.terminals.credential_hash. */
  credentialHash: string;
}

/**
 * Terminal credential: `jksh_t_v1.<terminalId>.<nonce>.<sig>`.
 * `sig` binds terminalId + nonce with the server secret so a forged pairing is
 * rejected before any DB lookup. The server stores `sha256(nonce)` and compares.
 */
export function mintTerminalCredential(
  secret: string,
  terminalId: string,
): MintedCredential {
  const nonce = b64url(randomBytes(24));
  const body = `${terminalId}.${nonce}`;
  const credential = `${CRED_PREFIX}.${body}.${sign(secret, body)}`;
  return { credential, credentialHash: sha256Hex(nonce) };
}

export interface ParsedCredential {
  terminalId: string;
  nonceHash: string;
}

/** Verify the signature and shape. Returns identifiers for the DB check, or null. */
export function parseTerminalCredential(
  secret: string,
  credential: string,
): ParsedCredential | null {
  const parts = credential.split('.');
  if (parts.length !== 4) return null;
  const [prefix, terminalId, nonce, sig] = parts as [string, string, string, string];
  if (prefix !== CRED_PREFIX) return null;

  const expected = Buffer.from(sign(secret, `${terminalId}.${nonce}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return { terminalId, nonceHash: sha256Hex(nonce) };
}

// --- Session cookie token -------------------------------------------------

const SID_PREFIX = 'jksh_sid_v1';

export interface MintedSession {
  /** Cookie value: `jksh_sid_v1.<sessionId>.<nonce>`. */
  token: string;
  /** Persist on identity.sessions.refresh_token_hash. */
  tokenHash: string;
}

export function mintSessionToken(sessionId: string): MintedSession {
  const nonce = b64url(randomBytes(32));
  return {
    token: `${SID_PREFIX}.${sessionId}.${nonce}`,
    tokenHash: sha256Hex(nonce),
  };
}

export interface ParsedSession {
  sessionId: string;
  nonceHash: string;
}

export function parseSessionToken(token: string): ParsedSession | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, sessionId, nonce] = parts as [string, string, string];
  if (prefix !== SID_PREFIX || sessionId.length < 10) return null;
  return { sessionId, nonceHash: sha256Hex(nonce) };
}

export function sessionNonceMatches(nonceHash: string, storedHash: string): boolean {
  const a = Buffer.from(nonceHash);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hash a one-time activation code for storage / comparison. */
export function hashActivationCode(secret: string, code: string): string {
  return b64url(
    createHmac('sha256', secret).update(`activation:${code.toUpperCase()}`).digest(),
  );
}

export function activationCodeMatches(
  secret: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(hashActivationCode(secret, code));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
