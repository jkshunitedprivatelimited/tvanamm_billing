import { z } from 'zod';
import { apiJson, jsonError } from '@/server/http';
import { readChefCollection, saveChefEntry, submitChefCollection } from '@/server/chef-sop';
function token(r: Request) {
  return z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(r.headers.get('authorization')?.replace(/^Bearer /, ''));
}
export async function GET(r: Request) {
  try {
    return apiJson(await readChefCollection({ token: token(r) }));
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(r: Request) {
  try {
    const t = token(r);
    if (Number(r.headers.get('content-length') ?? 0) > 100000)
      return apiJson({ message: 'Recipe is too large' }, { status: 413 });
    const raw = await r.text();
    if (raw.length > 100000) return apiJson({ message: 'Recipe is too large' }, { status: 413 });
    const b = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('save'),
            itemId: z.uuid(),
            revision: z.number().int().min(0),
            draft: z.unknown(),
          })
          .strict(),
        z.object({ action: z.literal('submit') }).strict(),
      ])
      .parse(JSON.parse(raw));
    if (b.action === 'submit') {
      await submitChefCollection(t);
      return apiJson({ ok: true });
    }
    return apiJson(await saveChefEntry(t, b.itemId, b.revision, b.draft));
  } catch (e) {
    return jsonError(e);
  }
}
