import 'server-only';

/** Ask JKSH is off unless a Gemini key is configured. */
export function askJkshEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

function model(): string {
  const m = process.env.ASK_JKSH_MODEL?.trim();
  return m && m.length > 0 ? m : 'gemini-2.0-flash';
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** Single-turn grounded generation. Returns the model's text, or null on any
 *  failure (the caller surfaces a friendly message). */
export async function askGemini(system: string, user: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return text.trim() || null;
  } catch {
    return null;
  }
}
