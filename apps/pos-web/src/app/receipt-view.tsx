'use client';

import type { ReceiptSnapshot } from '@jksh/contracts';

/** Renders exactly `receiptSnapshotSchema`'s fields - never employee name,
 *  discount/refund reasons, or a GST rate/CGST/SGST breakout
 *  (`receipt-printing.md` "Confirmed Customer Receipt Content"). */
export function ReceiptView({ receipt }: { receipt: ReceiptSnapshot }) {
  return (
    <div className="receipt">
      <div className="center">
        <strong>{receipt.outletName}</strong>
        <div>{receipt.outletAddress}</div>
        {receipt.outletPhone ? <div>{receipt.outletPhone}</div> : null}
        {receipt.gstin ? <div>GSTIN: {receipt.gstin}</div> : null}
      </div>
      <hr />
      <div className="row">
        <span>{receipt.receiptNumber}</span>
        <span>{receipt.businessDate}</span>
      </div>
      <div className="row">
        <span>{new Date(receipt.committedAt).toLocaleTimeString()}</span>
      </div>
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
              <span>₹{a.unitPrice}</span>
            </div>
          ))}
          {line.discount !== '0.00' ? (
            <div className="row" style={{ paddingLeft: 10 }}>
              <span>Discount</span>
              <span>-₹{line.discount}</span>
            </div>
          ) : null}
          {line.note ? <div style={{ paddingLeft: 10 }}>Note: {line.note}</div> : null}
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
      <div className="row">
        <span>Payment</span>
        <span>{receipt.isComplimentary ? 'Complimentary' : (receipt.paymentMethod ?? '-')}</span>
      </div>
      <hr />
      <div className="center">Thank you, visit again!</div>
    </div>
  );
}
