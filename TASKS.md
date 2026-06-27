# 未実装機能 TODO

## 背景画像
- [ ] 大学の教室等を AI 画像生成（生成方法・配置先未定）

## 顔認識・カメラ
- [x] getUserMedia でカメラ取得
- [x] MediaPipe で顔検出
- [x] 検出した顔位置を Live2D の視線パラメータにマップ
- [x] 複数人検出時は後から検知した人を優先

## 自発発言
- 不採用（勝手に喋らないよう無効化。トリガー機構・/api/idle ルートを削除済み）

## 特定ワード反応
- [ ] ワード検出 → エフェクト or 動作トリガーの仕組み

## LLM 推論
- [x] WebSearch API 連携（Gemini Google Search Grounding）

## キャラクター
- [ ] VOICEVOX スピーカー ID と話し方の確定（126 種から選択）
- [ ] SYSTEM_PROMPT を「ずんだもん」から「夜泊 聖華」に書き換え（app/api/chat/route.ts）
