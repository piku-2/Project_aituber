"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
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
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを入力..."
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
