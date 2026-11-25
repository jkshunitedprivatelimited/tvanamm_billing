import { beforeEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./offline-db', () => ({
  kvGet: (k: string) => Promise.resolve(store.get(k)),
  kvSet: (k: string, v: unknown) => {
    store.set(k, structuredClone(v));
    return Promise.resolve();
  },
}));
import {
  dismissStockAction,
  enqueueStockAction,
  flushStockQueue,
  type QueuedStockAction,
} from './stock-queue';

const queued = () => (store.get('stock_action_queue') ?? []) as QueuedStockAction[];
const add = (key: string, employeeId = 'emp-a') =>
  enqueueStockAction({ key, employeeId, path: '/x', body: { id: key }, label: key });
const reply = (status: number, message?: string) =>
  ({ ok: status < 400, status, json: () => Promise.resolve({ message }) }) as Response;

beforeEach(() => {
  store.clear();
});

it('keeps one copy of an entry however often it is queued', async () => {
  await add('a');
  await add('a');
  expect(queued().map((q) => q.key)).toEqual(['a']);
});

it('sends in order and only the signed-in employee’s entries', async () => {
  await add('a');
  await add('b', 'emp-b');
  await add('c');
  const sent: string[] = [];
  const result = await flushStockQueue('emp-a', (a) => {
    sent.push(a.key);
    return Promise.resolve(reply(200));
  });
  expect(sent).toEqual(['a', 'c']);
  expect(result).toEqual({ sent: 2, rejected: 0, remaining: 0 });
  expect(queued().map((q) => q.key)).toEqual(['b']);
});

it('stops at the first network failure and keeps the order', async () => {
  await add('a');
  await add('b');
  const send = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const result = await flushStockQueue('emp-a', send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(result.remaining).toBe(2);
  expect(queued().map((q) => [q.key, q.attempts])).toEqual([
    ['a', 1],
    ['b', 0],
  ]);
});

it('keeps a refused entry with its reason until dismissed, and continues', async () => {
  await add('a');
  await add('b');
  const send = vi
    .fn()
    .mockResolvedValueOnce(reply(400, 'Choose an available stock item'))
    .mockResolvedValueOnce(reply(200));
  const result = await flushStockQueue('emp-a', send);
  expect(result).toEqual({ sent: 1, rejected: 1, remaining: 0 });
  expect(queued()).toMatchObject([{ key: 'a', rejected: 'Choose an available stock item' }]);
  // A refused entry is not resent.
  await flushStockQueue('emp-a', send);
  expect(send).toHaveBeenCalledTimes(2);
  await dismissStockAction('a');
  expect(queued()).toEqual([]);
});

it('treats sign-out and server errors as retry-later', async () => {
  await add('a');
  await add('b');
  const send = vi.fn().mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200));
  const first = await flushStockQueue('emp-a', send);
  expect(first).toEqual({ sent: 0, rejected: 0, remaining: 2 });
  send.mockReset().mockResolvedValue(reply(503));
  expect((await flushStockQueue('emp-a', send)).remaining).toBe(2);
  send.mockReset().mockResolvedValue(reply(200));
  expect(await flushStockQueue('emp-a', send)).toEqual({ sent: 2, rejected: 0, remaining: 0 });
});
