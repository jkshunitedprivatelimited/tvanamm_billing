export type ApiResult = { ok: true } | { ok: false; error: string; uncertain?: boolean };

export async function apiPost(url: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) return { ok: true };
    const data: unknown = await res.json().catch(() => null);
    const error =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `HTTP ${String(res.status)}`;
    return { ok: false, error, uncertain: res.status >= 500 };
  } catch {
    return {
      ok: false,
      uncertain: true,
      error:
        'Connection interrupted. Refresh to check whether the change was saved before retrying.',
    };
  }
}
