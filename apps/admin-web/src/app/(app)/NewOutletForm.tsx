'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FranchiseSummary } from '@jksh/contracts';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';

const EMPTY = {
  displayName: '',
  ownershipType: 'franchise_owned' as 'franchise_owned' | 'jksh_owned',
  franchiseId: '',
  phone: '',
  gstin: '',
  addressLine: '',
  city: '',
  state: '',
  postalCode: '',
  nearestBusStop: '',
  transportCharge: '',
};

export function NewOutletForm({ franchises }: { franchises: FranchiseSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, franchiseId: franchises[0]?.id ?? '' });

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
        displayName: form.displayName.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        transportChargePaise: Math.round(Number(form.transportCharge || '0') * 100),
      };
      if (form.ownershipType === 'franchise_owned') body.franchiseId = form.franchiseId;
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.gstin.trim()) body.gstin = form.gstin.trim();
      if (form.nearestBusStop.trim()) body.nearestBusStop = form.nearestBusStop.trim();

      const res = await fetch('/api/v1/outlets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(
          ((await res.json()) as { message?: string }).message ?? 'Could not create the branch.',
        );
        return;
      }
      setOpen(false);
      setForm({ ...EMPTY, franchiseId: franchises[0]?.id ?? '' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ margin: '12px 0' }}>
        <button onClick={() => setOpen(true)}>Add branch</button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Add branch</h2>

      <div className="section-label" style={{ marginTop: 0 }}>
        Branch
      </div>
      <div className="toolbar">
        <label className="grow">
          Branch name
          <input
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder="e.g. TVANAMM Madhapur"
            required
          />
        </label>
        <label>
          Ownership
          <select
            value={form.ownershipType}
            onChange={(e) => set('ownershipType', e.target.value as typeof form.ownershipType)}
          >
            <option value="franchise_owned">Franchise-owned</option>
            <option value="jksh_owned">JKSH-owned</option>
          </select>
        </label>
        {form.ownershipType === 'franchise_owned' ? (
          <label>
            Franchise
            <select
              value={form.franchiseId}
              onChange={(e) => set('franchiseId', e.target.value)}
              required
            >
              <option value="" disabled>
                Select
              </option>
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+91…"
          />
        </label>
        <label>
          GSTIN (optional)
          <input
            value={form.gstin}
            onChange={(e) => set('gstin', e.target.value.toUpperCase())}
            maxLength={15}
          />
        </label>
      </div>

      <div className="section-label">Location</div>
      <label>
        Street address
        <input
          value={form.addressLine}
          onChange={(e) => set('addressLine', e.target.value)}
          placeholder="Door no, street, area"
        />
      </label>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <label className="grow">
          City
          <input value={form.city} onChange={(e) => set('city', e.target.value)} />
        </label>
        <label className="grow">
          State
          <input value={form.state} onChange={(e) => set('state', e.target.value)} />
        </label>
        <label style={{ width: 120 }}>
          Pincode
          <input
            value={form.postalCode}
            onChange={(e) => set('postalCode', e.target.value)}
            inputMode="numeric"
            maxLength={6}
          />
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <label className="grow">
          Nearest bus stop
          <input
            value={form.nearestBusStop}
            onChange={(e) => set('nearestBusStop', e.target.value)}
            placeholder="e.g. Jubilee Hills Checkpost"
          />
        </label>
        <label style={{ width: 160 }}>
          Transport charge ₹
          <input
            value={form.transportCharge}
            onChange={(e) => set('transportCharge', e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        </label>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 10 }}>
        <button
          type="submit"
          disabled={
            busy ||
            form.displayName.trim().length < 2 ||
            (form.ownershipType === 'franchise_owned' && !form.franchiseId)
          }
        >
          {busy ? 'Creating…' : 'Create branch'}
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
