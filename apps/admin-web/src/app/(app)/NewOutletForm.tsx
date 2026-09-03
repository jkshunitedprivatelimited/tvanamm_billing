'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FranchiseSummary } from '@jksh/contracts';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';

export function NewOutletForm({ franchises }: { franchises: FranchiseSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    ownershipType: 'franchise_owned' as 'franchise_owned' | 'jksh_owned',
    franchiseId: franchises[0]?.id ?? '',
    city: '',
    state: '',
    gstin: '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        brandId: TVANAMM_BRAND,
        ownershipType: form.ownershipType,
        displayName: form.displayName,
        city: form.city,
        state: form.state,
      };
      if (form.ownershipType === 'franchise_owned') body.franchiseId = form.franchiseId;
      if (form.gstin) body.gstin = form.gstin;
      const res = await fetch('/api/v1/outlets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(
          ((await res.json()) as { message?: string }).message ?? 'Could not create the outlet.',
        );
        return;
      }
      setOpen(false);
      setForm({
        displayName: '',
        ownershipType: 'franchise_owned',
        franchiseId: franchises[0]?.id ?? '',
        city: '',
        state: '',
        gstin: '',
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ margin: '12px 0' }}>
        <button onClick={() => setOpen(true)}>New outlet</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New outlet</h2>
      <label htmlFor="dn">Display name</label>
      <input
        id="dn"
        value={form.displayName}
        onChange={(e) => set('displayName', e.target.value)}
        required
      />
      <label htmlFor="ot">Ownership</label>
      <select
        id="ot"
        value={form.ownershipType}
        onChange={(e) => set('ownershipType', e.target.value as typeof form.ownershipType)}
      >
        <option value="franchise_owned">Franchise-owned</option>
        <option value="jksh_owned">JKSH-owned</option>
      </select>
      {form.ownershipType === 'franchise_owned' ? (
        <>
          <label htmlFor="fr">Franchise</label>
          <select
            id="fr"
            value={form.franchiseId}
            onChange={(e) => set('franchiseId', e.target.value)}
            required
          >
            <option value="" disabled>
              Select a franchise
            </option>
            {franchises.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.brandName})
              </option>
            ))}
          </select>
        </>
      ) : null}
      <label htmlFor="city">City</label>
      <input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
      <label htmlFor="state">State</label>
      <input id="state" value={form.state} onChange={(e) => set('state', e.target.value)} />
      <label htmlFor="gstin">GSTIN (optional)</label>
      <input
        id="gstin"
        value={form.gstin}
        onChange={(e) => set('gstin', e.target.value.toUpperCase())}
        maxLength={15}
      />
      <button
        type="submit"
        disabled={
          busy ||
          form.displayName.trim().length < 2 ||
          (form.ownershipType === 'franchise_owned' && !form.franchiseId)
        }
      >
        {busy ? 'Creating…' : 'Create outlet'}
      </button>{' '}
      <button type="button" className="secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
