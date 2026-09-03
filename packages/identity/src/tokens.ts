import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function sign(secret: string, message: string): string {
  return b64url(createHmac('sha256', secret).update(message).digest());
}
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// --- Terminal credential --------------------------------------------------

const CRED_PREFIX = 'jksh_t_v1';

export interface MintedCredential {
  credential: string;
  publicId: string;
  nonceHash: string;
}

/** `jksh_t_v1.<terminalId>.<publicId>.<nonce>.<sig>`. The server stores
 *  `publicId` + `sha256(nonce)`; `sig` binds it all with the server secret. */
export function mintTerminalCredential(secret: string, terminalId: string): MintedCredential {
  const publicId = b64url(randomBytes(9));
  const nonce = b64url(randomBytes(24));
  const body = `${terminalId}.${publicId}.${nonce}`;
  return {
    credential: `${CRED_PREFIX}.${body}.${sign(secret, body)}`,
    publicId,
    nonceHash: sha256Hex(nonce),
  };
}

export interface ParsedCredential {
  terminalId: string;
  publicId: string;
  nonceHash: string;
}

export function parseTerminalCredential(
  secret: string,
  credential: string,
): ParsedCredential | null {
  const parts = credential.split('.');
  if (parts.length !== 5) return null;
  const [prefix, terminalId, publicId, nonce, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (prefix !== CRED_PREFIX) return null;
  const expected = Buffer.from(sign(secret, `${terminalId}.${publicId}.${nonce}`));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { terminalId, publicId, nonceHash: sha256Hex(nonce) };
}

// --- Operator session cookie token --------------------------------------

const OP_PREFIX = 'jksh_op_v1';

export interface MintedOperatorToken {
  token: string;
  tokenHash: string;
}

export function mintOperatorToken(operatorSessionId: string): MintedOperatorToken {
  const nonce = b64url(randomBytes(32));
  return { token: `${OP_PREFIX}.${operatorSessionId}.${nonce}`, tokenHash: sha256Hex(nonce) };
}

export interface ParsedOperatorToken {
  operatorSessionId: string;
  nonceHash: string;
}

export function parseOperatorToken(token: string): ParsedOperatorToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, operatorSessionId, nonce] = parts as [string, string, string];
  if (prefix !== OP_PREFIX || operatorSessionId.length < 10) return null;
  return { operatorSessionId, nonceHash: sha256Hex(nonce) };
}

export function nonceHashMatches(nonceHash: string, storedHash: string): boolean {
  const a = Buffer.from(nonceHash);
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Activation codes & invitation tokens ------------------------------

export function hashActivationCode(secret: string, code: string): string {
  return b64url(createHmac('sha256', secret).update(`activation:${code.toUpperCase()}`).digest());
}
export function activationCodeMatches(secret: string, code: string, storedHash: string): boolean {
  return nonceHashMatches(hashActivationCode(secret, code), storedHash);
}

export function mintInvitationToken(secret: string): { token: string; tokenHash: string } {
  const raw = b64url(randomBytes(32));
  return { token: raw, tokenHash: hashInvitationToken(secret, raw) };
}
export function hashInvitationToken(secret: string, token: string): string {
  return b64url(createHmac('sha256', secret).update(`invitation:${token}`).digest());
}
