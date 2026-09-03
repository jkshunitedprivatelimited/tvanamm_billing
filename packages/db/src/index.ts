export {
  pgPool,
  createPool,
  withTransaction,
  closePool,
  type Pool,
  type PoolClient,
} from './pg.js';
export {
  applyContext,
  withActorContext,
  type DbContext,
} from './context.js';
export {
  createServiceRoleClient,
  createAuthClient,
  createUserScopedClient,
  type SupabaseClient,
} from './supabase.js';
export { seedDevData } from './seed.js';

// The migration runner (which reads the `database/` directory from disk) is
// intentionally NOT re-exported here so it never gets bundled into an app.
// Import it from '@jksh/db/migrate'.
