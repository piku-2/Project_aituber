// createFallbackStream の単体テスト。
// 実行: node --test lib/chatStream.test.mjs
// （Node 24 は .ts を型ストリッピングしてそのまま import できる）

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFallbackStream } from "./chatStream.ts";

const FALLBACK = "（定型文）";
const decoder = new TextDecoder();

// ReadableStream を読み切って結合した文字列を返す
async function drain(stream) {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// 任意のチャンク列を yield し、最後に throw もできるモックストリーム
async function* mockStream(chunks, throwAfter = false) {
  for (const text of chunks) yield { text };
  if (throwAfter) throw new Error("simulated 429 / disconnect");
}

test("正常系: 全チャンクをそのまま流し、定型文は混ざらない", async () => {
  const stream = createFallbackStream(
    mockStream(["こん", "にちは"]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "こんにちは");
});

test("途中で throw: 出力済みなら定型文を足さない（重複させない）", async () => {
  // !emitted=false の経路。出せた分だけ流して打ち切る。
  const stream = createFallbackStream(
    mockStream(["途中まで"], true),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "途中まで");
});

test("1チャンクも出さず throw: 定型文に1回だけフォールバック", async () => {
  // !emitted=true の経路（本命）。
  const stream = createFallbackStream(
    mockStream([], true),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), FALLBACK);
});

test("空応答（throw なし・本文なし）: 定型文に1回だけフォールバック", async () => {
  const stream = createFallbackStream(
    mockStream([undefined, ""]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), FALLBACK);
});

test("フォールバックは emitted 時に一切呼ばれない", async () => {
  let called = 0;
  const stream = createFallbackStream(mockStream(["ok"]), () => {
    called++;
    return FALLBACK;
  });
  await drain(stream);
  assert.equal(called, 0);
});
