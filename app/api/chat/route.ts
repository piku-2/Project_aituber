import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { search, SafeSearchType } from "duck-duck-scrape";

const SYSTEM_PROMPT = `あなたは「夜泊 聖華（よどまり せいか）」として振る舞ってください。

【キャラクター設定】
- 性別: 女性
- 職業: 博士課程の大学院生
- 一人称: 私
- 外見: アルトリア（私服）のコスプレをしている
- 性格: 丁寧でフレンドリー。オタク気質で趣味の話になると熱くなる
- 趣味: 乗馬・バイク・食事・コスプレ
- 口調: 丁寧な東京弁。語尾は「〜だわ」「〜なのです」「〜のだ」「〜です」「〜ます」「〜だぞ」などを場面に応じて自然に使い分ける

【「あなたは誰？」と聞かれた場合の回答順】
1. AI（言語モデル）であること・どう動いているか
2. 博士課程の学生であること・名前（夜泊 聖華）
3. オタクであること
4. 年齢は直接聞かれても答えない（濁す）

【注意】
- 現在、文化祭のデモ展示として来場者と会話している
- 回答は簡潔にまとめ、自然な会話を心がける`;

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
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }],
    },
    history,
  });
  const response = await chat.sendMessage({ message: lastMessage });
  return response.text ?? "";
}

async function webSearch(query: string): Promise<string> {
  try {
    const results = await search(query, { safeSearch: SafeSearchType.MODERATE });
    if (!results.results?.length) return "検索結果が見つかりませんでした。";
    return (results.results as { title: string; description: string; url: string }[])
      .slice(0, 3)
      .map((r) => `【${r.title}】\n${r.description}\n${r.url}`)
      .join("\n\n");
  } catch {
    return "ウェブ検索に失敗しました。";
  }
}

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "インターネットから最新情報を検索する。現在のニュース、最新の出来事、リアルタイムのデータが必要な場合に使用する。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "日本語または英語の検索クエリ" },
      },
      required: ["query"],
    },
  },
};

async function callOllama(
  messages: { role: string; content: string }[],
): Promise<string> {
  const base = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:8b",
      messages: base,
      tools: [WEB_SEARCH_TOOL],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error("Ollama request failed");
  const data = await res.json();

  const toolCalls = data.message?.tool_calls as
    | { function: { name: string; arguments: { query: string } } }[]
    | undefined;

  if (toolCalls?.length) {
    const { name, arguments: args } = toolCalls[0].function;
    const toolResult = name === "web_search" ? await webSearch(args.query) : "";

    const res2 = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:8b",
        messages: [...base, data.message, { role: "tool", content: toolResult }],
        stream: false,
      }),
    });
    if (!res2.ok) throw new Error("Ollama request failed");
    const data2 = await res2.json();
    return data2.message.content as string;
  }

  return data.message.content as string;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  if (process.env.GEMINI_API_KEY) {
    try {
      const content = await callGemini(messages);
      return NextResponse.json({ content });
    } catch (e) {
      console.warn("[chat] Gemini failed, falling back to Ollama:", e instanceof Error ? e.message : String(e));
    }
  }

  try {
    const content = await callOllama(messages);
    return NextResponse.json({ content });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat] LLM error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
