// Disposable PostgreSQL only. All schema/fixture changes are rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL || '');
assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Local database required');
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  await client.query('begin');
  assert.equal(
    (await client.query("select to_regclass('identity.notifications') existing")).rows[0].existing,
    null,
    'Fresh database required',
  );
  await client.query(
    'create schema identity; create table identity.schema_migrations(id text primary key, checksum text not null, applied_at timestamptz default now())',
  );
  const directory = new URL('../../database/migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((n) => n.endsWith('.sql') && n < '0042')
    .sort())
    await client.query(readFileSync(new URL(name, directory), 'utf8'));
  const org = '01000000-0000-4000-8000-000000000001';
  const brand = '01000000-0000-4000-8000-000000000010';
  const f1 = randomUUID(),
    f2 = randomUUID(),
    o1 = randomUUID(),
    o2 = randomUUID(),
    sibling = randomUUID();
  for (const f of [f1, f2])
    await client.query(
      "insert into billing.franchises(id,organization_id,brand_id,name,slug) values($1,$2,$3,'Test','test-'||($1::uuid)::text)",
      [f, org, brand],
    );
  for (const [o, f] of [
    [o1, f1],
    [o2, f2],
    [sibling, f1],
  ])
    await client.query(
      "insert into billing.outlets(id,organization_id,brand_id,franchise_id,ownership_type,display_name,slug) values($1,$2,$3,$4,'franchise_owned','Test','test-'||($1::uuid)::text)",
      [o, org, brand, f],
    );
  const account = randomUUID();
  await client.query(
    "insert into identity.account_profiles(id,mobile,display_name) values($1,'+919999999991','Test')",
    [account],
  );
  const ids = {};
  for (const [key, f, o, role, recipient] of [
    ['own', f1, o1, 'franchise_owner', null],
    ['foreign', f2, o2, 'franchise_owner', null],
    ['sibling', f1, sibling, 'franchise_owner', null],
    ['outletOnly', null, o2, 'franchise_owner', null],
    ['central', f2, o2, 'central_admin', null],
    ['direct', f1, o1, 'franchise_owner', account],
  ]) {
    ids[key] = randomUUID();
    await client.query(
      "insert into identity.notifications(id,organization_id,franchise_id,outlet_id,recipient_role,recipient_account_id,category,title,dedup_key) values($1,$2,$3,$4,$5,$6,'expenses','Test',($1::uuid)::text)",
      [ids[key], org, f, o, role, recipient],
    );
  }
  async function context(franchise = f1, outlet = '', role = 'franchise_owner') {
    await client.query('reset role');
    await client.query('set local role identity_api');
    for (const [key, value] of Object.entries({
      request: 'admin',
      organization_id: org,
      franchise_id: franchise,
      outlet_id: outlet,
      role,
      account_id: randomUUID(),
    }))
      await client.query('select set_config($1,$2,true)', ['app.' + key, value]);
  }
  await context();
  assert(
    (await client.query('select id from identity.notifications')).rows.some(
      (r) => r.id === ids.foreign,
    ),
    'Reproduce pre-fix cross-owner leak',
  );
  await client.query('reset role');
  await client.query(
    readFileSync(new URL('0042_notification_scope_isolation.sql', directory), 'utf8'),
  );
  await context();
  assert.deepEqual(
    (await client.query('select id from identity.notifications')).rows.map((r) => r.id).sort(),
    [ids.own, ids.sibling].sort(),
  );
  assert.equal(
    (await client.query('select count(*)::int n from identity.notifications where read_at is null'))
      .rows[0].n,
    2,
  );
  for (const column of ['read_at', 'resolved_at'])
    assert.equal(
      (
        await client.query(`update identity.notifications set ${column}=now() where id=$1`, [
          ids.foreign,
        ])
      ).rowCount,
      0,
    );
  assert.equal(
    (await client.query('update identity.notifications set read_at=now() where read_at is null'))
      .rowCount,
    2,
  );
  await context(f2);
  assert.deepEqual(
    (await client.query('select id from identity.notifications where read_at is null')).rows
      .map((r) => r.id)
      .sort(),
    [ids.foreign, ids.outletOnly].sort(),
  );
  await context(f1, o1);
  assert.deepEqual(
    (await client.query('select id from identity.notifications')).rows.map((r) => r.id),
    [ids.own],
  );
  await context('', '', 'central_admin');
  assert.deepEqual(
    (await client.query('select id from identity.notifications')).rows.map((r) => r.id),
    [ids.central],
  );
  await client.query("select set_config('app.organization_id',$1,true)", [randomUUID()]);
  assert.equal(
    (await client.query('select count(*)::int n from identity.notifications')).rows[0].n,
    0,
  );
  await client.query("select set_config('app.request','system',true)");
  assert.equal(
    (await client.query('select count(*)::int n from identity.notifications')).rows[0].n,
    6,
  );
  console.log(
    'PASS: reproduced old leak; separate owners, outlet-only notices, account targeting, unread counts, read/resolve, mark-all, scoped outlets, Central, organization isolation and system access verified.',
  );
} finally {
  await client.query('rollback');
  await client.end();
}
