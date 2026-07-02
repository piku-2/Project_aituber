import { NextRequest, NextResponse } from "next/server";
import { voiceConfig } from "@/lib/voiceConfig";

const VOICEVOX_URL = process.env.VOICEVOX_URL ?? "http://localhost:50021";
const MAX_TEXT_LENGTH = 500;

export async function POST(req: NextRequest) {
  let text: unknown;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "invalid text" }, { status: 400 });
  }

  const { speakerId, ...customParams } = voiceConfig;

  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: "POST" }
  );
  if (!queryRes.ok) {
    return NextResponse.json({ error: "audio_query failed" }, { status: 502 });
  }

  const query = { ...(await queryRes.json()), ...customParams };

  const synthRes = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok) {
    return NextResponse.json({ error: "synthesis failed" }, { status: 502 });
  }

  // 口パク用タイムラインをクライアントで組み立てるためにクエリも一緒に返す
  const audio = Buffer.from(await synthRes.arrayBuffer());
  return NextResponse.json({ query, audio: audio.toString("base64") });
}
