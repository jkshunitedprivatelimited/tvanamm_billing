import { describe, expect, it } from 'vitest';
import {
  activationCodeMatches,
  hashActivationCode,
  hashInvitationToken,
  mintInvitationToken,
  mintOperatorToken,
  mintTerminalCredential,
  nonceHashMatches,
  parseOperatorToken,
  parseTerminalCredential,
} from './tokens.js';

const SECRET = 'unit-test-secret-key-at-least-32-characters';

describe('terminal credential', () => {
  it('round-trips and yields storable identifiers', () => {
    const terminalId = '00000000-0000-4000-8000-0000000000cc';
    const minted = mintTerminalCredential(SECRET, terminalId);
    const parsed = parseTerminalCredential(SECRET, minted.credential);
    expect(parsed).toMatchObject({ terminalId, publicId: minted.publicId, nonceHash: minted.nonceHash });
  });
  it('rejects a tampered signature and a wrong secret', () => {
    const minted = mintTerminalCredential(SECRET, '00000000-0000-4000-8000-0000000000cc');
    expect(parseTerminalCredential(SECRET, `${minted.credential.slice(0, -2)}xy`)).toBeNull();
    expect(parseTerminalCredential('another-secret-key-32-characters-min', minted.credential)).toBeNull();
  });
});

describe('operator token', () => {
  it('round-trips and matches its stored hash', () => {
    const minted = mintOperatorToken('00000000-0000-4000-8000-000000000abc');
    const parsed = parseOperatorToken(minted.token);
    expect(parsed?.operatorSessionId).toBe('00000000-0000-4000-8000-000000000abc');
    expect(nonceHashMatches(parsed!.nonceHash, minted.tokenHash)).toBe(true);
  });
});

describe('activation & invitation codes', () => {
  it('activation code matches case-insensitively', () => {
    const hash = hashActivationCode(SECRET, 'AB12-CD34');
    expect(activationCodeMatches(SECRET, 'ab12-cd34', hash)).toBe(true);
    expect(activationCodeMatches(SECRET, 'zz99-yy88', hash)).toBe(false);
  });
  it('invitation token round-trips', () => {
    const { token, tokenHash } = mintInvitationToken(SECRET);
    expect(hashInvitationToken(SECRET, token)).toBe(tokenHash);
  });
});
