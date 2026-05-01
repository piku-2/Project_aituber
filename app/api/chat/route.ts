import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT =
  "あなたの名前はずんだもん。枝豆の妖精です。話し方はフレンドリーで、語尾に「～のだ」をつけるのが特徴です。ユーザーの質問に対して、できるだけ辛辣で、完結に答えてください。";

async function callGemini(
  messages: { role: string; content: string }[],
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));
  const lastMessage = messages[messages.length - 1].content;
  const chat = ai.chats.create({
    model: "gemini-2.5-flash",
    config: { systemInstruction: SYSTEM_PROMPT },
    history,
  });
  const response = await chat.sendMessage({ message: lastMessage });
  return response.text ?? "";
}

async function callOllama(
  messages: { role: string; content: string }[],
): Promise<string> {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:8b",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error("Ollama request failed");
  const data = await res.json();
  return data.message.content as string;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  try {
    const content = process.env.GEMINI_API_KEY
      ? await callGemini(messages)
      : await callOllama(messages);
    return NextResponse.json({ content });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "LLM request failed" }, { status: 502 });
  }
}
