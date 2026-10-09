# STUDIO CUE v9 ◉

スタジオへ、キューを出そう。送信側（console）と表示側（display）を分離した、ラジオ現場用のタイマー＆CUE出しツール。
ver7（Firebase Realtime DB直結・2ファイル）から独自サービスとして刷新したもの。

## 何が変わったか

| 項目 | ver7 | v9 |
|---|---|---|
| デザイン | 素の2画面 | FM局ポップテーマ。表示側＝スタジオの大画面用（ON AIR・超過・警告色・進行表・CUEテロップ）、送信側＝明るいカードUI |
| 構造 | `config.html` / `display.html` 直書き・重複ロジック | `index / console / display / rooms` + `assets/js|css` 共通化 + `api/room.js` |
| 操作性 | textarea一発＋停止のみ | 表エディタ（追加/削除/並替/確定時刻プレビュー）・プリセット・＋60秒ずらし・再開/リセット・Ctrl+Enter・sticky送信バー |
| 即時性 | 約1秒ポーリング | **長時間ポーリング（watch）で変更を検知次第返答**。CUE等の反映は通常1秒以内 |
| 正統進化 | — | 警告色（黄/赤・秒数可変）・超過表示・カウント音・CUE点滅/のみ表示・表示側オンライン確認・CUE受信時刻表示・QR配布・まとめ監視・ショートカット |
| モバイル | 送信側がPC前提（横2列固定・200px入力欄） | レスポンシブ・大ボタン・stickyバー・viewport対応 |
| DB | Firebase RTDB（APIキー直書き） | **Vercel Serverless + Upstash Redis**。旧キーは削除済み |
| 運用 | ファイル手渡し | GitHub管理・Vercelホスト（東京リージョン）前提（`vercel.json`同梱） |

### 設計の由来
遠隔タイマーの先行例（ビューとコントロールの分離・6桁ID・管理キー・QR配布・複数ルーム監視）を参考にしつつ、UI・名称・配色は独自の「STUDIO CUE」として作り直した別サービス。バックエンドはVercel Serverless + Upstash Redisの自前API。

- `api/room.js`（Node Serverless、JSON per room、長時間ポーリング、adminKey、TTL 7日、レート制限）
- 保存先は **Upstash Redis**。未設定時は `/tmp`＋メモリ（ローカルdev用）
- 6桁ID・管理URL（`#k=`）・QR・まとめ監視・生存報告（hb）・点滅/CUEのみ表示等の現場機能を搭載

Firebase維持案は不採用（キー直書きの廃止・ベンダーロック回避のため）。旧ver7は `legacy/config-v7.html` に保存。

## 使い方

- `index.html` … 入口（ルーム作成・入場）
- `console.html` … 送信側（管理キー必要。`?id=XXXXXX#k=...`）
- `display.html?id=XXXXXX` … 表示側（スタジオの大画面・配布用）
- `rooms.html` … まとめ監視（管理キー不要）

番組表の書き方（絶対・相対混在可）：
```
10:40:00 番組開始
5分30秒 コーナー開始
10秒 スタート
```

## ローカル開発

```bash
npm test                 # パース・時刻ロジックのテスト
npx vercel dev           # API含むフル動作（推奨）
# または簡易表示確認のみ:
npx serve . -l 3000
```

## Vercelデプロイ（KVあり＝本番推奨）

1. GitHubにpush（下記）後、Vercelで **Add New Project → Import**。
2. Vercelダッシュボード上部の **Marketplace** で **Upstash for Redis** をインストールし、`radio-timer` に接続（対象環境はProduction＋Preview）。旧来の「Storage → KV」は廃止済みのためこちらを使う。
3. プロジェクトの **Settings → Environment Variables** に `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（または旧名の `KV_REST_API_URL` / `KV_REST_API_TOKEN`）が入ったことを確認。
4. **Redeploy**（環境変数は再デプロイで反映）。`/api/room?act=health` が `{"ok":true,"kv":true}` なら接続成功。これで複数端末・複数拠点で同期する。

KV未接続でも動くが、Vercelのサーバレスはインスタンス毎にメモリが別なため、**本番はKV必須**。未接続時は同一PCデモ・単一インスタンスのみ。

## GitHubへ

```bash
cd radio-timer_ver7.0
git init
git add -A
git commit -m "radio-timer v8: TIME-PON方式に刷新 (Vercel+KV, console/display分離)"
gh repo create radio-timer --public --source=. --push
# ghがなければ: GitHubで空リポジトリ作成 → git remote add origin <URL> → git push -u origin main
```

旧FirebaseのAPIキーはコードから削除済み。Firebaseプロジェクト側でキーの再生成（ローテーション）を推奨。

## API仕様（`api/room.js`）

- `POST {act:'create'}` → `{id, adminKey}`
- `GET ?act=get&id=` → `{state, rev, exists, serverNowMs}`（即時返答）
- `GET ?act=watch&id=&rev=N` → revが変わるまで最大約8.5秒待機して返答（長時間ポーリング）
- `POST {act:'set', id, k, cmd:'publish'|'stop'|'resume'|'reset'|'message'|'adjust'|'flags', ...}`
- `POST {act:'set', id, k, cmd:'sfx', sid:'ue'|'shita'}`（コールサイン再生指示。全端末へ届き、各端末のON/OFFに従い再生）
- `POST {act:'setSettings', id, k, warn1Sec, warn2Sec}`
- `POST {act:'hb', id, fs}`（管理キー不要・表示側の生存報告。revは増やさない）
- state: `{id, state, stopped, events[{title,eventTime,order,mode}], configTime, extraMessage, messageAtMs, warn1Sec, warn2Sec, flash, promptOnly, rev, stage{lastSeen,fullscreen,ackMs}}`

## ファイル構成

```
index.html  console.html  display.html  rooms.html  config.html(→consoleへ転送)
assets/js/{store,parse,format,rows,console,display,callsigns}.js
assets/callsigns/{ue,shita}.wav
assets/css/{tokens,console,display}.css
api/room.js  vercel.json  package.json
legacy/config-v7.html  tests/basic.test.js  tests/watch.test.js
```
