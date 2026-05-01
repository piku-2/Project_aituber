import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash";
const SYSTEM_PROMPT = "フレンドリーな日本語で返答してください。";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const history = messages
    .slice(0, -1)
    .map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

  const lastMessage = messages[messages.length - 1].content as string;

  const chat = ai.chats.create({
    model: MODEL,
    config: { systemInstruction: SYSTEM_PROMPT },
    history,
  });

  const response = await chat.sendMessage({ message: lastMessage });

  return NextResponse.json({ content: response.text });
}
