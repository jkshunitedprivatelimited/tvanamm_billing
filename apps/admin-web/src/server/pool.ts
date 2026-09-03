import 'server-only';
import { pgPool, type Pool } from '@jksh/db';

/** Pooled connection. Every request opens a `withActorContext` transaction on it,
 *  so `set local role identity_api` + RLS apply. */
export function db(): Pool {
  return pgPool(process.env.DATABASE_URL);
}
