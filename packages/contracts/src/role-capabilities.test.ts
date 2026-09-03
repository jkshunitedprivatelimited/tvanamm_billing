import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { capabilitySchema } from './capabilities';
import { membershipRoleSchema } from './identity';
import { ROLE_CAPABILITIES } from './role-capabilities';

const migrationsDir = fileURLToPath(new URL('../../../database/migrations', import.meta.url));
const seedSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(`${migrationsDir}/${f}`, 'utf8'))
  .join('\n');

function extract(marker: string): string {
  // Concatenate every VALUES block that follows an `insert into <marker>`.
  const out: string[] = [];
  const re = new RegExp(`insert into ${marker}[\\s\\S]*?values([\\s\\S]*?);`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(seedSql))) out.push(m[1]!);
  return out.join('\n');
}

function seedGrants(): Map<string, Set<string>> {
  const grants = new Map<string, Set<string>>();
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g;
  const section = extract('identity\\.role_capabilities');
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    const [, role, capability] = m as unknown as [string, string, string];
    if (!grants.has(role)) grants.set(role, new Set());
    grants.get(role)!.add(capability);
  }
  return grants;
}

function seedCapabilityKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /\(\s*'([a-z0-9_.]+)'\s*,/g;
  const section = extract('identity\\.capabilities');
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) keys.add(m[1]!);
  return keys;
}

describe('ROLE_CAPABILITIES', () => {
  it('only references capabilities that exist in the contract', () => {
    for (const caps of Object.values(ROLE_CAPABILITIES)) {
      for (const cap of caps) expect(capabilitySchema.safeParse(cap).success).toBe(true);
    }
  });

  it('matches the migration seed grants for the three membership roles', () => {
    const seed = seedGrants();
    for (const role of membershipRoleSchema.options) {
      expect(seed.get(role) ?? new Set()).toEqual(new Set(ROLE_CAPABILITIES[role]));
    }
    expect(new Set(seed.keys())).toEqual(new Set(membershipRoleSchema.options));
  });

  it('seeds every contract capability as a capability row', () => {
    const seeded = seedCapabilityKeys();
    for (const cap of capabilitySchema.options) expect(seeded.has(cap)).toBe(true);
    expect(seeded.size).toBe(capabilitySchema.options.length);
  });
});
