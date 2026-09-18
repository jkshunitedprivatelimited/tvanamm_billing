import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { recordVerifiedStaffAttendance } from './attendance';
vi.mock('./audit', () => ({ recordAudit: vi.fn() }));
const actor: ActorContext = {
  kind: 'operator',
  role: 'store_employee',
  employeeId: 'employee',
  outletId: 'outlet',
  terminalId: 'terminal',
  scope: { organizationId: 'org', outletId: 'outlet' },
  sessionActive: true,
  secondsSinceAuth: 0,
};
function client(open: boolean) {
  const query = vi.fn((sql: string) => {
    if (sql.includes('select id from identity.attendance_sessions'))
      return { rowCount: open ? 1 : 0, rows: open ? [{ id: 'original-attendance' }] : [] };
    if (sql.includes('select timezone')) return { rows: [{ timezone: 'Asia/Kolkata' }] };
    if (sql.includes('select se.full_name'))
      return { rows: [{ full_name: 'Aneesh', organization_id: 'org', franchise_id: null }] };
    return { rowCount: 1, rows: [] };
  });
  return { query, db: { query } as unknown as PoolClient };
}
describe('attendance on verified PIN login', () => {
  it('keeps existing attendance unchanged on repeat login', async () => {
    const c = client(true);
    await recordVerifiedStaffAttendance(c.db, actor, 'check-in', {}, true);
    expect(
      c.query.mock.calls.some(([sql]) =>
        /insert into identity.attendance_sessions|update identity.attendance_sessions/.test(sql),
      ),
    ).toBe(false);
  });
  it('records attendance for a first login', async () => {
    const c = client(false);
    await recordVerifiedStaffAttendance(c.db, actor, 'check-in', {}, true);
    expect(
      c.query.mock.calls.filter(([sql]) =>
        sql.includes('insert into identity.attendance_sessions'),
      ),
    ).toHaveLength(1);
  });
  it('still rejects duplicate explicit manual check-ins', async () => {
    const c = client(true);
    await expect(recordVerifiedStaffAttendance(c.db, actor, 'check-in', {})).rejects.toThrow(
      'Already checked in',
    );
  });
});
