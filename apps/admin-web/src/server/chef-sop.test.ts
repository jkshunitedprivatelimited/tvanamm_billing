import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./pool', () => ({ db: () => ({ query: mocks.query, connect: mocks.connect }) }));
import {
  readChefCollection,
  saveChefEntry,
  hashChefToken,
  addChefItem,
  deleteChefItem,
  submitChefCollection,
} from './chef-sop';
import { emptyChefDraft } from './chef-sop-schema';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
it('hashes the capability rather than storing the share token', () => {
  expect(hashChefToken('example')).toHaveLength(64);
  expect(hashChefToken('example')).not.toContain('example');
});
it('rejects an expired or revoked capability', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(readChefCollection({ token: 'invalid' })).rejects.toThrow('expired');
  expect(mocks.query.mock.calls[0]?.[0]).toContain('revoked_at is null and expires_at>now()');
});
it('rejects saves for a closed collection and rolls back', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(
    saveChefEntry('invalid', '00000000-0000-4000-8000-000000000001', 0, emptyChefDraft()),
  ).rejects.toThrow('closed');
  expect(mocks.query).toHaveBeenCalledWith('rollback');
  expect(mocks.release).toHaveBeenCalled();
});
it('rejects a menu item outside the capability scope', async () => {
  mocks.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'collection', menu: [], submitted_at: null }] })
    .mockResolvedValue({ rows: [] });
  await expect(saveChefEntry('token', 'outside', 0, emptyChefDraft())).rejects.toThrow(
    'not in this menu',
  );
});

const item = { id: '00000000-0000-4000-8000-000000000001', name: 'Tea', category: 'Drinks' };
const secondItem = { ...item, id: '00000000-0000-4000-8000-000000000002', name: 'Coffee' };
function openCollection(menu = [item, secondItem]) {
  mocks.query
    .mockResolvedValue({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'collection', menu, submitted_at: null }] });
}

it('adds a new workbook item while retaining the existing menu and saved recipes', async () => {
  openCollection();
  const result = await addChefItem('token', {
    name: '  Mango ice cream  ',
    category: ' Desserts ',
  });
  expect(result.item).toEqual({
    id: expect.any(String),
    name: 'Mango ice cream',
    category: 'Desserts',
  });
  expect(result.item.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(result.menu).toEqual([item, secondItem, result.item]);
  expect(mocks.query).toHaveBeenCalledWith(
    'update billing.sop_collections set menu=$2 where id=$1',
    ['collection', JSON.stringify(result.menu)],
  );
  expect(mocks.query.mock.calls.some(([sql]) => /insert|delete|catalog_items/.test(sql))).toBe(
    false,
  );
  expect(mocks.query).toHaveBeenLastCalledWith('commit');
  expect(mocks.release).toHaveBeenCalled();
});

it('rejects duplicate names in the same category without altering the menu', async () => {
  openCollection([{ ...item, name: 'Masala  Tea' }]);
  await expect(addChefItem('token', { name: 'masala tea', category: 'drinks' })).rejects.toThrow(
    'already exists',
  );
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith('update'))).toBe(false);
  expect(mocks.query).toHaveBeenLastCalledWith('rollback');
});

it.each([
  { name: ' ', category: 'Drinks' },
  { name: 'Tea', category: ' ' },
  { name: 'x'.repeat(161), category: 'Drinks' },
  { name: 'Tea', category: 'x'.repeat(121) },
])('rejects invalid new item details before connecting: %j', async (input) => {
  await expect(addChefItem('token', input)).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it('limits new workbook items while holding the collection lock', async () => {
  openCollection(Array.from({ length: 500 }, (_, index) => ({ ...item, id: String(index) })));
  await expect(addChefItem('token', { name: 'New item', category: 'Other' })).rejects.toThrow(
    '500',
  );
  expect(mocks.query.mock.calls[1]?.[0]).toContain('for update');
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith('update'))).toBe(false);
});

it.each(['add', 'delete'] as const)('rejects %s on an expired or revoked link', async (action) => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(
    action === 'add'
      ? addChefItem('expired', { name: 'New item', category: 'Other' })
      : deleteChefItem('expired', item.id, 0),
  ).rejects.toThrow('closed');
  expect(mocks.query.mock.calls[1]?.[0]).toContain('revoked_at is null and expires_at>now()');
  expect(mocks.query.mock.calls[1]?.[1]).toEqual([hashChefToken('expired')]);
  expect(mocks.query).toHaveBeenLastCalledWith('rollback');
  expect(mocks.release).toHaveBeenCalled();
});

it.each(['add', 'delete'] as const)('rejects %s after submission', async (action) => {
  mocks.query
    .mockResolvedValue({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ id: 'collection', menu: [item], submitted_at: new Date() }],
    });
  await expect(
    action === 'add'
      ? addChefItem('token', { name: 'New item', category: 'Other' })
      : deleteChefItem('token', item.id, 0),
  ).rejects.toThrow('closed');
  expect(mocks.query.mock.calls.some(([sql]) => /^(update|delete)/.test(sql))).toBe(false);
});

it('deletes only the selected workbook item and its confirmed saved revision', async () => {
  openCollection();
  mocks.query.mockResolvedValueOnce({ rows: [{ revision: 4 }] });
  const result = await deleteChefItem('token', item.id, 4);
  expect(result).toEqual({ itemId: item.id, menu: [secondItem] });
  expect(mocks.query.mock.calls[1]?.[0]).toContain('for update');
  expect(mocks.query).toHaveBeenCalledWith(
    'delete from billing.sop_collection_entries where collection_id=$1 and item_id=$2',
    ['collection', item.id],
  );
  expect(mocks.query).toHaveBeenCalledWith(
    'update billing.sop_collections set menu=$2 where id=$1',
    ['collection', JSON.stringify([secondItem])],
  );
  expect(mocks.query).toHaveBeenLastCalledWith('commit');
});

it('allows deleting an item with no saved recipe, including the last item', async () => {
  openCollection([item]);
  await expect(deleteChefItem('token', item.id, 0)).resolves.toEqual({ itemId: item.id, menu: [] });
});

it('does not delete a recipe saved in another tab after the chef loaded it', async () => {
  openCollection();
  mocks.query.mockResolvedValueOnce({ rows: [{ revision: 5 }] });
  await expect(deleteChefItem('token', item.id, 4)).rejects.toThrow('Reload and review');
  expect(mocks.query.mock.calls.some(([sql]) => /^(update|delete)/.test(sql))).toBe(false);
  expect(mocks.query).toHaveBeenLastCalledWith('rollback');
});

it('rejects deleting an item outside the linked workbook', async () => {
  openCollection([secondItem]);
  await expect(deleteChefItem('token', item.id, 0)).rejects.toThrow('not in this workbook');
  expect(mocks.query.mock.calls.some(([sql]) => /^(update|delete)/.test(sql))).toBe(false);
});

it('rolls back recipe deletion when updating the workbook fails', async () => {
  openCollection();
  mocks.query
    .mockResolvedValueOnce({ rows: [{ revision: 1 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(new Error('Update failed'));
  await expect(deleteChefItem('token', item.id, 1)).rejects.toThrow('Update failed');
  expect(mocks.query).toHaveBeenLastCalledWith('rollback');
  expect(mocks.query).not.toHaveBeenCalledWith('commit');
  expect(mocks.release).toHaveBeenCalled();
});

it('does not submit a workbook after every item has been deleted', async () => {
  openCollection([]);
  await expect(submitChefCollection('token')).rejects.toThrow('Add at least one item');
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith('update'))).toBe(false);
  expect(mocks.query).toHaveBeenLastCalledWith('rollback');
});
