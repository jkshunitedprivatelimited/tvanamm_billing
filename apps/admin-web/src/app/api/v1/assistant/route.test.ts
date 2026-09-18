vi.mock('server-only', () => ({}));
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  actor: vi.fn(),
  enabled: vi.fn(),
  generate: vi.fn(),
  origin: vi.fn(),
  query: vi.fn(),
  financial: vi.fn(),
  outlets: vi.fn(),
  retention: vi.fn(),
  operations: vi.fn(),
  inventory: vi.fn(),
}));
vi.mock('@/server/http', () => ({
  actorOrThrow: m.actor,
  assertSameOrigin: m.origin,
  apiJson: (body: unknown, opts?: { status?: number }) => Response.json(body, opts),
  jsonError: () => Response.json({ error: 'invalid' }, { status: 400 }),
}));
vi.mock('@/server/gemini', () => ({ askJkshEnabled: m.enabled, askGemini: m.generate }));
vi.mock('@/server/operational-reports', () => ({ getOperationalReports: m.operations }));
vi.mock('@jksh/identity', () => ({
  getFinancialReport: m.financial,
  listOutlets: m.outlets,
  getRetentionStatus: m.retention,
  IdentityError: class extends Error {},
}));
vi.mock('@/server/pool', () => ({ db: () => ({}) }));
vi.mock('@/server/stock', () => ({
  stockDb: () => ({}),
  stockActorFor: async () => ({ organizationId: '01000000-0000-4000-8000-000000000001' }),
}));
vi.mock('@jksh/db', () => ({
  withStockActorContext: async (_p: unknown, _a: unknown, fn: (c: unknown) => unknown) =>
    fn({ query: m.query }),
}));
vi.mock('@jksh/stock', () => ({
  stockContextForActor: () => ({}),
  listLowStockItems: m.inventory,
}));
import { POST } from './route';
import { POST as save } from './draft/route';
const draft = {
  name: 'Tea',
  kind: 'menu_item',
  serving: null,
  batchYield: null,
  ingredients: [{ name: 'Milk', quantity: '1', unit: 'l', basis: 'per_batch' }],
  steps: ['Heat as specified in the approved preparation notes.'],
  checks: [],
  missingMeasurements: ['Measure serving size'],
};
const req = (body: unknown) =>
  new Request('http://localhost/api/v1/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({
    role: 'central_admin',
    accountId: '01000000-0000-4000-8000-000000000002',
  });
  m.enabled.mockReturnValue(true);
  m.inventory.mockResolvedValue([]);
  m.outlets.mockResolvedValue([
    {
      id: '01000000-0000-4000-8000-000000000010',
      displayName: 'My outlet',
      city: 'Hyderabad',
      status: 'active',
    },
  ]);
  m.financial.mockResolvedValue({
    combined: { from: '2026-09-18', to: '2026-09-18', netSales: '100', billCount: 2 },
    byOutlet: [],
  });
  m.operations.mockResolvedValue({
    from: '2026-09-18',
    to: '2026-09-18',
    billing: { expenses: [], attendance: [] },
    stock: {
      orders: [],
      movements: [],
      wastage: [],
      suppliers: [{ supplier: 'Private supplier' }],
      purchases: [{ amount: 99999 }],
    },
  });
  m.retention.mockResolvedValue({ activeWindowDays: 60 });
  m.generate.mockResolvedValue('Answer');
  m.query.mockResolvedValue({ rows: [{ id: '01000000-0000-4000-8000-000000000003' }] });
});
it('returns structured unconfirmed measurements without writing recipes', async () => {
  m.generate.mockResolvedValue(JSON.stringify(draft));
  const response = await POST(req({ question: 'Draft milk tea', mode: 'recipe' }));
  expect(response.status).toBe(200);
  expect((await response.json()).draft.serving).toBeNull();
  expect(m.query).not.toHaveBeenCalled();
});
it('rejects malformed generated recipes', async () => {
  m.generate.mockResolvedValue('{"name":"Tea"}');
  expect((await POST(req({ question: 'Draft tea', mode: 'recipe' }))).status).toBe(502);
});
it('does not let owners create central standards', async () => {
  m.actor.mockResolvedValue({ role: 'franchise_owner' });
  expect((await POST(req({ question: 'Draft tea', mode: 'recipe' }))).status).toBe(403);
  expect((await save(req({ draft }))).status).toBe(403);
  expect(m.generate).not.toHaveBeenCalled();
  expect(m.query).not.toHaveBeenCalled();
});
it('saves a reviewed draft without publishing a version', async () => {
  expect((await save(req({ draft }))).status).toBe(200);
  expect(m.query.mock.calls[0]?.[0]).toContain('insert into stock.recipes');
  expect(m.query.mock.calls[0]?.[0]).not.toContain('recipe_versions');
});
it('will not overwrite a published or inaccessible recipe', async () => {
  m.query.mockResolvedValue({ rows: [] });
  expect((await save(req({ id: '01000000-0000-4000-8000-000000000003', draft }))).status).toBe(409);
  expect(m.query.mock.calls[0]?.[0]).toContain("status='draft'");
});
it('rejects a cross-origin draft request before generating or saving', async () => {
  m.origin.mockImplementation(() => {
    throw new Error('origin');
  });
  expect((await POST(req({ question: 'Draft tea', mode: 'recipe' }))).status).toBe(400);
  expect((await save(req({ draft }))).status).toBe(400);
  expect(m.query).not.toHaveBeenCalled();
  expect(m.generate).not.toHaveBeenCalled();
  m.origin.mockReset();
});
it('reports missing AI configuration honestly', async () => {
  m.enabled.mockReturnValue(false);
  expect((await POST(req({ question: 'Sales today' }))).status).toBe(503);
  expect(m.generate).not.toHaveBeenCalled();
});

const owner = {
  role: 'franchise_owner',
  scope: {
    organizationId: '01000000-0000-4000-8000-000000000001',
    franchiseId: '01000000-0000-4000-8000-000000000020',
  },
};
it('uses an owner persona and excludes central purchasing and retention from the AI payload', async () => {
  m.actor.mockResolvedValue(owner);
  const outletId = '01000000-0000-4000-8000-000000000010';
  expect(
    (await POST(req({ question: 'How is my outlet?', outletId, role: 'central_admin' }))).status,
  ).toBe(200);
  const [system, prompt] = m.generate.mock.calls[0] ?? [];
  expect(system).toContain("franchise owner's outlet assistant");
  expect(prompt).not.toContain('Private supplier');
  expect(prompt).not.toContain('99999');
  expect(prompt).not.toContain('retention');
  expect(prompt).toContain(`/stock/${outletId}/alerts`);
  expect(m.retention).not.toHaveBeenCalled();
  expect(m.financial).toHaveBeenCalledWith(
    expect.anything(),
    owner,
    { kind: 'today' },
    { outletId },
  );
  expect(m.operations).toHaveBeenCalledWith(owner, '2026-09-18', '2026-09-18', outletId);
});
it('rejects another outlet before loading reports or contacting AI', async () => {
  m.actor.mockResolvedValue(owner);
  expect(
    (
      await POST(
        req({ question: 'Show another outlet', outletId: '01000000-0000-4000-8000-000000000099' }),
      )
    ).status,
  ).toBe(403);
  expect(m.financial).not.toHaveBeenCalled();
  expect(m.generate).not.toHaveBeenCalled();
  expect(m.operations).not.toHaveBeenCalled();
});
it('requires an owner franchise scope', async () => {
  m.actor.mockResolvedValue({
    role: 'franchise_owner',
    scope: { organizationId: '01000000-0000-4000-8000-000000000001' },
  });
  expect((await POST(req({ question: 'Show all outlets' }))).status).toBe(403);
  expect(m.outlets).not.toHaveBeenCalled();
  expect(m.generate).not.toHaveBeenCalled();
});
it('keeps central analysis and supplier reporting available', async () => {
  expect((await POST(req({ question: 'Summarize central purchases' }))).status).toBe(200);
  const [system, prompt] = m.generate.mock.calls[0] ?? [];
  expect(system).toContain('central admin across their organization');
  expect(prompt).toContain('Private supplier');
  expect(m.retention).toHaveBeenCalled();
});
