import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "qwen3:8b";
const SYSTEM_PROMPT = "あなたはAITuberです。フレンドリーに日本語で返答してください。";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: false,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Ollama request failed" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({ content: data.message.content });
}
