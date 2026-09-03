'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkspaceCard } from '@jksh/contracts';

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'Central Admin',
  accountant: 'Accountant',
  franchise_owner: 'Franchise Owner',
};

export function WorkspacePicker({ cards }: { cards: WorkspaceCard[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(membershipId: string) {
    setBusy(membershipId);
    setError(null);
    try {
      const res = await fetch('/api/v1/me/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId }),
      });
      const body = (await res.json()) as { redirectTo?: string; message?: string };
      if (!res.ok || !body.redirectTo) {
        setError(body.message ?? 'Could not select that workspace.');
        return;
      }
      router.replace(body.redirectTo);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="grid">
        {cards.map((card) => (
          <button
            key={card.membershipId}
            className="card"
            style={{ textAlign: 'left', color: 'inherit', background: 'var(--panel)' }}
            disabled={busy !== null}
            onClick={() => {
              void choose(card.membershipId);
            }}
          >
            <span className="pill">{ROLE_LABEL[card.role] ?? card.role}</span>
            <div style={{ marginTop: 8, fontWeight: 600 }}>
              {card.franchiseName ?? card.organizationName}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {card.brandName ?? card.organizationName}
            </div>
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
