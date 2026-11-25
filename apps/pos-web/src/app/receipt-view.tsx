'use client';

import type { ReceiptSnapshot } from '@jksh/contracts';

/** Renders `receiptSnapshotSchema`'s fields. Optional lines (address, phone,
 *  customer, cashier, notes…) follow the outlet's receipt settings, which the
 *  server has already applied; outlet name and GSTIN always print. Never
 *  discount/refund reasons or a GST rate/CGST/SGST breakout. */
export function ReceiptView({
  receipt,
  paperWidthMm = 80,
}: {
  receipt: ReceiptSnapshot;
  paperWidthMm?: 58 | 80;
}) {
  const layout = receipt.layout ?? {
    showAddress: true,
    showOutletPhone: true,
    showTime: true,
    showPaymentMethod: true,
    showItemNotes: true,
  };
  return (
    <div className={`receipt${paperWidthMm === 58 ? ' w58' : ''}`}>
      <div className="center">
        <strong>{receipt.outletName}</strong>
        {layout.showAddress && receipt.outletAddress ? <div>{receipt.outletAddress}</div> : null}
        {layout.showOutletPhone && receipt.outletPhone ? <div>{receipt.outletPhone}</div> : null}
        {receipt.gstin ? <div>GSTIN: {receipt.gstin}</div> : null}
        {receipt.headerNote ? <div>{receipt.headerNote}</div> : null}
      </div>
      <hr />
      <div className="row">
        <span>{receipt.receiptNumber}</span>
        <span>{receipt.businessDate}</span>
      </div>
      {layout.showTime ? (
        <div className="row">
          <span>{new Date(receipt.committedAt).toLocaleTimeString()}</span>
        </div>
      ) : null}
      {receipt.cashierName ? <div>Cashier: {receipt.cashierName}</div> : null}
      {receipt.customerName ? <div>Customer: {receipt.customerName}</div> : null}
      {receipt.customerMobile ? <div>Phone: {receipt.customerMobile}</div> : null}
      <hr />
      {receipt.lines.map((line, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <div className="row">
            <span className="item-name">
              {line.quantity} x {line.itemName}
            </span>
            <span>₹{line.finalTotal}</span>
          </div>
          {line.addons.map((a, j) => (
            <div className="row" key={j} style={{ paddingLeft: 10 }}>
              <span className="item-name">
                + {a.quantity} x {a.addonName}
              </span>
              {/* `a.quantity` is the full quantity for this line (already
                  scaled by the item's own quantity), so the total - not the
                  per-unit price - belongs on the right, same convention as
                  the item line above. */}
              <span>₹{(Number(a.unitPrice) * a.quantity).toFixed(2)}</span>
            </div>
          ))}
          {line.discount !== '0.00' ? (
            <div className="row" style={{ paddingLeft: 10 }}>
              <span>Discount</span>
              <span>-₹{line.discount}</span>
            </div>
          ) : null}
          {layout.showItemNotes && line.note ? (
            <div style={{ paddingLeft: 10 }}>Note: {line.note}</div>
          ) : null}
        </div>
      ))}
      <hr />
      <div className="row">
        <span>Subtotal</span>
        <span>₹{receipt.subtotal}</span>
      </div>
      {receipt.discountTotal !== '0.00' ? (
        <div className="row">
          <span>Discount</span>
          <span>-₹{receipt.discountTotal}</span>
        </div>
      ) : null}
      {receipt.roundAdjustment !== '0.00' ? (
        <div className="row">
          <span>Round-off</span>
          <span>₹{receipt.roundAdjustment}</span>
        </div>
      ) : null}
      <div className="row" style={{ fontWeight: 700 }}>
        <span>Total</span>
        <span>₹{receipt.finalTotal}</span>
      </div>
      {layout.showPaymentMethod || receipt.isComplimentary ? (
        <div className="row">
          <span>Payment</span>
          <span>{receipt.isComplimentary ? 'Complimentary' : (receipt.paymentMethod ?? '-')}</span>
        </div>
      ) : null}
      {receipt.layout && !receipt.footerNote ? null : (
        <>
          <hr />
          <div className="center">{receipt.footerNote ?? 'Thank you, visit again!'}</div>
        </>
      )}
    </div>
  );
}
