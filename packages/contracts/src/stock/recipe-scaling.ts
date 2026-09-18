const PRECISION = 1_000_000n;
function decimal(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(value))
    throw new Error('Enter a positive quantity with up to 6 decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  const result = BigInt(whole) * PRECISION + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n) throw new Error('Quantity must be greater than zero.');
  return result;
}
function format(value: bigint): string {
  return `${(value / PRECISION).toString()}.${(value % PRECISION).toString().padStart(6, '0')}`;
}
/** Exact integer ratio, rounded once to the database's six-decimal quantity precision. */
export function recipeServingQuantity(
  ingredient: string,
  usableYield: string,
  serving: string,
): string {
  const amount = decimal(ingredient);
  const batch = decimal(usableYield);
  const portion = decimal(serving);
  if (portion > batch) throw new Error('A serving cannot exceed the usable batch yield.');
  const result = (amount * portion + batch / 2n) / batch;
  if (result === 0n) throw new Error('Per-serving quantity is below supported precision.');
  return format(result);
}
export function recipeYieldPreview(usableYield: string, serving: string) {
  const batch = decimal(usableYield);
  const portion = decimal(serving);
  if (portion > batch) throw new Error('A serving cannot exceed the usable batch yield.');
  return { fullServings: (batch / portion).toString(), remainder: format(batch % portion) };
}
