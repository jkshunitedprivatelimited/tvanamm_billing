import { discardPreparedBatch } from '@jksh/stock';
import { preparedBatchPost } from '../handler';

export async function POST(request: Request) {
  return preparedBatchPost(request, discardPreparedBatch);
}
