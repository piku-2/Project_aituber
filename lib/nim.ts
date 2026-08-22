export const DEFAULT_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NIM_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

export function isNimConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(String(env.NVIDIA_API_KEY || "").trim());
}

export function nimBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return String(env.NVIDIA_NIM_BASE_URL || DEFAULT_NIM_BASE_URL).trim().replace(/\/$/, "") || DEFAULT_NIM_BASE_URL;
}

export function nimModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.NVIDIA_NIM_MODEL || DEFAULT_NIM_MODEL).trim() || DEFAULT_NIM_MODEL;
}

export function isNimDeadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; code?: string; status?: number; message?: string };
  if (err.name === "AbortError") return true;
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") return true;
  if (typeof err.status === "number" && (err.status === 401 || err.status === 403 || err.status === 408 || err.status === 429 || err.status >= 500)) {
    return true;
  }
  const message = String(err.message || "");
  return /fetch failed|ECONNREFUSED|ETIMEDOUT|network|socket/i.test(message);
}

export function parseNimSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

type ChatMessage = { role: "user" | "assistant"; content: string };

type NimChatOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
};

export async function openNimStream(options: NimChatOptions): Promise<AsyncGenerator<{ text?: string }>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
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
  return readNimBody(response.body);
}

async function* readNimBody(body: ReadableStream<Uint8Array>): AsyncGenerator<{ text?: string }> {
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
      const text = parseNimSseLine(line);
      if (text) yield { text };
    }
  }
  const tail = parseNimSseLine(buffer);
  if (tail) yield { text: tail };
}
