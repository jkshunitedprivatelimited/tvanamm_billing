import { setTimeout as sleep } from 'node:timers/promises';

/** Retry only DNS failures while acquiring a connection, before any SQL runs.
 * Never replay a transaction or a commit whose outcome may be uncertain. */
export async function connectStockClient<T>(connect: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await connect();
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (attempt >= 2 || (code !== 'ENOTFOUND' && code !== 'EAI_AGAIN')) throw error;
      await sleep(attempt === 0 ? 100 : 250);
    }
  }
}
