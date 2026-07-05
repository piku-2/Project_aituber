# 未実装機能 TODO

## 背景画像
- [ ] 大学の教室等を AI 画像生成（生成方法・配置先未定）

## 自発発言
- 不採用（勝手に喋らないよう無効化。トリガー機構・/api/idle ルートを削除済み）

## 特定ワード反応
- [ ] ワード検出 → エフェクト or 動作トリガーの仕組み

## LLM 推論
- [x] WebSearch API 連携（Gemini Google Search Grounding）

## キャラクター
- [ ] VOICEVOX スピーカー ID と話し方の確定（126 種から選択）
- [x] SYSTEM_PROMPT を「夜泊 聖華」に書き換え（app/api/chat/route.ts）

## セキュリティ対策
- [x] プロンプトインジェクション対策（lib/promptGuard.ts で入力検知 + SYSTEM_PROMPT に防御指示 + role 厳格検証）
- [x] ジェイルブレイク対策（DAN・開発者モード・制約解除等の定番パターン検知、キャラとして受け流し）

## SYSTEM_PROMPT 周りの改善
- [x] キャラクター設定のシステムプロンプト周りの改善案を出す（改善版を app/api/chat/route.ts に適用済み。Few-shot例・音声読み上げ対応・文化祭対応・安全性の各セクションを追加）
