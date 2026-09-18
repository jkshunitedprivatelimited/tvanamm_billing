import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withActorContext, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { acceptInvitation } from './invitations';
import {
  inviteOutletOwner,
  listOutletOnboarding,
  submitOutletOnboarding,
  approveOutletOnboarding,
} from './onboarding';
import { contextForActor } from './db-context';

const org = '01000000-0000-4000-8000-000000000001';
const brandId = '01000000-0000-4000-8000-000000000010';
const suffix = String(Date.now()).slice(-8);
const phones = [`+9171${suffix}`, `+9172${suffix}`, `+9173${suffix}`];
let pool: Pool;
let admin: ActorContext;
const franchiseIds: string[] = [];
async function actor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const resolved = await resolveAdminAfterVerify(pool, { phone, authUserId });
  if (resolved.result.outcome !== 'single_workspace') throw new Error('Expected workspace');
  const result = await buildAdminActor(pool, {
    authUserId,
    membershipId: resolved.result.membershipId,
  });
  if (!result) throw new Error('Expected actor');
  return result;
}
describe.skipIf(!process.env.DATABASE_URL)('Owner outlet onboarding', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);
    const { rows } = await pool.query<{ id: string }>(
      "insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at) values ($1,'Setup admin','active',true,now()) returning id",
      [phones[0]],
    );
    await pool.query(
      "insert into identity.memberships (account_id, role_key, organization_id) values ($1,'central_admin',$2)",
      [rows[0]!.id, org],
    );
    admin = await actor(phones[0]!);
  });
  afterAll(async () => {
    await pool.query('delete from identity.outlet_onboarding where franchise_id=any($1::uuid[])', [
      franchiseIds,
    ]);
    await pool.query('delete from billing.outlets where franchise_id=any($1::uuid[])', [
      franchiseIds,
    ]);
    await pool.query('delete from identity.invitations where mobile=any($1::text[])', [phones]);
    await pool.query(
      'delete from identity.memberships where account_id in (select id from identity.account_profiles where mobile=any($1::text[]))',
      [phones],
    );
    await pool.query('delete from billing.franchises where id=any($1::uuid[])', [franchiseIds]);
    await pool.query('delete from identity.account_profiles where mobile=any($1::text[])', [
      phones,
    ]);
    await pool.end();
  });
  it('supports accepted owners, isolates submissions, and activates exactly one outlet after review', async () => {
    const invite = await inviteOutletOwner(pool, admin, {
      brandId,
      name: 'Setup Test',
      fullName: 'Setup owner',
      phone: phones[1]!,
    });
    franchiseIds.push(invite.franchiseId);
    expect(
      (await listOutletOnboarding(pool, admin)).find((r) => r.franchiseId === invite.franchiseId)
        ?.stage,
    ).toBe('invited');
    await acceptInvitation(pool, invite.token, phones[1]!);
    const owner = await actor(phones[1]!);
    expect((await listOutletOnboarding(pool, owner))[0]?.stage).toBe('details_pending');
    expect((await listOutletOnboarding(pool, owner))[0]?.phone).toBe(phones[1]);
    const details = {
      displayName: 'Setup Test',
      phone: phones[1]!,
      addressLine: '12 Main Road',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500090',
    };
    await expect(
      submitOutletOnboarding(pool, owner, {
        ...details,
        transportChargePaise: 1,
      } as typeof details),
    ).rejects.toThrow();
    await submitOutletOnboarding(pool, owner, details);
    await expect(submitOutletOnboarding(pool, owner, details)).rejects.toThrow(/already awaiting/);
    expect((await listOutletOnboarding(pool, owner))[0]?.stage).toBe('ready_for_review');
    await expect(approveOutletOnboarding(pool, owner, invite.franchiseId, 0)).rejects.toThrow(
      /Denied/,
    );
    await expect(
      withActorContext(pool, contextForActor(owner), (c) =>
        c.query(
          'update identity.outlet_onboarding set reviewed_at=now() where franchise_id=$1 returning franchise_id',
          [invite.franchiseId],
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    const otherInvite = await inviteOutletOwner(pool, admin, {
      brandId,
      name: 'Other Setup',
      fullName: 'Other owner',
      phone: phones[2]!,
    });
    franchiseIds.push(otherInvite.franchiseId);
    await acceptInvitation(pool, otherInvite.token, phones[2]!);
    const other = await actor(phones[2]!);
    expect(
      (await listOutletOnboarding(pool, other)).some((r) => r.franchiseId === invite.franchiseId),
    ).toBe(false);
    const approved = await Promise.all([
      approveOutletOnboarding(pool, admin, invite.franchiseId, 2500),
      approveOutletOnboarding(pool, admin, invite.franchiseId, 2500),
    ]);
    expect(approved[0].id).toBe(approved[1].id);
    const { rows } = await pool.query(
      'select status, billing_enabled, transport_charge_paise, franchise_id from billing.outlets where id=$1',
      [approved[0]!.id],
    );
    expect(rows[0]).toMatchObject({
      status: 'active',
      billing_enabled: true,
      transport_charge_paise: '2500',
      franchise_id: invite.franchiseId,
    });
    expect((await listOutletOnboarding(pool, owner))[0]?.stage).toBe('active');
    await expect(submitOutletOnboarding(pool, owner, details)).rejects.toThrow(/already created/);
  });
  it('rolls back franchise creation when the owner invitation is invalid', async () => {
    const name = `Invalid setup ${suffix}`;
    await expect(
      inviteOutletOwner(pool, admin, { brandId, name, fullName: 'Invalid', phone: phones[0]! }),
    ).rejects.toThrow(/internal/);
    expect(
      (await pool.query('select id from billing.franchises where name=$1', [name])).rowCount,
    ).toBe(0);
  });
});
