# AITuber チャットボット

Live2D キャラクターが VOICEVOX で喋る AITuber チャットボット。
文化祭来場者（在学生・受験生・保護者）向けのデモ用アプリ。

---

## 必要なもの

| ツール | 用途 | 入手先 |
|--------|------|--------|
| Node.js 18以上 | Next.js の実行 | https://nodejs.org |
| VOICEVOX | 音声合成（必須） | https://voicevox.hiroshiba.jp |
| Ollama + qwen3:8b | LLM（Gemini API がない場合） | https://ollama.com |
| Gemini API キー | LLM（任意・優先） | Google AI Studio |

---

## セットアップ

### 1. リポジトリのクローンと依存インストール

```bash
git clone <repo-url>
cd aituber
npm install
```

### 2. 環境変数の設定

`.env.local` をプロジェクトルートに作成する。

```bash
# Gemini API を使う場合（こちらが優先される）
GEMINI_API_KEY=your_api_key_here

# VOICEVOX が WSL から直接アクセスできない場合（Windows IP を指定）
# VOICEVOX_URL=http://<WindowsのIP>:50021
```

> **LLM の切り替えロジック**
> - `GEMINI_API_KEY` が設定されている → Gemini 2.5 Flash を使用
> - 設定されていない → Ollama (qwen3:8b) を使用

### 3. VOICEVOX の起動

Windows で VOICEVOX アプリを起動する。起動するだけで `localhost:50021` が立ち上がる。

**WSL から接続できない場合:**

```bash
# Windows の IP を確認
cat /etc/resolv.conf | grep nameserver | awk '{print $2}'

# 疎通確認
curl http://<上記のIP>:50021/version
```

接続できた IP を `.env.local` の `VOICEVOX_URL` に設定する。

### 4. Ollama を使う場合

```bash
# Ollama をインストール後
ollama pull qwen3:8b
ollama serve
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開く。

---

## 使い方

| 操作 | 説明 |
|------|------|
| テキスト入力 → 送信 | テキストでチャット |
| 🎤 ボタン | 音声入力開始。話し終わると自動送信 |
| 音声出力 | VOICEVOX が起動していれば自動で喋る |

- AI の返答は音声と同期してリアルタイムでテキスト表示される
- 音声出力が終わった瞬間にチャット履歴に確定される

---

## 技術スタック

- **フレームワーク:** Next.js 15 (App Router)
- **言語:** TypeScript
- **スタイル:** Tailwind CSS
- **LLM:** Gemini 2.5 Flash / Ollama qwen3:8b
- **音声合成:** VOICEVOX (localhost:50021)
- **音声入力:** Web Speech API (Chrome / Edge)

---

## ディレクトリ構成

```
app/
  page.tsx          # チャット画面（Live2D + チャット UI）
  api/
    chat/route.ts   # LLM プロキシ（Gemini / Ollama 自動切り替え）
    tts/route.ts    # VOICEVOX プロキシ（現在は未使用・クライアント直接呼び出し）
```
