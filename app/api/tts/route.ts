import { NextRequest, NextResponse } from "next/server";

const VOICEVOX_URL = process.env.VOICEVOX_URL ?? "http://localhost:50021";
const SPEAKER = 1; // ずんだもん（ノーマル）。変更する場合はここを変える

export async function POST(req: NextRequest) {
  const { text } = await req.json();

  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER}`,
    { method: "POST" }
  );
  if (!queryRes.ok) {
    return NextResponse.json({ error: "audio_query failed" }, { status: 502 });
  }

  const query = await queryRes.json();

  const synthRes = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${SPEAKER}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok) {
    return NextResponse.json({ error: "synthesis failed" }, { status: 502 });
  }

  const audio = await synthRes.arrayBuffer();
  return new NextResponse(audio, {
    headers: { "Content-Type": "audio/wav" },
  });
}
