import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { capabilitySchema } from './capabilities.js';
import { roleSchema } from './identity.js';
import { ROLE_CAPABILITIES } from './role-capabilities.js';

const seedSql = readFileSync(
  fileURLToPath(new URL('../../../database/identity/0007_reference_data.sql', import.meta.url)),
  'utf8',
);

/** Extract `('role', 'permission')` tuples from the role_permissions insert. */
function seedGrants(): Map<string, Set<string>> {
  const section = seedSql.slice(seedSql.indexOf('insert into identity.role_permissions'));
  const grants = new Map<string, Set<string>>();
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section))) {
    const [, role, permission] = match as unknown as [string, string, string];
    if (!grants.has(role)) grants.set(role, new Set());
    grants.get(role)!.add(permission);
  }
  return grants;
}

function seedPermissionKeys(): Set<string> {
  const start = seedSql.indexOf('insert into identity.permissions');
  const end = seedSql.indexOf('insert into identity.role_permissions');
  const section = seedSql.slice(start, end);
  const keys = new Set<string>();
  const re = /\(\s*'([a-z0-9_.]+)'\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section))) keys.add(match[1]!);
  return keys;
}

describe('ROLE_CAPABILITIES', () => {
  it('only references capabilities that exist in the contract', () => {
    for (const caps of Object.values(ROLE_CAPABILITIES)) {
      for (const cap of caps) {
        expect(capabilitySchema.safeParse(cap).success).toBe(true);
      }
    }
  });

  it('covers exactly the four roles', () => {
    expect(new Set(Object.keys(ROLE_CAPABILITIES))).toEqual(new Set(roleSchema.options));
  });

  it('matches the database seed grants exactly (drift guard)', () => {
    const seed = seedGrants();
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      expect(seed.get(role) ?? new Set()).toEqual(new Set(caps));
    }
    // No extra roles in the seed.
    expect(new Set(seed.keys())).toEqual(new Set(Object.keys(ROLE_CAPABILITIES)));
  });

  it('seeds every capability as a permission row', () => {
    const seeded = seedPermissionKeys();
    for (const cap of capabilitySchema.options) {
      expect(seeded.has(cap)).toBe(true);
    }
    expect(seeded.size).toBe(capabilitySchema.options.length);
  });
});
