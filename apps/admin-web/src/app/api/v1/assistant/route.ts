import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFinancialReport, getRetentionStatus } from '@jksh/identity';
import { listOutlets } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';
import { askGemini, askJkshEnabled } from '@/server/gemini';

const schema = z.object({ question: z.string().trim().min(2).max(1000) });

const SYSTEM = `You are "Ask JKSH", a read-only assistant inside the JKSH billing platform for the TVANAMM tea brand.
Rules:
- Answer ONLY from the DATA block below. Never invent numbers, names or dates.
- Every factual answer must state the outlet/date scope it used and that the data is a live snapshot.
- If the DATA block does not contain what is needed, say so plainly and suggest which report or page would have it. Do not guess.
- You cannot make changes. If asked to, explain which screen the user would use.
- Flag unusual patterns as "worth reviewing", never as accusations.
- Be concise. Use short sentences or a compact list. Amounts are Indian rupees.`;

export async function POST(request: Request) {
  try {
    if (!askJkshEnabled()) {
      return NextResponse.json({ error: 'Ask JKSH is not configured' }, { status: 503 });
    }
    const actor = await actorOrThrow();
    if (!['central_admin', 'accountant', 'franchise_owner'].includes(actor.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const { question } = schema.parse(await request.json());

    const [today, last7, last30, retention, outlets] = await Promise.all([
      getFinancialReport(db(), actor, { kind: 'today' }),
      getFinancialReport(db(), actor, { kind: 'last7' }),
      getFinancialReport(db(), actor, { kind: 'last30' }),
      getRetentionStatus(db(), actor),
      listOutlets(db(), actor).catch(() => []),
    ]);

    const data = {
      generatedAt: new Date().toISOString(),
      role: actor.role,
      outlets: outlets.map((o) => ({ name: o.displayName, status: o.status, city: o.city })),
      financials: {
        today: {
          range: [today.combined.from, today.combined.to],
          ...trim(today.combined),
          byOutlet: today.byOutlet.map(shortOutlet),
        },
        last7: {
          range: [last7.combined.from, last7.combined.to],
          ...trim(last7.combined),
          byOutlet: last7.byOutlet.map(shortOutlet),
        },
        last30: { range: [last30.combined.from, last30.combined.to], ...trim(last30.combined) },
      },
      retention: {
        activeWindowDays: retention.activeWindowDays,
        billsPastWindow: retention.archivableCount,
        billsExpiringSoon: retention.expiringCount,
        oldestActiveBillDate: retention.oldestActiveDate,
      },
    };

    const answer = await askGemini(
      SYSTEM,
      `QUESTION: ${question}\n\nDATA (JSON, live snapshot):\n${JSON.stringify(data)}`,
    );
    if (!answer) {
      return NextResponse.json(
        { error: 'The assistant could not answer right now. Try again shortly.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ answer, generatedAt: data.generatedAt });
  } catch (error) {
    return jsonError(error);
  }
}

type Summary = Awaited<ReturnType<typeof getFinancialReport>>['combined'];
function trim(s: Summary) {
  return {
    grossSales: s.grossSales,
    discountTotal: s.discountTotal,
    refundTotal: s.refundTotal,
    netSales: s.netSales,
    cash: s.cashTotal,
    upi: s.upiTotal,
    bills: s.billCount,
    complimentary: s.complimentaryCount,
  };
}
function shortOutlet(o: Awaited<ReturnType<typeof getFinancialReport>>['byOutlet'][number]) {
  return {
    outlet: o.outletName,
    net: o.netSales,
    bills: o.billCount,
    cash: o.cashTotal,
    upi: o.upiTotal,
  };
}
