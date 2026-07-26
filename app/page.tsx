"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { voiceConfig } from "@/lib/voiceConfig";
import type { Live2DViewerHandle } from "@/components/Live2DViewer";

const Live2DViewer = dynamic(() => import("@/components/Live2DViewer"), { ssr: false });
const FaceTracker = dynamic(() => import("@/components/FaceTracker"), { ssr: false });

type Message = {
  role: "user" | "assistant";
  content: string;
};

interface ISpeechRecognitionResult {
  readonly 0: { transcript: string };
}

interface ISpeechRecognitionEvent extends Event {
  readonly results: ISpeechRecognitionResult[];
}

interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: { error: string }) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
  }
}

interface VoicevoxMora {
  consonant_length?: number;
  vowel_length: number;
}

interface VoicevoxAccentPhrase {
  moras: VoicevoxMora[];
  pause_mora?: VoicevoxMora;
}

interface VoicevoxQuery {
  accent_phrases: VoicevoxAccentPhrase[];
  prePhonemeLength: number;
}

function buildTimeline(query: VoicevoxQuery, text: string): { time: number; chars: number }[] {
  const timeline: { time: number; chars: number }[] = [];
  let t = query.prePhonemeLength;

  let totalMoras = 0;
  for (const phrase of query.accent_phrases) {
    totalMoras += phrase.moras.length;
    if (phrase.pause_mora) totalMoras++;
  }

  let moraIdx = 0;
  for (const phrase of query.accent_phrases) {
    for (const mora of phrase.moras) {
      t += (mora.consonant_length ?? 0) + mora.vowel_length;
      moraIdx++;
      timeline.push({ time: t, chars: Math.ceil((moraIdx / totalMoras) * text.length) });
    }
    if (phrase.pause_mora) {
      t += (phrase.pause_mora.consonant_length ?? 0) + phrase.pause_mora.vowel_length;
      moraIdx++;
    }
  }

  return timeline;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const live2DRef = useRef<Live2DViewerHandle>(null);
  const [speakingContent, setSpeakingContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const isDraggingRef = useRef(false);
  const handleMouseDown = () => { isDraggingRef.current = true; };
  const handleMouseUp = () => { isDraggingRef.current = false; };
  const handleMouseLeave = () => { isDraggingRef.current = false; };
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, -((e.clientY - rect.top) / rect.height - 0.5) * 2));
    live2DRef.current?.setEyePosition(x, y);
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTranscript, speakingContent]);

  async function speak(text: string, onProgress: (partial: string) => void): Promise<void> {
    // VOICEVOX はブラウザ（Windows 側）から直接叩く。WSL 内のサーバーを経由すると
    // Windows 上の VOICEVOX に届かないため（詳細は README 参照）
    const VOICEVOX = "http://localhost:50021";
    const { speakerId, ...customParams } = voiceConfig;
    try {
      const queryRes = await fetch(
        `${VOICEVOX}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
        { method: "POST" }
      );
      if (!queryRes.ok) return;
      const query: VoicevoxQuery = { ...await queryRes.json(), ...customParams };
      const timeline = buildTimeline(query, text);

      const synthRes = await fetch(`${VOICEVOX}/synthesis?speaker=${speakerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (!synthRes.ok) return;

      const blob = await synthRes.blob();
      const url = URL.createObjectURL(blob);

      await new Promise<void>((resolve) => {
        const audio = new Audio(url);

        // Web Audio で口パク用の音量分析
        const audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        const source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        const pcmData = new Uint8Array(analyser.frequencyBinCount);
        let rafId = 0;

        const updateMouth = () => {
          analyser.getByteTimeDomainData(pcmData);
          let sum = 0;
          for (const v of pcmData) sum += (v - 128) ** 2;
          const rms = Math.sqrt(sum / pcmData.length) / 128;
          live2DRef.current?.setMouthValue(Math.min(rms * 8, 1));
          rafId = requestAnimationFrame(updateMouth);
        };

        // テキスト同期（タイムライン）
        audio.addEventListener("timeupdate", () => {
          const ct = audio.currentTime;
          let chars = 0;
          for (const entry of timeline) {
            if (entry.time <= ct) chars = entry.chars;
            else break;
          }
          onProgress(text.slice(0, chars));
        });

        const cleanup = () => {
          cancelAnimationFrame(rafId);
          live2DRef.current?.setMouthValue(0);
          URL.revokeObjectURL(url);
          audioCtx.close();
        };
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); resolve(); };
        audio.play().then(() => { rafId = requestAnimationFrame(updateMouth); });
      });
    } catch (e) {
      console.error("VOICEVOX error:", e);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const next = [...messagesRef.current, userMessage];
    setMessages(next);
    setInput("");
    setLiveTranscript("");
    transcriptRef.current = "";
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // サーバー側の検証上限（50件・2000字）に合わせて直近の履歴だけ送る
        body: JSON.stringify({
          messages: next.slice(-50).map((m) => ({ ...m, content: m.content.slice(0, 2000) })),
        }),
      });
      if (!res.ok || !res.body) {
        let msg = "LLM request failed";
        try { msg = (await res.json()).error ?? msg; } catch { /* not json */ }
        throw new Error(msg);
      }

      setSpeakingContent("");

      // ストリームを文単位に分割し、文ができ次第 VOICEVOX で再生するパイプライン
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const queue: string[] = [];
      let buffer = "";
      let producerDone = false;
      let spoken = "";
      let wake: (() => void) | null = null;
      const notify = () => { if (wake) { const w = wake; wake = null; w(); } };

      const flushSentences = () => {
        let idx: number;
        while ((idx = buffer.search(/[。！？\n]/)) !== -1) {
          queue.push(buffer.slice(0, idx + 1));
          buffer = buffer.slice(idx + 1);
          notify();
        }
      };

      const producer = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          flushSentences();
        }
        if (buffer.trim()) { queue.push(buffer); buffer = ""; }
        producerDone = true;
        notify();
      })();

      const consumer = (async () => {
        while (true) {
          if (queue.length === 0) {
            if (producerDone) break;
            await new Promise<void>((r) => { wake = r; });
            continue;
          }
          const piece = queue.shift()!.trim();
          if (!piece) continue;
          await speak(piece, (partial) => setSpeakingContent(spoken + partial));
          spoken += piece;
        }
      })();

      await Promise.all([producer, consumer]);
      setSpeakingContent("");
      const full = spoken.trim();
      if (!full) throw new Error("empty response");
      setMessages([...next, { role: "assistant", content: full }]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "エラーが発生しました。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function toggleListening() {
    // 応答中・発話中は音声入力を受け付けない
    if (loading) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      alert("このブラウザはWeb Speech APIに対応していません。");
      return;
    }

    const rec = new SR();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      setLiveTranscript("");
      send(transcriptRef.current);
    };

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      const transcript = Array.from(e.results)
        .map((r: ISpeechRecognitionResult) => r[0].transcript)
        .join("");
      transcriptRef.current = transcript;
      setLiveTranscript(transcript);
    };

    rec.onerror = (e: { error: string }) => {
      console.error("SpeechRecognition error:", e.error);
      setListening(false);
    };

    recognitionRef.current = rec;
    rec.start();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await send(input);
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* キャラクターエリア（左2/3） */}
      <div
        className="flex-1 relative cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Live2DViewer ref={live2DRef as any} />
        <FaceTracker onFaceMove={(x, y) => { if (!isDraggingRef.current) live2DRef.current?.setEyePosition(x, y); }} />
      </div>

      {/* チャットエリア（右1/3） */}
      <div className="w-1/3 flex flex-col bg-white border-l border-gray-200 shadow-sm">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${msg.role === "user"
                    ? "bg-blue-500 text-white font-medium"
                    : "bg-gray-100 text-gray-900 font-medium"
                  }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {liveTranscript && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap bg-blue-200 text-blue-900 font-medium opacity-70">
                {liveTranscript}
              </div>
            </div>
          )}
          {speakingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap bg-gray-100 text-gray-900 font-medium">
                {speakingContent}
                <span className="animate-pulse">▌</span>
              </div>
            </div>
          )}
          {loading && !speakingContent && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-base text-gray-400 font-medium">
                入力中...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 応答・発話中は入力不可であることを示すバー */}
        {loading && (
          <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 text-sm font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            聖華が話しています… 終わるまでお待ちください
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className={`p-3 border-t border-gray-200 flex gap-2 transition-opacity ${loading ? "opacity-50" : ""
            }`}
          aria-busy={loading}
        >
          <button
            type="button"
            onClick={toggleListening}
            disabled={loading}
            className={`rounded-full w-10 h-10 flex items-center justify-center text-lg shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${listening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:hover:bg-gray-100"
              }`}
          >
            🎤
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              loading
                ? "話し終わるまで入力できません…"
                : listening
                  ? "聞いています..."
                  : "メッセージを入力..."
            }
            className="flex-1 rounded-full border border-gray-300 bg-gray-50 px-4 py-2 text-base text-gray-900 placeholder-gray-400 outline-none focus:border-blue-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-gray-100"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
}
