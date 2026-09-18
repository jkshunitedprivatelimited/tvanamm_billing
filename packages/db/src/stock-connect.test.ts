import { describe, expect, it, vi } from 'vitest';
import { connectStockClient } from './stock-connect';

describe('Stock connection DNS retry', () => {
  it('recovers a temporary DNS error before returning the connection', async () => {
    const connect = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }))
      .mockResolvedValue('connected');
    expect(await connectStockClient(connect)).toBe('connected');
    expect(connect).toHaveBeenCalledTimes(2);
  });
  it('stops after three attempts for a persistent missing host', async () => {
    const failure = Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
    const connect = vi.fn<() => Promise<string>>().mockRejectedValue(failure);
    await expect(connectStockClient(connect)).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(3);
  });
  it('does not retry authentication or other connection failures', async () => {
    const failure = Object.assign(new Error('authentication'), { code: '28P01' });
    const connect = vi.fn<() => Promise<string>>().mockRejectedValue(failure);
    await expect(connectStockClient(connect)).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
