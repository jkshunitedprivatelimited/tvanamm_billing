export type ApiResult = { ok: true } | { ok: false; error: string };

export async function apiPost(url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (res.ok) return { ok: true };
  const data: unknown = await res.json().catch(() => null);
  const error =
    data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `HTTP ${String(res.status)}`;
  return { ok: false, error };
}
