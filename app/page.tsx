"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { voiceConfig } from "@/lib/voiceConfig";
import type { Live2DViewerHandle } from "@/components/Live2DViewer";

const Live2DViewer = dynamic(() => import("@/components/Live2DViewer"), { ssr: false });

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTranscript, speakingContent]);

  async function speak(text: string, onProgress: (partial: string) => void): Promise<void> {
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
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setSpeakingContent("");
      await speak(data.content, (partial) => setSpeakingContent(partial));
      setSpeakingContent("");
      setMessages([...next, { role: "assistant", content: data.content }]);
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
      <div className="flex-1">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Live2DViewer ref={live2DRef as any} />
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
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
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

        <form
          onSubmit={handleSubmit}
          className="p-3 border-t border-gray-200 flex gap-2"
        >
          <button
            type="button"
            onClick={toggleListening}
            className={`rounded-full w-10 h-10 flex items-center justify-center text-lg shrink-0 transition-colors ${
              listening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            🎤
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "聞いています..." : "メッセージを入力..."}
            className="flex-1 rounded-full border border-gray-300 bg-gray-50 px-4 py-2 text-base text-gray-900 placeholder-gray-400 outline-none focus:border-blue-400 focus:bg-white"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-blue-600"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
}
