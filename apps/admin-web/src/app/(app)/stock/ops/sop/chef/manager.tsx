'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChefWorkspace } from '@/app/chef-sop/workspace';
interface Collection {
  id: string;
  title: string;
  total: number;
  saved: number;
  ready: number;
  revoked_at: string | null;
  submitted_at: string | null;
  expires_at: string;
}
export function ChefManager() {
  const [rows, setRows] = useState<Collection[]>([]);
  const [link, setLink] = useState('');
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    const r = await fetch('/api/v1/sop-collection');
    if (!r.ok) throw Error('Could not load collections');
    setRows((await r.json()) as Collection[]);
  }
  useEffect(() => {
    void load().catch((e: unknown) => setMessage((e as Error).message));
  }, []);
  async function act(action: 'create' | 'close', id?: string) {
    if (
      action === 'close' &&
      !confirm('Close this chef link? Saved recipes will stay available here.')
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/v1/sop-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(id ? { id } : {}) }),
      });
      const b = (await r.json()) as { message?: string; token?: string; itemCount?: number };
      if (!r.ok) throw Error(b.message ?? 'Request failed');
      if (action === 'create') {
        setLink(`${window.location.origin}/chef-sop#${String(b.token)}`);
        setMessage(
          `Created workbook for ${String(b.itemCount)} menu items. Copy this link now; it is shown only once.`,
        );
      } else {
        setLink('');
        setMessage('Link closed. Saved recipes have been kept.');
      }
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <Link href="/stock/ops/sop">← SOP standards</Link>
      <h1>Chef recipe collection</h1>
      <p>
        Share the complete menu with your chef. Review saved measurements here, then close the link
        when finished. Nothing is published to billing automatically.
      </p>
      <button disabled={busy} onClick={() => void act('create')}>
        Create chef link · valid 30 days
      </button>
      {message ? <p role="status">{message}</p> : null}
      {link ? (
        <div className="card">
          <label>
            Private chef link
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setMessage('Link copied.'))
                .catch(() => setMessage('Select and copy the link above.'))
            }
          >
            Copy link
          </button>
          <p>Anyone with this link can enter recipe details. Share it only with your chef.</p>
        </div>
      ) : null}
      {rows.map((c) => (
        <section className="card" key={c.id}>
          <h2>{c.title}</h2>
          <p>
            {c.ready} / {c.total} ready · {c.saved} saved ·{' '}
            {c.revoked_at
              ? 'Link closed'
              : c.submitted_at
                ? 'Submitted'
                : new Date(c.expires_at) < new Date()
                  ? 'Expired'
                  : 'Open'}
          </p>
          <div className="row" style={{ gap: 12 }}>
            <button className="secondary" onClick={() => setReview(c.id)}>
              Review saved recipes
            </button>
            <button
              className="secondary"
              onClick={() =>
                void fetch(`/api/v1/sop-collection?id=${c.id}`)
                  .then(async (r) => {
                    if (!r.ok) throw Error('Could not export');
                    const blob = new Blob([JSON.stringify(await r.json(), null, 2)], {
                      type: 'application/json',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'tvanamm-chef-sops.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => setMessage('Could not export recipes.'))
              }
            >
              Download saved recipes
            </button>
            {!c.revoked_at ? (
              <button disabled={busy} className="secondary" onClick={() => void act('close', c.id)}>
                Close link
              </button>
            ) : null}
          </div>
        </section>
      ))}
      {review ? <ChefWorkspace key={review} reviewId={review} /> : null}
    </main>
  );
}
