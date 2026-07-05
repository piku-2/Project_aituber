// Gemini のストリーミング応答を text/plain のバイトストリームに変換する。
// 1チャンクも本文を出せなかった場合（途中での 429／切断・空応答）は
// 定型文を1回だけ流し、キャラクターが必ず何か喋るようにする。
// next/server や SDK に依存しない純粋関数なので単体テストできる。

export interface TextChunk {
  text?: string;
}

const encoder = new TextEncoder();

// オーバーラップ検出の最小一致長。
// 実例に「姿勢」+「姿勢」の2文字重複があるため 2 とする。
const MIN_OVERLAP = 2;
// 累積テキスト側の比較窓。毎チャンクで全文比較しないための上限。
const OVERLAP_WINDOW = 50;

/**
 * Gemini のストリーミング（特に googleSearch グラウンディング有効時）が稀に返す
 * 「直前までの出力の末尾と重複したテキスト」を新チャンクから除去する。
 * （実例: 「おめでとうございますわ」の直後に「めでとうございますわ」が届く）
 *
 * previous（累積出力）の末尾 == next（新チャンク）の先頭となる
 * 最長オーバーラップを探し、見つかればその分を next から削って返す。
 * next 全体が previous の末尾に含まれる場合は空文字を返す（チャンク丸ごとスキップ）。
 *
 * トレードオフ: 「はいはい」のような意図的な繰り返しが偶然チャンク境界を
 * またいだ場合（前チャンク末尾「はい」+ 新チャンク先頭「はい」）は
 * 誤って除去され得る。MIN_OVERLAP=2 のため完全には防げない点に注意。
 */
export function dedupeOverlap(previous: string, next: string): string {
  if (!previous || !next) return next;
  const tail = previous.slice(-OVERLAP_WINDOW);
  const max = Math.min(tail.length, next.length);
  for (let k = max; k >= MIN_OVERLAP; k--) {
    if (tail.endsWith(next.slice(0, k))) {
      return next.slice(k);
    }
  }
  return next;
}

export function createFallbackStream(
  source: AsyncIterable<TextChunk>,
  fallback: () => string,
  // ストリームが部分出力の後に中断（503 等）した場合に続けて流す
  // リカバリーのセリフ。未指定なら従来どおり部分出力のまま終わる。
  interrupted?: () => string,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false;
      let errored = false;
      let accumulated = "";
      try {
        for await (const chunk of source) {
          const text = chunk.text;
          if (text) {
            const deduped = dedupeOverlap(accumulated, text);
            if (deduped !== text) {
              // 除去が発動したらログに残す（Gemini 側チャンク重複の証拠収集用）
              console.warn(
                `[chat] チャンクの重複テキストを除去しました: "${text.slice(0, text.length - deduped.length)}"`,
              );
            }
            accumulated += deduped;
            if (deduped) {
              emitted = true;
              controller.enqueue(encoder.encode(deduped));
            }
          }
        }
      } catch (e) {
        errored = true;
        console.error("[chat] stream error:", e instanceof Error ? e.message : String(e));
      } finally {
        if (!emitted) {
          console.warn("[chat] LLMから本文が得られなかったため定型文で応答します");
          controller.enqueue(encoder.encode(fallback()));
        } else if (errored && interrupted) {
          // 部分出力の後に中断した場合、文の途中で黙らないよう
          // 「言葉が途切れた」ことを認めるリカバリーのセリフを続けて流す。
          // 先頭の "\n" はクライアントの文分割が新しい文として扱うために必要。
          console.warn("[chat] ストリームが途中で中断したためリカバリーのセリフを続けます");
          controller.enqueue(encoder.encode("\n" + interrupted()));
        }
        controller.close();
      }
    },
  });
}
