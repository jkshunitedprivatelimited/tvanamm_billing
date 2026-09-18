import { z } from 'zod';
import { actorOrThrow, apiJson, jsonError } from '@/server/http';
import {
  createChefCollection,
  listChefCollections,
  closeChefCollection,
  readChefCollection,
} from '@/server/chef-sop';
export async function GET(r: Request) {
  try {
    const actor = await actorOrThrow();
    const id = new URL(r.url).searchParams.get('id');
    return apiJson(
      id
        ? await readChefCollection({ actor, id: z.uuid().parse(id) })
        : await listChefCollections(actor),
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(r: Request) {
  try {
    const a = await actorOrThrow();
    const b = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('create') }).strict(),
        z.object({ action: z.literal('close'), id: z.uuid() }).strict(),
      ])
      .parse(await r.json());
    if (b.action === 'close') {
      await closeChefCollection(a, b.id);
      return apiJson({ ok: true });
    }
    return apiJson(await createChefCollection(a));
  } catch (e) {
    return jsonError(e);
  }
}
