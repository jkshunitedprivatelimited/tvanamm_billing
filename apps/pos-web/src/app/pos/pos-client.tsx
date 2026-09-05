'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PosMenuSnapshot,
  CreateBillCommand,
  DiscountInput,
  ReceiptSnapshot,
} from '@jksh/contracts';
import { ReceiptView } from '../receipt-view';

type MenuItem = PosMenuSnapshot['items'][number];
type MenuAddon = MenuItem['addons'][number];

interface CartAddon {
  addonId: string;
  name: string;
  unitPrice: string;
  quantity: number;
}

interface CartLine {
  clientLineId: string;
  catalogItemId: string;
  name: string;
  unitPrice: string;
  quantity: number;
  addons: CartAddon[];
  note: string | null;
  lineDiscount: DiscountInput | null;
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function lineTotal(line: CartLine): { base: number; discount: number; final: number } {
  const addonsTotal = line.addons.reduce((s, a) => s + Number(a.unitPrice) * a.quantity, 0);
  const base = (Number(line.unitPrice) + addonsTotal) * line.quantity;
  let discount = 0;
  if (line.lineDiscount) {
    discount =
      line.lineDiscount.kind === 'percent'
        ? (base * Number(line.lineDiscount.value)) / 100
        : Number(line.lineDiscount.value);
    discount = Math.min(discount, base);
  }
  return { base, discount, final: base - discount };
}

export function PosClient({
  menu,
  employeeName,
  outletName,
}: {
  menu: PosMenuSnapshot;
  employeeName: string;
  outletName: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [addonItem, setAddonItem] = useState<MenuItem | null>(null);
  const [billDiscount, setBillDiscount] = useState<DiscountInput | null>(null);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [discountLineId, setDiscountLineId] = useState<string | null>(null);
  const [payment, setPayment] = useState<'cash' | 'upi' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [receiptBillId, setReceiptBillId] = useState<string | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');

  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of menu.items) seen.set(it.categoryName, it.categoryOrder);
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }, [menu.items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.items.filter((it) => {
      if (category && it.categoryName !== category) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menu.items, search, category]);

  const totals = useMemo(() => {
    const lines = cart.map(lineTotal);
    const subtotal = lines.reduce((s, l) => s + l.base, 0);
    const lineDiscountTotal = lines.reduce((s, l) => s + l.discount, 0);
    const afterLine = subtotal - lineDiscountTotal;
    let billDiscountAmt = 0;
    if (billDiscount) {
      billDiscountAmt =
        billDiscount.kind === 'percent'
          ? (afterLine * Number(billDiscount.value)) / 100
          : Number(billDiscount.value);
      billDiscountAmt = Math.min(billDiscountAmt, afterLine);
    }
    const preRound = afterLine - billDiscountAmt;
    const rounded = payment === 'cash' ? Math.round(preRound) : preRound;
    return {
      subtotal: money(subtotal),
      discountTotal: money(lineDiscountTotal + billDiscountAmt),
      preRound: money(preRound),
      roundAdjustment: money(rounded - preRound),
      final: money(rounded),
      isComplimentary: preRound <= 0,
    };
  }, [cart, billDiscount, payment]);

  function addLine(item: MenuItem, addons: CartAddon[], note: string | null) {
    const key = `${item.catalogItemId}|${addons
      .map((a) => `${a.addonId}:${String(a.quantity)}`)
      .sort()
      .join(',')}|${note ?? ''}`;
    setCart((prev) => {
      const existing = prev.find(
        (l) =>
          !l.lineDiscount &&
          `${l.catalogItemId}|${l.addons
            .map((a) => `${a.addonId}:${String(a.quantity)}`)
            .sort()
            .join(',')}|${l.note ?? ''}` === key,
      );
      if (existing) {
        return prev.map((l) =>
          l.clientLineId === existing.clientLineId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          clientLineId: crypto.randomUUID(),
          catalogItemId: item.catalogItemId,
          name: item.name,
          unitPrice: item.price,
          quantity: 1,
          addons,
          note,
          lineDiscount: null,
        },
      ];
    });
  }

  function updateQuantity(clientLineId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.clientLineId === clientLineId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(clientLineId: string) {
    setCart((prev) => prev.filter((l) => l.clientLineId !== clientLineId));
  }

  async function checkout() {
    if (cart.length === 0) return;
    if (!totals.isComplimentary && !payment) {
      setError('Choose Cash or UPI before confirming.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cmd: CreateBillCommand = {
        idempotencyKey: crypto.randomUUID() + crypto.randomUUID(),
        menuVersion: menu.version,
        paymentMethod: totals.isComplimentary ? null : payment,
        lines: cart.map((l) => ({
          clientLineId: l.clientLineId,
          catalogItemId: l.catalogItemId,
          quantity: l.quantity,
          addons: l.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
          ...(l.note ? { note: l.note } : {}),
          ...(l.lineDiscount ? { lineDiscount: l.lineDiscount } : {}),
        })),
        ...(billDiscount ? { billDiscount } : {}),
        terminalOccurredAt: new Date().toISOString(),
        ...(showCustomer && (customerName || customerMobile)
          ? {
              customer: {
                ...(customerName ? { name: customerName } : {}),
                ...(customerMobile ? { mobile: customerMobile } : {}),
              },
            }
          : {}),
      };
      const res = await fetch('/api/v1/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd),
      });
      const body = (await res.json()) as { id?: string; message?: string };
      if (!res.ok || !body.id) {
        setError(body.message ?? 'Checkout failed.');
        return;
      }
      const receiptRes = await fetch(`/api/v1/bills/${body.id}/receipt`);
      const receiptBody = (await receiptRes.json()) as ReceiptSnapshot;
      setReceipt(receiptBody);
      setReceiptBillId(body.id);
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    setCart([]);
    setBillDiscount(null);
    setPayment(null);
    setReceipt(null);
    setReceiptBillId(null);
    setCustomerName('');
    setCustomerMobile('');
    setShowCustomer(false);
    router.refresh();
  }

  function printReceipt() {
    let result: 'success' | 'failed' = 'success';
    try {
      window.print();
    } catch {
      result = 'failed';
    }
    if (receiptBillId) {
      void fetch(`/api/v1/bills/${receiptBillId}/print-attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      });
    }
  }

  if (receipt) {
    return (
      <div className="screen no-print-bg">
        <div style={{ width: 380, maxWidth: '100%' }}>
          <ReceiptView receipt={receipt} />
          <div className="no-print" style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={printReceipt}>Print receipt</button>
            <button className="ghost" onClick={newSale}>
              New sale
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="statusbar">
        <span>
          <strong>{outletName}</strong> · Online
        </span>
        <span className="muted">{employeeName}</span>
      </div>
      <div className="pos-layout">
        <div className="menu-pane">
          <div className="search-row">
            <input
              placeholder="Search menu"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="cat-tabs">
            <button
              className={`cat-tab${category === null ? ' active' : ''}`}
              onClick={() => setCategory(null)}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={`cat-tab${category === c ? ' active' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="item-grid">
            {visibleItems.map((item) => (
              <button
                key={item.catalogItemId}
                className="item-card"
                disabled={!item.isAvailable}
                title={item.isAvailable ? undefined : (item.availabilityNote ?? 'Out of stock')}
                onClick={() => {
                  if (item.addons.length > 0) setAddonItem(item);
                  else addLine(item, [], null);
                }}
              >
                <span className="name">{item.name}</span>
                <span className="price">₹{item.price}</span>
                {!item.isAvailable ? <span className="badge">Out of stock</span> : null}
              </button>
            ))}
            {visibleItems.length === 0 ? <p className="muted">No items match.</p> : null}
          </div>
        </div>
        <div className="cart-pane">
          <h1 style={{ fontSize: 15, margin: '0 0 10px' }}>Current sale</h1>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cart.length === 0 ? <p className="muted">Cart is empty.</p> : null}
            {cart.map((line) => {
              const t = lineTotal(line);
              return (
                <div className="cart-line" key={line.clientLineId}>
                  <div style={{ flex: 1 }}>
                    <div>{line.name}</div>
                    {line.addons.map((a) => (
                      <div className="meta" key={a.addonId}>
                        + {a.quantity} x {a.name}
                      </div>
                    ))}
                    {line.note ? <div className="meta">Note: {line.note}</div> : null}
                    {line.lineDiscount ? (
                      <div className="meta">
                        Discount:{' '}
                        {line.lineDiscount.kind === 'percent'
                          ? `${line.lineDiscount.value}%`
                          : `₹${line.lineDiscount.value}`}{' '}
                        ({line.lineDiscount.reason})
                      </div>
                    ) : (
                      <button
                        className="link-btn"
                        onClick={() => setDiscountLineId(line.clientLineId)}
                      >
                        Add discount
                      </button>
                    )}
                    <div className="qty-row">
                      <button onClick={() => updateQuantity(line.clientLineId, -1)}>-</button>
                      <span>{line.quantity}</span>
                      <button onClick={() => updateQuantity(line.clientLineId, 1)}>+</button>
                      <button className="link-btn" onClick={() => removeLine(line.clientLineId)}>
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>₹{money(t.final)}</div>
                </div>
              );
            })}
          </div>

          <button
            className="link-btn"
            style={{ margin: '8px 0' }}
            onClick={() => setShowBillDiscount(true)}
          >
            {billDiscount ? 'Edit bill discount' : 'Add bill discount'}
          </button>
          <button
            className="link-btn"
            style={{ margin: '0 0 8px' }}
            onClick={() => setShowCustomer((v) => !v)}
          >
            {showCustomer ? 'Hide customer details' : 'Add customer details (optional)'}
          </button>
          {showCustomer ? (
            <div style={{ marginBottom: 8 }}>
              <input
                placeholder="Customer name (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <input
                placeholder="Mobile (optional)"
                value={customerMobile}
                onChange={(e) => setCustomerMobile(e.target.value)}
              />
            </div>
          ) : null}

          <div className="totals-row">
            <span>Subtotal</span>
            <span>₹{totals.subtotal}</span>
          </div>
          {totals.discountTotal !== '0.00' ? (
            <div className="totals-row">
              <span>Discount</span>
              <span>-₹{totals.discountTotal}</span>
            </div>
          ) : null}
          {payment === 'cash' && totals.roundAdjustment !== '0.00' ? (
            <div className="totals-row">
              <span>Round-off</span>
              <span>₹{totals.roundAdjustment}</span>
            </div>
          ) : null}
          <div className="totals-row grand">
            <span>Total</span>
            <span>₹{totals.final}</span>
          </div>

          {!totals.isComplimentary ? (
            <div className="pay-row">
              <button
                className={payment === 'cash' ? 'selected' : 'ghost'}
                onClick={() => setPayment('cash')}
              >
                Cash
              </button>
              <button
                className={payment === 'upi' ? 'selected' : 'ghost'}
                onClick={() => setPayment('upi')}
              >
                UPI
              </button>
            </div>
          ) : (
            <p className="ok" style={{ margin: '10px 0' }}>
              Complimentary - no payment required.
            </p>
          )}

          {error ? <p className="error">{error}</p> : null}
          <button disabled={busy || cart.length === 0} onClick={() => void checkout()}>
            {busy ? 'Processing…' : 'Confirm sale'}
          </button>
          <div className="topnav" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <a href="/history">Bill history</a>
            <a href="/close">Close register</a>
          </div>
        </div>
      </div>

      {addonItem ? (
        <AddonModal
          item={addonItem}
          onClose={() => setAddonItem(null)}
          onAdd={(addons, note) => {
            addLine(addonItem, addons, note);
            setAddonItem(null);
          }}
        />
      ) : null}
      {showBillDiscount ? (
        <DiscountModal
          initial={billDiscount}
          onClose={() => setShowBillDiscount(false)}
          onSave={(d) => {
            setBillDiscount(d);
            setShowBillDiscount(false);
          }}
          onClear={() => {
            setBillDiscount(null);
            setShowBillDiscount(false);
          }}
        />
      ) : null}
      {discountLineId ? (
        <DiscountModal
          initial={cart.find((l) => l.clientLineId === discountLineId)?.lineDiscount ?? null}
          onClose={() => setDiscountLineId(null)}
          onSave={(d) => {
            setCart((prev) =>
              prev.map((l) => (l.clientLineId === discountLineId ? { ...l, lineDiscount: d } : l)),
            );
            setDiscountLineId(null);
          }}
          onClear={() => {
            setCart((prev) =>
              prev.map((l) =>
                l.clientLineId === discountLineId ? { ...l, lineDiscount: null } : l,
              ),
            );
            setDiscountLineId(null);
          }}
        />
      ) : null}
    </>
  );
}

function AddonModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (addons: CartAddon[], note: string | null) => void;
}) {
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [note, setNote] = useState('');

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        groupName: string;
        minSelect: number;
        maxSelect: number;
        isRequired: boolean;
        addons: MenuAddon[];
      }
    >();
    for (const a of item.addons) {
      const g = map.get(a.groupId) ?? {
        groupName: a.groupName,
        minSelect: a.minSelect,
        maxSelect: a.maxSelect,
        isRequired: a.isRequired,
        addons: [],
      };
      g.addons.push(a);
      map.set(a.groupId, g);
    }
    return [...map.entries()];
  }, [item.addons]);

  function toggle(addon: MenuAddon, groupId: string, maxSelect: number) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(addon.addonId)) {
        next.delete(addon.addonId);
      } else {
        const inGroup = item.addons.filter((a) => a.groupId === groupId && next.has(a.addonId));
        if (inGroup.length >= maxSelect) return prev;
        next.set(addon.addonId, 1);
      }
      return next;
    });
  }

  const canAdd = groups.every(([, g]) => {
    const picked = g.addons.filter((a) => selected.has(a.addonId)).length;
    const min = g.isRequired ? Math.max(1, g.minSelect) : g.minSelect;
    return picked >= min;
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>{item.name}</h1>
        {groups.map(([groupId, g]) => (
          <div key={groupId} style={{ marginBottom: 14 }}>
            <label>
              {g.groupName}
              {g.isRequired ? ' (required)' : ' (optional)'} - choose {g.minSelect}-{g.maxSelect}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {g.addons.map((a) => (
                <button
                  key={a.addonId}
                  className={`cat-tab${selected.has(a.addonId) ? ' active' : ''}`}
                  disabled={!a.isAvailable}
                  onClick={() => toggle(a, groupId, g.maxSelect)}
                >
                  {a.name} {Number(a.price) > 0 ? `+₹${a.price}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
        <label htmlFor="line-note">Note (optional)</label>
        <input id="line-note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          disabled={!canAdd}
          onClick={() => {
            const addons: CartAddon[] = item.addons
              .filter((a) => selected.has(a.addonId))
              .map((a) => ({ addonId: a.addonId, name: a.name, unitPrice: a.price, quantity: 1 }));
            onAdd(addons, note.trim() || null);
          }}
        >
          Add to cart
        </button>
        <button className="ghost" style={{ marginTop: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DiscountModal({
  initial,
  onClose,
  onSave,
  onClear,
}: {
  initial: DiscountInput | null;
  onClose: () => void;
  onSave: (d: DiscountInput) => void;
  onClear: () => void;
}) {
  const [kind, setKind] = useState<'fixed' | 'percent'>(initial?.kind ?? 'percent');
  const [value, setValue] = useState(initial?.value ?? '');
  const [reason, setReason] = useState(initial?.reason ?? '');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>Discount</h1>
        <div className="pay-row">
          <button
            className={kind === 'percent' ? 'selected' : 'ghost'}
            onClick={() => setKind('percent')}
          >
            Percent
          </button>
          <button
            className={kind === 'fixed' ? 'selected' : 'ghost'}
            onClick={() => setKind('fixed')}
          >
            Fixed ₹
          </button>
        </div>
        <label htmlFor="discount-value">
          {kind === 'percent' ? 'Percent off' : 'Amount off (₹)'}
        </label>
        <input
          id="discount-value"
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <label htmlFor="discount-reason">Reason (required)</label>
        <input id="discount-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button
          disabled={!value || Number(value) <= 0 || !reason.trim()}
          onClick={() => onSave({ kind, value: Number(value).toFixed(2), reason: reason.trim() })}
        >
          Save discount
        </button>
        {initial ? (
          <button className="ghost" style={{ marginTop: 8 }} onClick={onClear}>
            Remove discount
          </button>
        ) : null}
        <button className="ghost" style={{ marginTop: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
