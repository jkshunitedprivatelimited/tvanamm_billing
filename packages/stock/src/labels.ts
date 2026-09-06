/**
 * Thermal label payload for warehouse item/batch labels. Rendering is a client
 * concern; this builds the deterministic content and the label_jobs record
 * captures what was printed (`docs/architecture/stock-scanning-labels.md`).
 */

export interface LabelInput {
  itemName: string;
  sku: string;
  batchCode?: string | null;
  expiryDate?: string | null;
  barcodeValue: string;
  paperMm?: 38 | 50 | 58 | 80;
}

export interface LabelPayload {
  lines: string[];
  barcode: { symbology: 'code128'; value: string };
  paperMm: 38 | 50 | 58 | 80;
}

export function buildLabelPayload(input: LabelInput): LabelPayload {
  const lines = [input.itemName, `SKU ${input.sku}`];
  if (input.batchCode) lines.push(`Batch ${input.batchCode}`);
  if (input.expiryDate) lines.push(`Exp ${input.expiryDate}`);
  return {
    lines,
    barcode: { symbology: 'code128', value: input.barcodeValue },
    paperMm: input.paperMm ?? 50,
  };
}
