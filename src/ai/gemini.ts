interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const AI_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;

/**
 * Executes a call to the configured AI Provider using an OpenAI-compatible endpoint.
 * Supports custom proxy or self-hosted LLM endpoints based on environment configuration.
 *
 * @param systemInstruction - The primary system prompt guiding the AI's behavior and constraints.
 * @param userContent - The content (typically diffs or code segments) to be reviewed.
 * @returns A string containing the AI's response (usually a JSON string).
 * @throws Error if the API request fails after maximum retries or returns a non-200 status.
 */
export async function callAI(systemInstruction: string, userContent: string): Promise<string> {
  const baseUrl = process.env.AI_BASE_URL!;
  const apiKey = process.env.AI_API_KEY!;
  const model = process.env.AI_MODEL ?? 'gemini-3-flash';

  if (!baseUrl || !apiKey) {
    throw new Error('AI_BASE_URL dan AI_API_KEY wajib diisi di .env');
  }

  const messages: ChatMessage[] = [
    { content: systemInstruction, role: 'system' },
    { content: userContent, role: 'user' },
  ];

  const temperature = parseFloat(process.env.AI_TEMPERATURE ?? '0.1');
  const top_p = parseFloat(process.env.AI_TOP_P ?? '1.0');

  const body = JSON.stringify({
    messages,
    model,
    response_format: { type: 'json_object' },
    seed: 42,
    temperature,
    top_p,
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        body,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`[AI] Request failed: ${res.status} ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('[AI] Empty response from model');
      }

      return content;
    } catch (err: any) {
      clearTimeout(timer);

      if (err?.name === 'AbortError') {
        lastError = new Error(`[AI] Timeout setelah ${AI_TIMEOUT_MS / 1000}s (attempt ${attempt})`);
      } else {
        lastError = err;
      }

      console.warn(`[Yolo] AI attempt ${attempt} gagal:`, lastError?.message);

      if (attempt < MAX_RETRIES) {
        const delay = attempt * 3000; // 3s, 6s backoff
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('[AI] Semua attempt gagal');
}
