import { NextResponse } from 'next/server';
import { exportBillsWorkbook, workbookToCsv } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

/**
 * Bill export for retention / accounting. `format=json` returns the full
 * multi-sheet workbook; the default is a flat one-row-per-line CSV download.
 * Every call records a billing.retention_exports row so it can be proven the
 * range was exported.
 */
export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const format = url.searchParams.get('format') ?? 'csv';
    const franchiseId = url.searchParams.get('franchiseId') ?? undefined;
    const outletId = url.searchParams.get('outletId') ?? undefined;
    if (!from || !to) {
      return NextResponse.json(
        { error: 'validation', message: 'from and to are required (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    const book = await exportBillsWorkbook(
      db(),
      actor,
      {
        from,
        to,
        ...(franchiseId ? { franchiseId } : {}),
        ...(outletId ? { outletId } : {}),
      },
      requestMeta(request),
    );

    if (format === 'json') return NextResponse.json(book);

    return new NextResponse(workbookToCsv(book), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="bills-${from}_to_${to}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
