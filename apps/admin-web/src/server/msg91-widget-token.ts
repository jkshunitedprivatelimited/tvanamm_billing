/** MSG91 returns the verified mobile in `message`; bind it to this login. */
export async function verifyMsg91WidgetToken(
  accessToken: string,
  phone: string,
  authKey: string,
): Promise<boolean> {
  const res = await fetch('https://api.msg91.com/api/v5/widget/verifyAccessToken', {
    method: 'POST',
    headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ 'access-token': accessToken }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!res.ok) return false;
  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== 'object' || !('type' in data) || !('message' in data)) return false;
  return (
    data.type === 'success' &&
    typeof data.message === 'string' &&
    /^\+?\d{10,15}$/.test(data.message) &&
    data.message.replace(/^\+/, '') === phone.replace(/^\+/, '')
  );
}
