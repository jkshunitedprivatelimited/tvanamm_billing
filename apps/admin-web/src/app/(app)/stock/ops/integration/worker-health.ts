import type { IntegrationHealth } from '@jksh/stock';

const expectedWorkers = [
  { worker: 'events', label: 'Stock deductions' },
  { worker: 'alerts', label: 'Low-stock notifications' },
] as const;

const stateLabels: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
};

/** A missing heartbeat must remain visible even when the other worker is healthy. */
export function getWorkerHealthViews(workers: IntegrationHealth['workers']) {
  return expectedWorkers.map(({ worker, label }) => {
    const record = workers.find((entry) => entry.worker === worker) ?? null;
    const state = record ? (stateLabels[record.state] ?? record.state) : 'No runs recorded';

    return {
      worker,
      label,
      record,
      status: record?.stale ? `${state} · No recent run` : state,
      needsAttention: !record || record.stale || record.state === 'failed',
    };
  });
}
