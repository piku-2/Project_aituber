import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { voiceConfig } from "@/lib/voiceConfig";

const MAX_TEXT_LENGTH = 500;

async function voicevoxBases(): Promise<string[]> {
  const urls = [process.env.VOICEVOX_URL ?? "http://localhost:50021"];
  try {
    const resolv = await readFile("/etc/resolv.conf", "utf8");
    const match = resolv.match(/^nameserver\s+(\S+)/m);
    if (match && !["127.0.0.1", "::1"].includes(match[1])) {
      urls.push(`http://${match[1]}:50021`);
    }
  } catch {
    /* not WSL / no resolv.conf */
  }
  return [...new Set(urls)];
}

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
  const bases = await voicevoxBases();
  let lastError = "voicevox unreachable";

  for (const base of bases) {
    try {
      const queryRes = await fetch(
        `${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
        { method: "POST" }
      );
      if (!queryRes.ok) {
        lastError = "audio_query failed";
        continue;
      }

      const query = { ...(await queryRes.json()), ...customParams };

      const synthRes = await fetch(`${base}/synthesis?speaker=${speakerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (!synthRes.ok) {
        lastError = "synthesis failed";
        continue;
      }

      const audio = Buffer.from(await synthRes.arrayBuffer());
      return NextResponse.json({ query, audio: audio.toString("base64") });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  console.warn(`[tts] VOICEVOX に接続できません (${bases.join(", ")}): ${lastError}`);
  return NextResponse.json({ error: "voicevox unreachable" }, { status: 502 });
}
