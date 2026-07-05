// createFallbackStream の単体テスト。
// 実行: node --test lib/chatStream.test.mjs
// （Node 24 は .ts を型ストリッピングしてそのまま import できる）

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFallbackStream, dedupeOverlap } from "./chatStream.ts";

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

// --- チャンク重複（オーバーラップ）除去 ---

test("実例1: 10文字オーバーラップ（おめでとうございますわ + めでとうございますわ）を除去", async () => {
  const stream = createFallbackStream(
    mockStream(["おめでとうございますわ", "めでとうございますわ"]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "おめでとうございますわ");
});

test("実例2: 2文字オーバーラップ（〜姿勢 + 姿勢）を除去", async () => {
  const stream = createFallbackStream(
    mockStream(["目標に向かって努力される姿勢", "姿勢"]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "目標に向かって努力される姿勢");
});

test("オーバーラップなしの正常系: 誤除去しない", async () => {
  const stream = createFallbackStream(
    mockStream(["ようこそいらしてくださいましたわ。", "私は夜泊聖華なのです。"]),
    () => FALLBACK,
  );
  assert.equal(
    await drain(stream),
    "ようこそいらしてくださいましたわ。私は夜泊聖華なのです。",
  );
});

test("全体重複チャンク: 丸ごとスキップし、後続チャンクは通す", async () => {
  const stream = createFallbackStream(
    mockStream(["こんにちは", "にちは", "、良い天気ですわ"]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "こんにちは、良い天気ですわ");
});

test("最小一致長未満（1文字一致）は除去しない", async () => {
  // 前チャンク末尾「は」と新チャンク先頭「は」が偶然一致するだけのケース
  const stream = createFallbackStream(
    mockStream(["こんにちは", "はい、そうですわ"]),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "こんにちははい、そうですわ");
});

// --- 途中中断時のリカバリーのセリフ ---

const INTERRUPTED = "……あら、途切れてしまいましたわ。";

test("部分出力後に throw: 部分テキスト + 改行 + リカバリーセリフ", async () => {
  const stream = createFallbackStream(
    mockStream(["最新バージョンは6.7で、2026年7月"], true),
    () => FALLBACK,
    () => INTERRUPTED,
  );
  assert.equal(
    await drain(stream),
    "最新バージョンは6.7で、2026年7月\n" + INTERRUPTED,
  );
});

test("正常完了: リカバリーセリフは混ざらない", async () => {
  const stream = createFallbackStream(
    mockStream(["こんにちは。", "良い天気ですわ。"]),
    () => FALLBACK,
    () => INTERRUPTED,
  );
  assert.equal(await drain(stream), "こんにちは。良い天気ですわ。");
});

test("1チャンクも出さず throw: 従来どおり fallback のみ（リカバリーは出ない）", async () => {
  const stream = createFallbackStream(
    mockStream([], true),
    () => FALLBACK,
    () => INTERRUPTED,
  );
  assert.equal(await drain(stream), FALLBACK);
});

test("interrupted 未指定で部分出力後 throw: 従来どおり部分テキストのみ（後方互換）", async () => {
  const stream = createFallbackStream(
    mockStream(["途中まで"], true),
    () => FALLBACK,
  );
  assert.equal(await drain(stream), "途中まで");
});

test("dedupeOverlap: previous が空なら next をそのまま返す", () => {
  assert.equal(dedupeOverlap("", "こんにちは"), "こんにちは");
});

test("dedupeOverlap: 最長オーバーラップを優先して除去する", () => {
  // 「わ」だけでなく「ますわ」全体が一致 → 3文字分を除去
  assert.equal(dedupeOverlap("ございますわ", "ますわね"), "ね");
});

test("dedupeOverlap: 比較窓（末尾50文字）より前の一致は無視する", () => {
  const previous = "重複元テキスト" + "あ".repeat(60);
  assert.equal(dedupeOverlap(previous, "重複元"), "重複元");
});
