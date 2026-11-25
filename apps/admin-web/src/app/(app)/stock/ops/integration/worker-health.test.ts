import { describe, expect, it } from 'vitest';
import type { IntegrationHealth } from '@jksh/stock';
import { getWorkerHealthViews } from './worker-health';

function workerRecord(
  worker: 'events' | 'alerts',
  state = 'completed',
  stale = false,
): IntegrationHealth['workers'][number] {
  return {
    worker,
    state,
    stale,
    startedAt: '2026-11-16T00:00:00.000Z',
    finishedAt: '2026-11-16T00:00:01.000Z',
    lastSuccessAt: state === 'completed' ? '2026-11-16T00:00:01.000Z' : null,
  };
}

describe('worker health visibility', () => {
  it('flags both expected workers when no heartbeats have been recorded', () => {
    expect(getWorkerHealthViews([])).toEqual([
      {
        worker: 'events',
        label: 'Stock deductions',
        record: null,
        status: 'No runs recorded',
        needsAttention: true,
      },
      {
        worker: 'alerts',
        label: 'Low-stock notifications',
        record: null,
        status: 'No runs recorded',
        needsAttention: true,
      },
    ]);
  });

  it.each(['events', 'alerts'] as const)(
    'keeps the missing worker visible when only %s has run',
    (worker) => {
      const record = workerRecord(worker);
      const views = getWorkerHealthViews([record]);

      expect(views).toHaveLength(2);
      expect(views.find((view) => view.worker === worker)).toMatchObject({
        record,
        status: 'Completed',
        needsAttention: false,
      });
      expect(views.find((view) => view.worker !== worker)).toMatchObject({
        record: null,
        status: 'No runs recorded',
        needsAttention: true,
      });
    },
  );

  it.each([
    ['running', 'Running', false],
    ['completed', 'Completed', false],
    ['paused', 'Paused', false],
    ['failed', 'Failed', true],
  ] as const)('preserves %s state and separately flags stale runs', (state, label, attention) => {
    const views = getWorkerHealthViews([
      workerRecord('events', state),
      workerRecord('alerts', state, true),
    ]);

    expect(views[0]).toMatchObject({ status: label, needsAttention: attention });
    expect(views[1]).toMatchObject({ status: `${label} · No recent run`, needsAttention: true });
  });
});
