# AITuber チャットボット

Live2D キャラクターが VOICEVOX で喋る AITuber チャットボット。
文化祭来場者（在学生・受験生・保護者）向けのデモ用アプリ。

---

## 必要なもの

| ツール | 用途 | 備考 |
|--------|------|------|
| Node.js 18以上 | Next.js の実行 | https://nodejs.org |
| VOICEVOX | 音声合成 | https://voicevox.hiroshiba.jp |
| Live2D Cubism Core JS | Live2D モデル描画 | 下記参照（手動ダウンロード必要） |
| Gemini API キー | LLM（優先） | Google AI Studio で取得 |
| Ollama + qwen3:8b | LLM（Gemini がない場合） | https://ollama.com |

---

## セットアップ

### 1. リポジトリのクローンと依存インストール

```bash
git clone <repo-url>
cd aituber
npm install
```

### 2. Cubism Core JS の配置（Live2D 表示に必須）

Live2D モデルの描画には Live2D 公式の Cubism Core JS が必要。
**手動ダウンロードが必要（npm 不可）。**

1. [https://www.live2d.com/download/cubism-sdk/](https://www.live2d.com/download/cubism-sdk/) で「Cubism SDK for Web」をダウンロード（無料アカウント登録が必要）
2. ZIP を展開 → `Core/live2dcubismcore.min.js` を取り出す
3. `public/live2dcubismcore.min.js` に配置

> **バージョン注意:** SDK v4.x または v5.x が必要。v6.x でも動作するが、内部パッチ（`patches/` 配下）を `npm install` 時に自動適用している。

### 3. Live2D モデルの配置

モデルファイルはライセンスの都合により git に含まれていない。チームから別途入手して配置すること。

```
public/
  yachiyo/
    *.model3.json   ← チームから入手
    *.moc3
    *.8192/
    *.physics3.json
    （その他モデルファイル）
```

別のモデルを使う場合は `components/Live2DViewer.tsx` の `MODEL_PATH` を変更する。

### 4. 環境変数の設定

プロジェクトルートに `.env.local` を作成する。

```bash
# Gemini API を使う場合（設定されていれば自動で優先される）
GEMINI_API_KEY=your_api_key_here

# VOICEVOX が WSL から直接アクセスできない場合（Windows の IP を指定）
# VOICEVOX_URL=http://<WindowsのIP>:50021
```

**LLM の自動切り替え:**
- `GEMINI_API_KEY` あり → Gemini 2.5 Flash
- `GEMINI_API_KEY` なし → Ollama qwen3:8b（`localhost:11434`）

### 5. VOICEVOX の起動

Windows で VOICEVOX アプリを起動する。起動するだけで `localhost:50021` が立ち上がる。

**WSL から繋がらない場合（音声が出ない場合）:**

```bash
# Windows 側の IP を確認
cat /etc/resolv.conf | grep nameserver | awk '{print $2}'

# 疎通確認
curl http://<上記のIP>:50021/version
```

繋がった IP を `.env.local` の `VOICEVOX_URL` に設定して `npm run dev` を再起動する。

> VOICEVOX の音声出力はブラウザ（Chrome）から直接 `localhost:50021` を叩くため、Chrome が動く Windows 側からは到達できる。WSL 内の Next.js サーバーは経由しない。

### 6. VOICEVOX の音声設定（任意）

使用するキャラクターやパラメータは `lib/voiceConfig.ts` で変更できる。

```typescript
export const voiceConfig = {
  speakerId: 3,         // localhost:50021/speakers で確認
  speedScale: 1.0,      // 話速
  pitchScale: 0.0,      // 音高
  intonationScale: 1.0, // 抑揚
  volumeScale: 1.0,     // 音量
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
};
```

スピーカーID はブラウザで `http://localhost:50021/speakers` を開くと一覧が確認できる。

### 7. Ollama を使う場合

```bash
ollama pull qwen3:8b
ollama serve
```

### 8. 開発サーバーの起動

```bash
npm run dev
```

ブラウザ（Chrome 推奨）で `http://localhost:3000` を開く。

---

## 使い方

| 操作 | 説明 |
|------|------|
| テキスト入力 → 送信 | テキストでチャット |
| 🎤 ボタン | 音声入力開始。話し終わると自動送信 |
| 音声出力 | VOICEVOX が起動していれば自動で喋る |

- 話している間、認識中のテキストがリアルタイムでチャットに表示される
- AI の返答は音声再生と同期してテキストが徐々に表示される
- 音声出力が終わった瞬間にチャット履歴に確定される
- 音声入力・出力は Chrome / Edge のみ対応

---

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript |
| スタイル | Tailwind CSS |
| LLM | Gemini 2.5 Flash / Ollama qwen3:8b（自動切り替え） |
| 音声合成 | VOICEVOX（ブラウザから直接呼び出し） |
| 音声入力 | Web Speech API |
| Live2D | pixi.js v7 + pixi-live2d-display v0.5.0-beta |

---

## ディレクトリ構成

```
app/
  page.tsx              # チャット画面（Live2D + チャット UI）
  api/
    chat/route.ts       # LLM プロキシ（Gemini / Ollama 自動切り替え）
    tts/route.ts        # VOICEVOX プロキシ（未使用・ブラウザ直接呼び出し）
components/
  Live2DViewer.tsx      # Live2D モデル描画コンポーネント
lib/
  voiceConfig.ts        # VOICEVOX スピーカー・パラメータ設定
patches/
  pixi-live2d-display+v0.5.0-beta.patch  # Cubism Core 6 対応パッチ
public/
  live2dcubismcore.min.js  # Live2D Cubism Core（手動配置）
  yachiyo/                 # Live2D モデルファイル
```
