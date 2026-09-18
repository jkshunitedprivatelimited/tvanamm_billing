'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PosMenuSnapshot,
  CreateBillCommand,
  DiscountInput,
  ReceiptSnapshot,
} from '@jksh/contracts';
import Link from 'next/link';
import { ReceiptView } from '../receipt-view';
import { terminalPaperWidthMm } from '../terminal-prefs';
import { smartPrint, smartPrintReceipt } from '@/lib/printer';
import { buildOfflineTicketEscPos } from '@/lib/escpos';
import { BrandMark } from '@/components/BrandMark';
import { PrinterStatus } from '@/components/PrinterStatus';
import { StaffMenu } from '@/components/StaffMenu';
import { SessionControls } from '@/app/session-controls';
import { useOffline } from '@/lib/use-offline';
import {
  enqueueOutboxBill,
  kitUsable,
  readOfflineKit,
  takeReceiptNumber,
} from '@/lib/offline-store';

type MenuItem = PosMenuSnapshot['items'][number];
type MenuAddon = MenuItem['addons'][number];
type MenuCombo = PosMenuSnapshot['combos'][number];

interface CartAddon {
  addonId: string;
  name: string;
  unitPrice: string;
  quantity: number;
}

interface CartLine {
  clientLineId: string;
  catalogItemId: string | null;
  comboId: string | null;
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

/** Pure so a single tap on "Cash"/"UPI" can charge the exact rounded amount
 *  immediately, without waiting on a state update + re-render to see it. */
function computeTotals(
  cart: CartLine[],
  billDiscount: DiscountInput | null,
  payment: 'cash' | 'upi' | null,
) {
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
}

export function PosClient({
  menu,
  employeeId,
  employeeName,
  outletName,
}: {
  menu: PosMenuSnapshot;
  employeeId: string;
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
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [offlineDone, setOfflineDone] = useState<{ receiptNumber: string; total: string } | null>(
    null,
  );
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const [printerNotice, setPrinterNotice] = useState<string | null>(null);
  // Brief highlight on the tapped card so adding an item gives visible
  // feedback beyond the cart total changing off to the side.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  function flash(id: string) {
    setJustAdded(id);
    setTimeout(() => setJustAdded((cur) => (cur === id ? null : cur)), 320);
  }

  // A synced offline bill now has a real receipt; show it if the till is idle,
  // otherwise leave a note (reprint from History).
  const showSyncedReceipt = useCallback(
    (billId: string) => {
      void (async () => {
        try {
          const r = await fetch(`/api/v1/bills/${billId}/receipt`);
          if (!r.ok) return;
          const snap = (await r.json()) as ReceiptSnapshot;
          setReceipt((cur) => {
            if (cur || cart.length > 0 || offlineDone) {
              setQueuedNotice(`A saved bill just synced (receipt ${snap.receiptNumber}).`);
              return cur;
            }
            setReceiptBillId(billId);
            return snap;
          });
        } catch {
          /* it will be retried */
        }
      })();
    },
    [cart.length, offlineDone],
  );
  const offline = useOffline(menu, outletName, employeeId, employeeName, showSyncedReceipt);
  const [showCustomer, setShowCustomer] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');

  const lastMenuRefresh = useRef(Date.now());

  // Pick up published menus while the till is idle. Keep an in-progress
  // sale on its existing menu version until the cashier finishes it.
  useEffect(() => {
    if (cart.length > 0 || busy || receipt || offlineDone) return;
    const refresh = () => {
      if (
        navigator.onLine &&
        document.visibilityState === 'visible' &&
        Date.now() - lastMenuRefresh.current >= 30_000
      ) {
        lastMenuRefresh.current = Date.now();
        router.refresh();
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [router, cart.length, busy, receipt, offlineDone]);

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

  // The summary card always shows the exact (unrounded) total; each payment
  // button shows what that method will actually charge, so cash rounding is
  // visible right on the button a cashier taps — no separate preview step.
  const totals = useMemo(() => computeTotals(cart, billDiscount, null), [cart, billDiscount]);
  const cashTotal = useMemo(
    () => computeTotals(cart, billDiscount, 'cash').final,
    [cart, billDiscount],
  );

  function addLine(item: MenuItem, addons: CartAddon[], note: string | null) {
    const key = `${item.catalogItemId}|${addons
      .map((a) => `${a.addonId}:${String(a.quantity)}`)
      .sort()
      .join(',')}|${note ?? ''}`;
    setCart((prev) => {
      const existing = prev.find(
        (l) =>
          !l.lineDiscount &&
          `${l.catalogItemId ?? ''}|${l.addons
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
          comboId: null,
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

  function addComboLine(combo: MenuCombo) {
    setCart((prev) => [
      ...prev,
      {
        clientLineId: crypto.randomUUID(),
        catalogItemId: null,
        comboId: combo.comboId,
        name: combo.name,
        unitPrice: combo.price,
        quantity: 1,
        addons: [],
        note: null,
        lineDiscount: null,
      },
    ]);
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

  async function checkout(method: 'cash' | 'upi' | null) {
    if (cart.length === 0 || busy) return;
    const t = computeTotals(cart, billDiscount, method);
    if (!t.isComplimentary && !method) {
      setError('Choose Cash or UPI to charge this sale.');
      return;
    }
    setPayment(method);
    setBusy(true);
    setError(null);
    try {
      const cmd: CreateBillCommand = {
        idempotencyKey: crypto.randomUUID() + crypto.randomUUID(),
        menuVersion: menu.version,
        paymentMethod: t.isComplimentary ? null : method,
        lines: cart.flatMap((l): CreateBillCommand['lines'] => {
          if (l.comboId) {
            return [
              {
                clientLineId: l.clientLineId,
                comboId: l.comboId,
                quantity: l.quantity,
                ...(l.note ? { note: l.note } : {}),
              },
            ];
          }
          if (!l.catalogItemId) return [];
          return [
            {
              clientLineId: l.clientLineId,
              catalogItemId: l.catalogItemId,
              quantity: l.quantity,
              addons: l.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
              ...(l.note ? { note: l.note } : {}),
              ...(l.lineDiscount ? { lineDiscount: l.lineDiscount } : {}),
            },
          ];
        }),
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
      const provisionalCommon = {
        total: t.final,
        paymentMethod: cmd.paymentMethod,
        lineCount: cmd.lines.length,
      };

      // Queue a bill that could not be sent right now. `offline` marks a true
      // offline sale (carries its own reserved receipt number + auth bundle);
      // otherwise it's a transient online failure the server will number on sync.
      const queue = async (opts: { offline: boolean; receiptNumber: string | null }) => {
        const finalCmd: CreateBillCommand =
          opts.offline && opts.receiptNumber
            ? { ...cmd, offline: true, terminalReceiptNumber: opts.receiptNumber }
            : cmd;
        await enqueueOutboxBill({
          key: finalCmd.idempotencyKey,
          cmd: finalCmd,
          provisional: { ...provisionalCommon, receiptNumber: opts.receiptNumber },
          queuedAt: new Date().toISOString(),
        });
        void offline.sync();
        if (opts.offline && opts.receiptNumber) {
          setOfflineDone({ receiptNumber: opts.receiptNumber, total: t.final });
        } else {
          setQueuedNotice(
            'No connection — bill saved. It sends automatically and the receipt prints once it does.',
          );
          clearSale();
        }
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const kit = await readOfflineKit();
        if (!kitUsable(kit)) {
          setError(
            'Offline, and this terminal is not armed for offline sales yet. Reconnect once so it can load the menu and receipt numbers.',
          );
          return;
        }
        const rn = await takeReceiptNumber();
        if (!rn || !kit) {
          setError('Offline receipt numbers are exhausted. Reconnect to reserve more.');
          return;
        }
        cmd.offlineAuthBundle = kit.authToken;
        // Which employee actually rang this up, so a later sync (possibly by
        // someone else on this shared terminal) can never relabel the sale.
        cmd.offlineEmployeeId = employeeId;
        await queue({ offline: true, receiptNumber: rn });
        return;
      }

      let res: Response;
      try {
        res = await fetch('/api/v1/bills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cmd),
        });
      } catch {
        // fetch rejects only on a network failure — hold the bill and retry.
        await queue({ offline: false, receiptNumber: null });
        return;
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        await queue({ offline: false, receiptNumber: null });
        return;
      }
      const body = (await res.json()) as { id?: string; message?: string };
      if (!res.ok || !body.id) {
        setError(body.message ?? 'Checkout failed.');
        return;
      }
      try {
        const receiptRes = await fetch(`/api/v1/bills/${body.id}/receipt`);
        if (!receiptRes.ok) throw new Error('Receipt unavailable');
        const receiptBody = (await receiptRes.json()) as ReceiptSnapshot;
        setReceipt(receiptBody);
        setReceiptBillId(body.id);
      } catch {
        newSale();
        setQueuedNotice(
          'Sale saved, but the receipt could not load. Open Bill history to print it. Do not bill the customer again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /** Reset the till for the next customer without leaving the sale screen. */
  const clearSale = useCallback(() => {
    setCart([]);
    setBillDiscount(null);
    setPayment(null);
    setCustomerName('');
    setCustomerMobile('');
    setShowCustomer(false);
  }, []);

  const newSale = useCallback(() => {
    clearSale();
    setReceipt(null);
    setReceiptBillId(null);
    setQueuedNotice(null);
    setOfflineDone(null);
    setPrinterNotice(null);
    if (navigator.onLine) router.refresh();
  }, [clearSale, router]);

  const printOfflineTicket = useCallback(
    async (done: { receiptNumber: string; total: string }) => {
      if (printingRef.current) return;
      printingRef.current = true;
      setPrinting(true);
      setPrinterNotice(null);
      try {
        const outcome = await smartPrint(
          buildOfflineTicketEscPos(done.receiptNumber, done.total, terminalPaperWidthMm()),
        );
        if (!outcome.ok) setPrinterNotice(outcome.error ?? 'Could not print. Your sale is saved.');
        else {
          newSale();
          setQueuedNotice(`Sale ${done.receiptNumber} saved offline. Ready for the next customer.`);
        }
      } catch {
        setPrinterNotice('Could not print. Your sale is saved. Reconnect the printer and retry.');
      } finally {
        printingRef.current = false;
        setPrinting(false);
      }
    },
    [newSale],
  );

  const printReceipt = useCallback(async () => {
    if (!receipt || printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setPrinterNotice(null);
    try {
      const outcome = await smartPrintReceipt(receipt, terminalPaperWidthMm());
      if (receiptBillId) {
        void fetch(`/api/v1/bills/${receiptBillId}/print-attempts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: outcome.ok ? 'success' : 'failed' }),
        }).catch(() => undefined);
      }
      if (!outcome.ok) setPrinterNotice(outcome.error ?? 'Could not print. Your sale is saved.');
      else {
        newSale();
        setQueuedNotice(`Sale ${receipt.receiptNumber} saved. Ready for the next customer.`);
      }
    } catch {
      setPrinterNotice('Could not print. Your sale is saved. Reconnect the printer and retry.');
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }, [receipt, receiptBillId, newSale]);

  // Print fires the moment a receipt is ready — a rush-hour till shouldn't
  // need a tap just to print what it already has. Guarded by the bill/receipt
  // id so it can't re-fire on an unrelated re-render.
  const printedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = receiptBillId ?? (offlineDone ? offlineDone.receiptNumber : null);
    if (!key || printedRef.current === key) return;
    printedRef.current = key;
    if (receipt) void printReceipt();
    else if (offlineDone) void printOfflineTicket(offlineDone);
  }, [receipt, offlineDone, receiptBillId, printReceipt]);

  if (receipt) {
    return (
      <div className="screen no-print-bg">
        <div style={{ width: 380, maxWidth: '100%' }}>
          <ReceiptView receipt={receipt} paperWidthMm={terminalPaperWidthMm()} />
          <div className="no-print print-recovery">
            {printerNotice ? (
              <>
                <h2>Sale saved · printing needs attention</h2>
                <div className="billing-actions">
                  <button disabled={printing} onClick={() => void printReceipt()}>
                    Retry print
                  </button>
                  <button className="ghost" disabled={printing} onClick={newSale}>
                    Continue billing
                  </button>
                </div>
                <p className="muted">You can print this saved bill later from Bill history.</p>
              </>
            ) : (
              <p role="status">{printing ? 'Sending receipt to printer…' : 'Preparing receipt…'}</p>
            )}
          </div>
          <PrinterStatus />
          {printerNotice ? (
            <p className="error no-print" style={{ marginTop: 10 }}>
              {printerNotice}
              <button className="ghost" onClick={() => window.print()}>
                Use system print dialog
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (offlineDone) {
    return (
      <div className="screen">
        <div className="panel" style={{ textAlign: 'center' }}>
          <div className="brand" style={{ justifyContent: 'center' }}>
            <BrandMark />
            <span>
              T&nbsp;VANAMM <small>· Offline sale</small>
            </span>
          </div>
          <p className="chip offline" style={{ display: 'inline-block' }}>
            Saved offline — will sync
          </p>
          <h1 style={{ margin: '12px 0 4px' }}>₹{offlineDone.total}</h1>
          <p className="muted">Receipt {offlineDone.receiptNumber}</p>
          <p className="muted" style={{ fontSize: 13 }}>
            The bill is stored on this terminal and sends automatically when the connection returns.
            Check <strong>Recovery</strong> for its status.
          </p>
          {printerNotice ? (
            <div className="billing-actions">
              <button disabled={printing} onClick={() => void printOfflineTicket(offlineDone)}>
                Retry print
              </button>
              <button className="ghost" disabled={printing} onClick={newSale}>
                Continue billing
              </button>
            </div>
          ) : (
            <p role="status">Sending receipt to printer…</p>
          )}
          <PrinterStatus />
          {printerNotice ? (
            <p className="error" style={{ marginTop: 10 }}>
              {printerNotice}
              <button className="ghost" onClick={() => window.print()}>
                Use system print dialog
              </button>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="statusbar">
        <span>
          <strong>{outletName}</strong>{' '}
          <span className={`chip ${offline.online ? 'online' : 'offline'}`}>
            {offline.online ? 'Online' : 'Offline'}
          </span>
          {!offline.online && offline.ready ? (
            <span className="chip" style={{ marginLeft: 6 }}>
              {offline.receiptsLeft} receipts left
            </span>
          ) : null}
          {offline.priming ? (
            <span className="chip" style={{ marginLeft: 6 }}>
              arming…
            </span>
          ) : offline.online && !offline.ready ? (
            <span className="chip" style={{ marginLeft: 6, color: 'var(--warning)' }}>
              offline not armed
            </span>
          ) : null}
          {offline.pending > 0 ? (
            <span className="chip offline" style={{ marginLeft: 6 }}>
              {offline.pending} to sync
            </span>
          ) : null}
          {offline.failed > 0 ? (
            <span className="chip" style={{ marginLeft: 6, color: 'var(--danger)' }}>
              {offline.failed} failed
            </span>
          ) : null}
        </span>
        <span className="row" style={{ gap: 10 }}>
          {offline.pending > 0 || offline.failed > 0 ? (
            <Link href="/pos/recovery" className="link-btn">
              Recovery
            </Link>
          ) : null}
          <span className="topnav billing-actions">
            <Link href="/stock">Stock & expenses</Link>
            <Link href="/history">Bill history</Link>
            <Link href="/pos/printer">Printer</Link>
            <Link href="/close" className="danger">
              Finish shift
            </Link>
          </span>
          <SessionControls />
          <span className="muted">{employeeName}</span>
        </span>
      </div>
      <div className="pos-utility-bar no-print">
        <PrinterStatus />
        <StaffMenu />
      </div>
      {queuedNotice ? (
        <p className="ok" style={{ margin: '8px 16px 0' }}>
          {queuedNotice}
        </p>
      ) : null}
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
                className={`item-card${justAdded === item.catalogItemId ? ' flash' : ''}`}
                disabled={!item.isAvailable}
                title={item.isAvailable ? undefined : (item.availabilityNote ?? 'Out of stock')}
                onClick={() => {
                  if (item.addons.length > 0) setAddonItem(item);
                  else {
                    addLine(item, [], null);
                    flash(item.catalogItemId);
                  }
                }}
              >
                <span className="name">{item.name}</span>
                <span className="price">₹{item.price}</span>
                {!item.isAvailable ? <span className="badge">Out of stock</span> : null}
              </button>
            ))}
            {visibleItems.length === 0 ? <p className="muted">No items match.</p> : null}
          </div>
          {menu.combos.length > 0 && !category && !search ? (
            <>
              <h2 style={{ fontSize: 14, margin: '16px 0 10px' }}>Combos</h2>
              <div className="item-grid">
                {menu.combos.map((combo) => (
                  <button
                    key={combo.comboId}
                    className={`item-card${justAdded === combo.comboId ? ' flash' : ''}`}
                    disabled={!combo.isAvailable}
                    title={
                      combo.isAvailable
                        ? combo.components
                            .map((c) => `${String(c.quantity)} x ${c.name}`)
                            .join(', ')
                        : (combo.availabilityNote ?? 'Out of stock')
                    }
                    onClick={() => {
                      addComboLine(combo);
                      flash(combo.comboId);
                    }}
                  >
                    <span className="name">{combo.name}</span>
                    <span className="price">₹{combo.price}</span>
                    {!combo.isAvailable ? <span className="badge">Out of stock</span> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="cart-pane">
          <div className="cart-header">
            <h1>Current sale</h1>
            {cart.length > 0 ? (
              <span className="cart-count">
                {cart.reduce((s, l) => s + l.quantity, 0)} item
                {cart.reduce((s, l) => s + l.quantity, 0) === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cart.length === 0 ? (
              <div className="cart-empty">
                <span className="icon">₹</span>
                <p className="muted" style={{ margin: 0, fontWeight: 600 }}>
                  Cart is empty
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  Tap a menu item to add it
                </p>
              </div>
            ) : null}
            {cart.map((line) => {
              const t = lineTotal(line);
              return (
                <div className="cart-line" key={line.clientLineId}>
                  <div style={{ flex: 1 }}>
                    <div className="item-name">{line.name}</div>
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
                    ) : line.comboId ? null : (
                      <button
                        className="link-btn"
                        onClick={() => setDiscountLineId(line.clientLineId)}
                      >
                        Add discount
                      </button>
                    )}
                    <div className="qty-row">
                      <div className="qty-pill">
                        <button onClick={() => updateQuantity(line.clientLineId, -1)}>−</button>
                        <span>{line.quantity}</span>
                        <button onClick={() => updateQuantity(line.clientLineId, 1)}>+</button>
                      </div>
                      <button
                        className="remove-btn"
                        title="Remove"
                        onClick={() => removeLine(line.clientLineId)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    ₹{money(t.final)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ gap: 14, margin: '10px 0 2px' }}>
            <button
              className="link-btn"
              disabled={cart.length === 0}
              onClick={() => setShowBillDiscount(true)}
            >
              {billDiscount ? 'Edit bill discount' : 'Add bill discount'}
            </button>
            <button className="link-btn" onClick={() => setShowCustomer((v) => !v)}>
              {showCustomer ? 'Hide customer details' : '+ Customer details'}
            </button>
          </div>
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

          <div className="totals-card">
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
            <div className="totals-row grand">
              <span>Total</span>
              <span>₹{totals.final}</span>
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}

          {/* Cash / UPI charges the sale on one tap — no separate "confirm"
              step. Each button shows exactly what it will charge (cash is
              rounded to the nearest rupee), so nothing is hidden by the
              shortcut. */}
          {cart.length === 0 || !totals.isComplimentary ? (
            <div className="pay-row">
              <button
                className="charge-btn cash"
                disabled={busy || cart.length === 0}
                onClick={() => void checkout('cash')}
              >
                {busy && payment === 'cash' ? 'Charging…' : `Cash · ₹${cashTotal}`}
              </button>
              <button
                className="charge-btn upi"
                disabled={busy || cart.length === 0}
                onClick={() => void checkout('upi')}
              >
                {busy && payment === 'upi' ? 'Charging…' : `UPI · ₹${totals.final}`}
              </button>
            </div>
          ) : (
            <>
              <p className="ok" style={{ margin: '10px 0' }}>
                Complimentary - no payment required.
              </p>
              <button
                className="confirm-btn"
                disabled={busy || cart.length === 0}
                onClick={() => void checkout(null)}
              >
                {busy ? 'Processing…' : 'Confirm sale'}
              </button>
            </>
          )}
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
