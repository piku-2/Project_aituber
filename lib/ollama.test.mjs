import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOllamaConfigured,
  isOllamaDeadError,
  chooseProvider,
  parseOllamaLine,
  openOllamaStream,
} from "./ollama.ts";

test("OLLAMA_URL が空なら未設定", () => {
  assert.equal(isOllamaConfigured({ OLLAMA_URL: "" }), false);
  assert.equal(isOllamaConfigured({}), false);
});

test("OLLAMA_URL があれば設定あり", () => {
  assert.equal(isOllamaConfigured({ OLLAMA_URL: "http://100.1.2.3:11434" }), true);
});

test("接続拒否・タイムアウト・中断は死亡", () => {
  assert.equal(isOllamaDeadError(new Error("fetch failed")), true);
  assert.equal(isOllamaDeadError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })), true);
  assert.equal(isOllamaDeadError(Object.assign(new Error("timeout"), { name: "AbortError" })), true);
  assert.equal(isOllamaDeadError(Object.assign(new Error("http 503"), { status: 503 })), true);
});

test("本文のある通常エラーは死亡扱いしない", () => {
  assert.equal(isOllamaDeadError(new Error("model not found")), false);
});

test("URLなしは gemini", () => {
  assert.equal(chooseProvider({ configured: false, alive: false }), "gemini");
  assert.equal(chooseProvider({ configured: false, alive: true }), "gemini");
});

test("URLありで生存なら ollama、死亡なら gemini", () => {
  assert.equal(chooseProvider({ configured: true, alive: true }), "ollama");
  assert.equal(chooseProvider({ configured: true, alive: false }), "gemini");
});

test("Ollama NDJSON からテキストを取る", () => {
  assert.equal(parseOllamaLine('{"message":{"content":"こん"}}'), "こん");
  assert.equal(parseOllamaLine('{"message":{"content":""},"done":true}'), "");
  assert.equal(parseOllamaLine("not-json"), "");
});

test("chat が 503 なら死亡エラーを投げる", async () => {
  const fetchImpl = async () => new Response("down", { status: 503 });
  await assert.rejects(
    () =>
      openOllamaStream({
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen2.5:7b",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
      }),
    (error) => isOllamaDeadError(error),
  );
});
