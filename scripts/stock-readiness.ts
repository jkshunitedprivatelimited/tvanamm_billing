import { createStockPool, stockSystemContext, withStockActorContext } from '@jksh/db';
const pool = createStockPool();
try {
  const result = await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const flags = await client.query('select key, enabled from stock.feature_flags order by key');
    const counts = await client.query<Record<string, string>>(`select
      (select count(*) from stock.items where is_active) as active_items,
      (select count(*) from stock.supply_catalog_items where is_available) as catalog_items,
      (select count(*) from stock.outlet_stock_settings) as configured_outlets,
      (select count(*) from stock.low_stock_rules where enabled) as alert_limits,
      (select count(*) from stock.warehouses where is_active) as warehouses`);
    return { flags: flags.rows, counts: counts.rows[0] };
  });
  console.info(JSON.stringify(result, null, 2));
  console.info('Payment environment', {
    publicKey: !!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    keyId: !!process.env.RAZORPAY_KEY_ID,
    keySecret: !!process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
  });
} finally {
  await pool.end();
}
