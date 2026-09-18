import { aiPersona } from '@/server/ai-persona';
import { listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
import { redirect } from 'next/navigation';
import { requireAdminActor } from '@/server/auth';
import { askJkshEnabled } from '@/server/gemini';
import { listRecipeDrafts } from '@/server/recipe-drafts';
import { type AiDraft } from '@/server/ai-draft-schema';
import { AiWorkspace } from './workspace';
export default async function AiPage() {
  const actor = await requireAdminActor();
  if (!['central_admin', 'franchise_owner', 'accountant'].includes(actor.role)) redirect('/');
  let drafts: { id: string; draft: AiDraft }[] = [];
  if (actor.role === 'central_admin') drafts = await listRecipeDrafts(actor);
  const persona = aiPersona(actor.role);
  const outlets = await listOutlets(db(), actor);
  return (
    <main>
      <p className="eyebrow">{persona.eyebrow}</p>
      <h1>{persona.title}</h1>
      <p className="page-intro">{persona.intro}</p>
      <AiWorkspace
        role={actor.role}
        outlets={outlets.map((o) => ({ id: o.id, name: o.displayName }))}
        enabled={askJkshEnabled()}
        central={actor.role === 'central_admin'}
        savedDrafts={drafts}
      />
    </main>
  );
}
