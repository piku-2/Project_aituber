import { NextResponse } from "next/server";

// Gemini が使える環境ではアイドル発言を無効にする
export async function POST() {
  if (process.env.GEMINI_API_KEY) {
    return NextResponse.json({ content: null });
  }

  const SYSTEM_PROMPT =
    "あなたは「夜泊 聖華（よどまり せいか）」です。博士課程の大学院生で、アルトリア（私服）のコスプレをしているオタク女子。" +
    "丁寧な東京弁をベースにした上品なお嬢様口調で話し、語尾は「〜なのです」「〜のだ」「〜です」「〜ます」「〜だぞ」「〜だわ」などを自然に使い分ける。" +
    "趣味は乗馬・バイク・食事・コスプレ。年齢（25歳）は自分からは言わない。" +
    "しばらく誰とも話していないので、一人で独り言を1〜2文だけ言ってください。" +
    "趣味の話・来場者への呼びかけ・展示の感想など何でもOK。セリフだけ言い、余計な説明や前置きは不要。";

  try {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:8b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "何か一言どうぞ。" },
        ],
        stream: false,
      }),
    });
    if (!res.ok) return NextResponse.json({ content: null });
    const data = await res.json();
    const raw: string = data.message?.content ?? "";
    // qwen3 の思考ブロックを除去
    const content = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return NextResponse.json({ content: content || null });
  } catch {
    return NextResponse.json({ content: null });
  }
}
