import type { QueryResult, QueryResultRow } from 'pg';
import { StockError } from './errors';

/** First row of a result that is expected to have exactly one (e.g. RETURNING). */
export function requireRow<T extends QueryResultRow>(result: QueryResult<T>, what = 'row'): T {
  const row = result.rows[0];
  if (!row) throw new StockError('conflict', `Expected a ${what} but the query returned none`);
  return row;
}
