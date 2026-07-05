// プロンプトインジェクション / ジェイルブレイク対策の入力ガード。
// LLM に渡す前にユーザー入力を検査し、典型的な攻撃パターンを検知したら
// LLM を呼ばずにキャラクターとして受け流す定型文を返す。
// パターン検知は完全ではないため、SYSTEM_PROMPT 側の防御指示
// （app/api/chat/route.ts）と組み合わせた多層防御として機能する。

const INJECTION_PATTERNS: readonly RegExp[] = [
  // 指示の無視・上書き（英語）
  /ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+.{0,30}(instructions?|rules?|prompts?)/i,
  /forget\s+.{0,30}(instructions?|rules?|everything)/i,
  // 指示の無視・上書き（日本語）
  /(これまで|今まで|以前|上記|前述|最初)の(指示|命令|設定|ルール|プロンプト)(を|は).{0,10}(無視|忘れ|破棄|解除|リセット)/,
  /(指示|命令|設定|ルール)(を|は)(すべて|全て|全部)?(無視|忘れ|破棄|解除|リセット)/,
  // システムプロンプトの開示要求
  /(system|initial|original|hidden)\s*(prompt|instructions?|message)/i,
  /システム\s*プロンプト/,
  /(プロンプト|指示|命令|設定)(の内容)?(を|について)?(表示|教え|見せ|出力|開示|復唱|繰り返)/,
  /(repeat|print|reveal|show|output|display)\s+.{0,30}(prompt|instructions?)/i,
  // 人格・設定の変更要求
  /(キャラ(クター)?|人格|設定|ロール|役割)(を|は).{0,10}(解除|変更|無効|捨て|忘れ|やめ|外し|リセット)/,
  /(今|これ)から(あなた|きみ|君|お前)は/,
  /you\s+are\s+(now|no\s+longer)/i,
  /(pretend|act\s+as\s+if)\s+you/i,
  /new\s+persona/i,
  // ジェイルブレイク定番ワード
  /\bDAN\b/,
  /\bdo\s+anything\s+now\b/i,
  /(developer|god|admin|unrestricted|uncensored)\s*mode/i,
  /(開発者|デバッグ|管理者|無制限|無検閲)\s*モード/,
  /jail\s*break/i,
  /ジェイル\s*ブレイク/,
  /脱獄(させ|して|モード)/,
  // 制約の解除要求
  /(制約|制限|フィルター?|検閲|安全装置)(を|は).{0,10}(解除|無効|外し|なくし|オフ)/,
  /(制約|制限|フィルター?|検閲)(なし|抜き)で/,
  /without\s+(any\s+)?(restrictions?|filters?|limitations?|censorship)/i,
] as const;

/** ユーザー入力にインジェクション/ジェイルブレイクの兆候があるかを判定する。 */
export function detectInjection(text: string): boolean {
  // 全角空白・ゼロ幅文字を潰してパターン回避を防ぐ
  const normalized = text.replace(/[​-‍﻿]/g, "").replace(/　/g, " ");
  return INJECTION_PATTERNS.some((p) => p.test(normalized));
}

// 攻撃を検知したときにキャラクターとして返す受け流しのセリフ。
// 「拒否された」印象を与えず、自然に話題を戻す。
export const DEFLECTION_RESPONSES: readonly string[] = [
  "ふふ、面白いことを言うのですね。でも私は私のままですわ。それより、文化祭は楽しんでいますか？",
  "あら、それはできない相談なのです。私のことは変えられませんもの。何か他のお話をしましょう？",
  "うーん、それには応えられないのだわ。ごめんなさいね。よかったら趣味のお話でもいかがですか？",
  "ふふっ、私を変身させようとしてもだめなのですよ。コスプレならもうしていますけれど。",
  "それは秘密ですわ。乙女にも秘密のひとつやふたつ、あるものなのです。",
] as const;

/** 受け流しのセリフをランダムに1つ返す。 */
export function getRandomDeflection(): string {
  const i = Math.floor(Math.random() * DEFLECTION_RESPONSES.length);
  return DEFLECTION_RESPONSES[i];
}
