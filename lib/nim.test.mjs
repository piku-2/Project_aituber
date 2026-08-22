import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNimConfigured,
  isNimDeadError,
  nimBaseUrl,
  nimModel,
  parseNimSseLine,
  openNimStream,
  DEFAULT_NIM_BASE_URL,
  DEFAULT_NIM_MODEL,
} from "./nim.ts";

test("NVIDIA_API_KEY が空なら未設定", () => {
  assert.equal(isNimConfigured({ NVIDIA_API_KEY: "" }), false);
  assert.equal(isNimConfigured({}), false);
});

test("NVIDIA_API_KEY があれば設定あり", () => {
  assert.equal(isNimConfigured({ NVIDIA_API_KEY: "nvapi-test" }), true);
});

test("既定の base URL とモデル", () => {
  assert.equal(nimBaseUrl({}), DEFAULT_NIM_BASE_URL);
  assert.equal(nimModel({}), DEFAULT_NIM_MODEL);
  assert.equal(nimBaseUrl({ NVIDIA_NIM_BASE_URL: "https://example.invalid/v1/" }), "https://example.invalid/v1");
  assert.equal(nimModel({ NVIDIA_NIM_MODEL: "custom-model" }), "custom-model");
});

test("認証失敗・レート制限・5xx・切断は死亡", () => {
  assert.equal(isNimDeadError(new Error("fetch failed")), true);
  assert.equal(isNimDeadError(Object.assign(new Error("http 401"), { status: 401 })), true);
  assert.equal(isNimDeadError(Object.assign(new Error("http 429"), { status: 429 })), true);
  assert.equal(isNimDeadError(Object.assign(new Error("http 503"), { status: 503 })), true);
});

test("本文のある通常エラーは死亡扱いしない", () => {
  assert.equal(isNimDeadError(new Error("model not found")), false);
});

test("OpenAI SSE からテキストを取る", () => {
  assert.equal(parseNimSseLine('data: {"choices":[{"delta":{"content":"こん"}}]}'), "こん");
  assert.equal(parseNimSseLine("data: [DONE]"), "");
  assert.equal(parseNimSseLine("not-json"), "");
});

test("chat が 503 なら死亡エラーを投げる", async () => {
  const fetchImpl = async () => new Response("down", { status: 503 });
  await assert.rejects(
    () =>
      openNimStream({
        apiKey: "nvapi-test",
        baseUrl: DEFAULT_NIM_BASE_URL,
        model: DEFAULT_NIM_MODEL,
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
      }),
    (error) => isNimDeadError(error),
  );
});
