export type ProviderName = "ollama" | "gemini";

export function isOllamaConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(String(env.OLLAMA_URL || "").trim());
}

export function ollamaBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return String(env.OLLAMA_URL || "").trim().replace(/\/$/, "");
}

export function ollamaModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.OLLAMA_MODEL || "qwen2.5:7b").trim() || "qwen2.5:7b";
}

export function isOllamaDeadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; code?: string; status?: number; message?: string };
  if (err.name === "AbortError") return true;
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") return true;
  if (typeof err.status === "number" && err.status >= 500) return true;
  const message = String(err.message || "");
  return /fetch failed|ECONNREFUSED|ETIMEDOUT|network|socket/i.test(message);
}

export function chooseProvider(input: { configured: boolean; alive: boolean }): ProviderName {
  if (input.configured && input.alive) return "ollama";
  return "gemini";
}

export function parseOllamaLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as { message?: { content?: string } };
    return typeof parsed.message?.content === "string" ? parsed.message.content : "";
  } catch {
    return "";
  }
}

export async function probeOllama(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 800,
): Promise<boolean> {
  if (!baseUrl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type OllamaChatOptions = {
  baseUrl: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
};

export async function openOllamaStream(options: OllamaChatOptions): Promise<AsyncGenerator<{ text?: string }>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages: [
        { role: "system", content: options.system },
        ...options.messages,
      ],
    }),
  });
  if (!response.ok) {
    const error = new Error(`http ${response.status}`);
    (error as { status?: number }).status = response.status;
    throw error;
  }
  if (!response.body) throw new Error("fetch failed");
  return readOllamaBody(response.body);
}

async function* readOllamaBody(body: ReadableStream<Uint8Array>): AsyncGenerator<{ text?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const text = parseOllamaLine(line.trim());
      if (text) yield { text };
    }
  }
  const tail = parseOllamaLine(buffer.trim());
  if (tail) yield { text: tail };
}
