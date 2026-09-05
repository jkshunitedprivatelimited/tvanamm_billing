import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reportRangeKindSchema } from '@jksh/contracts';
import { getFinancialReport, type ReportRange } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

const querySchema = z.object({
  kind: reportRangeKindSchema.default('last7'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  franchiseId: z.uuid().optional(),
  outletId: z.uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      kind: url.searchParams.get('kind') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      franchiseId: url.searchParams.get('franchiseId') ?? undefined,
      outletId: url.searchParams.get('outletId') ?? undefined,
    });
    const range: ReportRange = {
      kind: parsed.kind,
      ...(parsed.from ? { from: parsed.from } : {}),
      ...(parsed.to ? { to: parsed.to } : {}),
    };
    return NextResponse.json(
      await getFinancialReport(db(), actor, range, {
        ...(parsed.franchiseId ? { franchiseId: parsed.franchiseId } : {}),
        ...(parsed.outletId ? { outletId: parsed.outletId } : {}),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
