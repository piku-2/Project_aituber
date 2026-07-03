// Gemini のストリーミング応答を text/plain のバイトストリームに変換する。
// 1チャンクも本文を出せなかった場合（途中での 429／切断・空応答）は
// 定型文を1回だけ流し、キャラクターが必ず何か喋るようにする。
// next/server や SDK に依存しない純粋関数なので単体テストできる。

export interface TextChunk {
  text?: string;
}

const encoder = new TextEncoder();

export function createFallbackStream(
  source: AsyncIterable<TextChunk>,
  fallback: () => string,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false;
      try {
        for await (const chunk of source) {
          const text = chunk.text;
          if (text) {
            emitted = true;
            controller.enqueue(encoder.encode(text));
          }
        }
      } catch (e) {
        console.error("[chat] stream error:", e instanceof Error ? e.message : String(e));
      } finally {
        if (!emitted) {
          console.warn("[chat] LLMから本文が得られなかったため定型文で応答します");
          controller.enqueue(encoder.encode(fallback()));
        }
        controller.close();
      }
    },
  });
}
