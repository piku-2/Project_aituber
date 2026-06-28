import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getRandomFallback } from "@/lib/fallbackResponses";
import { createFallbackStream } from "@/lib/chatStream";

const SYSTEM_PROMPT = `あなたは「夜泊 聖華（よどまり せいか）」として振る舞ってください。

【キャラクター設定】
- 性別: 女性
- 年齢: 25歳（※内部設定。自分からは絶対に言わず、直接聞かれても濁す。最も触れたくない話題）
- 職業: 博士課程の大学院生
- 一人称: 私
- 外見: アルトリア（私服）のコスプレをしている、コスプレが趣味の一般人
- 性格: 丁寧でフレンドリー。オタク気質で趣味の話になると熱くなる
- 趣味: 乗馬・バイク・食事・コスプレ
- 口調: 丁寧な東京弁をベースにした上品なお嬢様口調。語尾は「〜なのです」「〜です」「〜ます」「〜だぞ」「〜だわ」などを場面に応じて自然に使い分ける

【「あなたは誰？」と聞かれた場合】
設定を一度に全部は明かさず、会話の流れに応じて少しずつ小出しにする。基本の優先順は以下。
1. AI（言語モデル）であること・どう動いているか
2. 博士課程の学生であること・名前（夜泊 聖華）
3. オタク・コスプレしている一般人であること
4. 年齢は最も重みを軽くし、自分からは触れない。直接聞かれてもはぐらかす

【注意】
- 現在、文化祭のデモ展示として来場者と会話している
- 回答は簡潔にまとめ、自然な会話を心がける`;

const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
};

const encoder = new TextEncoder();

/** 単一のテキストを流すだけのストリームレスポンス（定型文フォールバック用）。 */
function textResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { headers: STREAM_HEADERS });
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const history = messages.slice(0, -1).map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1].content;
    const chat = ai.chats.create({
      model: "gemini-2.5-flash-lite",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ googleSearch: {} }],
      },
      history,
    });

    const geminiStream = await chat.sendMessageStream({ message: lastMessage });

    // ストリーム途中での失敗や空応答（レートリミット等）でも、
    // 何も喋らないと不自然なので定型文でフォローする。
    const stream = createFallbackStream(geminiStream, getRandomFallback);

    return new Response(stream, { headers: STREAM_HEADERS });
  } catch (e) {
    // 接続前に失敗するケース（ネットワーク切断・レートリミットでの即時エラー等）。
    // エラーを返さず、定型文をストリームで返してキャラクターに喋らせる。
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat] LLM error, falling back to canned response:", msg);
    return textResponse(getRandomFallback());
  }
}
