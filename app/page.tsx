"use client";

import { useState, useRef, useEffect } from "react";

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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTranscript]);

  async function speak(text: string): Promise<void> {
    const VOICEVOX = "http://localhost:50021";
    const SPEAKER = 1;
    try {
      const queryRes = await fetch(
        `${VOICEVOX}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER}`,
        { method: "POST" }
      );
      if (!queryRes.ok) return;
      const query = await queryRes.json();

      const synthRes = await fetch(`${VOICEVOX}/synthesis?speaker=${SPEAKER}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (!synthRes.ok) return;

      const blob = await synthRes.blob();
      const url = URL.createObjectURL(blob);

      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play();
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
      await speak(data.content);
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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Live2D ここに表示</p>
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
          {loading && (
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
