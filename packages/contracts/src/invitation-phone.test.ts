import { describe, expect, it } from 'vitest';
import { invitationPhoneSchema } from './identity';
import { createInvitationCommandSchema } from './session';
import { inviteOutletOwnerSchema } from './onboarding';
describe('Invitation phone entry', () => {
  it.each(['+9190001 45659', '9000145659', '91 90001 45659', '+91 (90001)-45659'])(
    'normalizes %s',
    (phone) => {
      expect(invitationPhoneSchema.parse(phone)).toBe('+919000145659');
      expect(
        createInvitationCommandSchema.parse({
          fullName: 'Owner',
          phone,
          franchiseId: '01000000-0000-4000-8000-000000000010',
        }).phone,
      ).toBe('+919000145659');
      expect(
        inviteOutletOwnerSchema.parse({
          fullName: 'Owner',
          phone,
          name: 'Outlet',
          brandId: '01000000-0000-4000-8000-000000000010',
        }).phone,
      ).toBe('+919000145659');
    },
  );
  it.each(['+91', '90001456', '+9190001456591', 'abc9000145659', '++919000145659'])(
    'rejects malformed %s',
    (phone) => {
      expect(invitationPhoneSchema.safeParse(phone).success).toBe(false);
    },
  );
});
