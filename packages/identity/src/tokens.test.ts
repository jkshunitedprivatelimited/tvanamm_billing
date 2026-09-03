import { describe, expect, it } from 'vitest';
import {
  activationCodeMatches,
  hashActivationCode,
  mintSessionToken,
  mintTerminalCredential,
  parseSessionToken,
  parseTerminalCredential,
  sessionNonceMatches,
} from './tokens.js';

const SECRET = 'unit-test-secret-key-at-least-32-characters';

describe('terminal credential', () => {
  it('round-trips and yields a storable hash', () => {
    const terminalId = '00000000-0000-4000-8000-0000000000cc';
    const minted = mintTerminalCredential(SECRET, terminalId);
    const parsed = parseTerminalCredential(SECRET, minted.credential);
    expect(parsed).not.toBeNull();
    expect(parsed?.terminalId).toBe(terminalId);
    expect(parsed?.nonceHash).toBe(minted.credentialHash);
  });

  it('rejects a tampered signature', () => {
    const minted = mintTerminalCredential(SECRET, '00000000-0000-4000-8000-0000000000cc');
    const broken = `${minted.credential.slice(0, -2)}xy`;
    expect(parseTerminalCredential(SECRET, broken)).toBeNull();
  });

  it('rejects a different secret', () => {
    const minted = mintTerminalCredential(SECRET, '00000000-0000-4000-8000-0000000000cc');
    expect(parseTerminalCredential('another-secret-key-32-characters-min', minted.credential)).toBeNull();
  });

  it('rejects a malformed value', () => {
    expect(parseTerminalCredential(SECRET, 'not-a-credential')).toBeNull();
  });
});

describe('session token', () => {
  it('round-trips and matches the stored hash', () => {
    const minted = mintSessionToken('00000000-0000-4000-8000-000000000abc');
    const parsed = parseSessionToken(minted.token);
    expect(parsed?.sessionId).toBe('00000000-0000-4000-8000-000000000abc');
    expect(sessionNonceMatches(parsed!.nonceHash, minted.tokenHash)).toBe(true);
  });

  it('rejects a malformed token', () => {
    expect(parseSessionToken('a.b')).toBeNull();
  });
});

describe('activation code', () => {
  it('matches a case-insensitively entered code', () => {
    const hash = hashActivationCode(SECRET, 'AB12-CD34');
    expect(activationCodeMatches(SECRET, 'ab12-cd34', hash)).toBe(true);
    expect(activationCodeMatches(SECRET, 'ZZ99-YY88', hash)).toBe(false);
  });
});
