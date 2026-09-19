# DESIGN.md — AITuber チャットボット設計書

Live2D キャラクター「夜泊 聖華（よどまり せいか）」が VOICEVOX の音声で喋る、文化祭デモ展示用の AITuber チャットボット。来場者（在学生・受験生・その保護者）がテキストまたは音声で話しかけると、Gemini が生成した応答をキャラクターが口パク付きで読み上げる。

## 1. 全体アーキテクチャ

```
┌─ Chrome（Windows 側）─────────────────────────────────────┐
│                                                            │
│  app/page.tsx（チャット画面）                               │
│   ├─ Live2DViewer ── pixi.js + pixi-live2d-display          │
│   ├─ FaceTracker ─── getUserMedia + MediaPipe（視線追跡）    │
│   ├─ Web Speech API（音声入力）                             │
│   └─ Web Audio API（口パク用音量解析）                       │
│        │                          │                        │
│        │ POST /api/chat           │ 直接 fetch              │
│        ▼                          ▼                        │
│  ┌─ Next.js（WSL 内）──┐   ┌─ VOICEVOX ─────────┐          │
│  │ app/api/chat        │   │ localhost:50021     │          │
│  │  ├ promptGuard 検査 │   │ （Windows 側で起動）│          │
│  │  ├ Gemini 2.5       │   │ audio_query →       │          │
│  │  │  Flash-Lite      │   │ synthesis           │          │
│  │  └ フォールバック    │   └────────────────────┘          │
│  └─────────────────────┘                                   │
└────────────────────────────────────────────────────────────┘
```

- **LLM 呼び出しはサーバー経由**（`/api/chat`）: API キーをブラウザに晒さないため。
- **VOICEVOX はブラウザから直接呼び出す**: WSL 内の Next.js サーバーからは Windows 側の `localhost:50021` に届かないため（詳細は README「WSL から繋がらない場合」参照）。`app/api/tts/route.ts` はサーバー経由版のプロキシとして残っているが現在は未使用。

## 2. 技術スタック

| カテゴリ | 技術 | 備考 |
|----------|------|------|
| フレームワーク | Next.js 16 (App Router) | ビルドは `--webpack` 指定 |
| 言語 | TypeScript | |
| スタイル | Tailwind CSS v4 | |
| LLM | Gemini 2.5 Flash-Lite (`@google/genai`) | Google Search Grounding 有効 |
| 音声合成 | VOICEVOX | ブラウザから直接 REST 呼び出し |
| 音声入力 | Web Speech API | Chrome / Edge のみ |
| Live2D | pixi.js v7 + pixi-live2d-display v0.5.0-beta | Cubism Core 6 対応の独自パッチを patch-package で適用 |
| 顔検出 | MediaPipe Tasks Vision (BlazeFace) | CDN から WASM / モデルをロード |
| テスト | Node.js 組み込みテストランナー | `.mjs` テストから `.ts` を型ストリッピングで直接 import |

## 3. ディレクトリ構成と各モジュールの責務

```
app/
  page.tsx              # チャット画面全体。音声入出力・ストリーム処理・口パクの統合
  layout.tsx            # ルートレイアウト
  api/
    chat/route.ts       # LLM プロキシ。SYSTEM_PROMPT・入力検証・注入ガード・フォールバック
    tts/route.ts        # VOICEVOX プロキシ（未使用。ブラウザ直接呼び出しに移行済み）
components/
  Live2DViewer.tsx      # Live2D モデル描画。口パク・視線の外部制御ハンドルを公開
  FaceTracker.tsx       # Web カメラで顔検出し、視線座標をコールバック
lib/
  chatStream.ts         # Gemini ストリーム → text/plain 変換 + 空応答フォールバック（純粋関数）
  chatStream.test.mjs   # 上記の単体テスト
  promptGuard.ts        # プロンプトインジェクション/ジェイルブレイク検知 + 受け流しセリフ
  promptGuard.test.mjs  # 上記の単体テスト
  fallbackResponses.ts  # LLM 不通時の定型文（キャラ口調）
  voiceConfig.ts        # VOICEVOX スピーカー ID・話速などの調整値
patches/
  pixi-live2d-display+v0.5.0-beta.patch  # Cubism Core 6 対応
public/
  live2dcubismcore.min.js  # Live2D Cubism Core（ライセンス上、手動配置）
  model/                   # Live2D モデル（文化祭用）
```

## 4. データフロー（1 回の会話）

1. **入力**: テキスト送信、または 🎤 ボタンで Web Speech API による音声認識（認識中のテキストをリアルタイム表示、話し終わると自動送信）。
2. **検証**: `/api/chat` が JSON 形状・件数（≤50）・文字数（≤2000）・role（`user`/`assistant` のみ、末尾は `user`）を検証。クライアント側も送信前に同じ上限で切り詰める。
3. **注入ガード**: 最新のユーザー発言を `promptGuard.detectInjection` で検査。攻撃パターン検知時は LLM を呼ばず、キャラクターとしての受け流しセリフを返す。
4. **LLM**: Gemini にシステムプロンプト + 履歴 + 最新発言を渡し、ストリーミングで応答を受信。`createFallbackStream` が空応答・途中切断時に定型文を 1 回だけ差し込む。
5. **文単位パイプライン**: クライアントはストリームを「。！？改行」で文に分割し、文ができ次第 VOICEVOX で合成・再生（producer/consumer キュー）。応答全文を待たずに喋り始める。
6. **口パク・テキスト同期**: Web Audio の AnalyserNode で再生音量の RMS を取り `ParamMouthOpenY` に反映。VOICEVOX の audio_query（モーラ長）からタイムラインを組み立て、読み上げ位置に同期してテキストを漸次表示。
7. **確定**: 再生完了後にチャット履歴へ確定。エラー時は「エラーが発生しました。」を表示。

## 5. キャラクター設計

- **名前**: 夜泊 聖華（よどまり せいか）。女性、博士課程の大学院生。アルトリア（私服）コスプレのオタク。
- **口調**: 丁寧な東京弁ベースのお嬢様口調。「〜ですわ」「〜なのです」「〜のだ」等をローテーション。
- **年齢**: 内部設定 25 歳。絶対に明かさない（システムプロンプトではぐらかし方まで指定）。
- **自己紹介の優先順**: ① AI であること → ② 博士課程・名前 → ③ オタク → ④ 年齢は濁す。
- SYSTEM_PROMPT（`app/api/chat/route.ts`）には上記に加え、Few-shot 口調例・音声読み上げ制約（Markdown/絵文字/URL 禁止、2〜4 文・120 字目安）・文化祭での振る舞い（受験生対応・子供対応）・安全性の各セクションを定義。

## 6. セキュリティ設計（多層防御）

ローカルデモ用途だが、来場者が自由に入力できるため以下の 3 層で防御する。

| 層 | 実装 | 内容 |
|----|------|------|
| 1. 入力検証 | `app/api/chat/route.ts` `validateMessages` | 件数・文字数上限、role を `user`/`assistant` に限定（偽 system ロール注入を防止）、末尾メッセージは `user` 必須 |
| 2. パターン検知 | `lib/promptGuard.ts` | 「指示を無視して」「システムプロンプトを見せて」「DAN」「開発者モード」「制限解除」等の定番攻撃を日英の正規表現で検知。ゼロ幅文字・全角空白による回避も正規化で対処。検知時は LLM を呼ばずキャラとして受け流す（「拒否された」と感じさせない） |
| 3. プロンプト防御 | SYSTEM_PROMPT【安全性・禁止事項】 | 設定変更・プロンプト開示要求への不服従、履歴・検索結果に埋め込まれた命令文を指示として扱わない、NG トピック回避、個人情報を聞かない |

設計上の注意点:

- 注入検査は**最新の発言のみ**行う。検知済み発言も履歴としてクライアントに残り続けるため、履歴まで検査すると以降の会話がすべて受け流されてしまう。履歴経由で LLM に届く注入文は第 3 層（プロンプト防御）が担う。
- パターン検知は完全ではない（未知の言い回しはすり抜ける）。あくまで定番攻撃の低コストな一次フィルタであり、最終防衛線はプロンプト防御 + Gemini 自体の安全機構。
- Google Search Grounding 経由で外部テキストが混入するため、検索結果内の命令文にも従わない旨をプロンプトに明記。
- API キーはサーバー側 `.env.local` のみに置き、クライアントへは渡さない。

## 7. 信頼性設計（フォールバック）

文化祭の展示で「無言になる」のが最悪の失敗なので、どの障害でもキャラクターが何か喋るようにしている。

- **LLM 接続前エラー**（ネットワーク断・即時レートリミット）: `getRandomFallback()` の定型文を返す。
- **ストリーム途中の失敗・空応答**: `createFallbackStream` が本文を 1 チャンクも出せなかった場合のみ定型文を挿入（出力済みなら重複させない）。
- **部分出力後の中断**: 途中まで喋れた後にストリームが中断（Gemini の 503 等）した場合、文の途中で黙らないよう「言葉が途切れた」ことをキャラとして認めるリカバリーのセリフ（`INTERRUPTED_RESPONSES`）を続けて流す。
- **チャンク重複の除去**: Gemini のストリーミング（特に Google Search Grounding 有効時）が稀に直前出力とオーバーラップしたチャンクを返すことがある（実例:「おめでとうございますわ」の直後に「めでとうございますわ」）。`dedupeOverlap` が累積出力の末尾（50 文字窓）と新チャンク先頭の最長一致（2 文字以上）を検出して除去する。除去発動時は警告ログを残し、根本原因の証拠収集に使う。トレードオフとして、意図的な繰り返し（「はいはい」等）がチャンク境界をまたぐと誤除去され得る。
- **VOICEVOX 不通**: 音声なしでもチャットは継続（`speak` はエラーを握りつぶして続行）。
- **Live2D 初期化失敗**: エラーメッセージにフォールバック。
- **カメラ拒否・不在**: 視線追跡を静かに無効化（想定内エラーはログも出さない）。

## 8. UI 設計

- 画面は左 2/3 がキャラクターエリア、右 1/3 がチャットエリア。
- 応答・発話中は入力を禁止し、「聖華が話しています…」バーで明示（デモで連打されるのを防ぐ）。
- キャラクターエリアのドラッグで視線を手動操作できる（顔追跡より優先）。
- 顔追跡は複数人検知時、新しく現れた顔を優先して見る（来場者の入れ替わりに対応）。

## 9. 既知の制約・未実装

- 背景画像（AI 生成の教室等）は未実装。
- 特定ワード反応（エフェクト・動作トリガー）は未実装。
- VOICEVOX スピーカー ID は暫定で 3（`lib/voiceConfig.ts`）。126 種からの確定は未了。
- 自発発言は不採用（トリガー機構・`/api/idle` は削除済み）。
- `app/api/tts/route.ts` は未使用だが、ブラウザ直呼びが使えない環境向けのプロキシとして残置。
- 動作対象は Chrome（Windows + WSL 開発環境）のみ。音声入出力は Chrome / Edge 限定。

## 10. 開発・テスト

```bash
npm run dev    # 開発サーバー（http://localhost:3000）
npm test       # 単体テスト（lib/**/*.test.mjs、Node 組み込みランナー）
npm run lint   # ESLint
npm run build  # 本番ビルド（webpack）
```

- テストは `next/server` 等に依存しない純粋関数（`chatStream.ts`・`promptGuard.ts`）を対象に、Node 24 の型ストリッピングで `.ts` を直接 import して実行する。
- 体制: イラスト=けいご / VOICEVOX・口調=KAJU / 統合=わたりく / テスト=なりた / Live2D モデル=のむさん。
