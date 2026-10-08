# radio-timer v8 📻

送信側（console）と表示側（display）を分離した、ラジオ現場用タイマー。
ver7（Firebase Realtime DB直結・2ファイル）から、TIME-PON方式の軽量ポーリングに正統進化させたもの。

## 何が変わったか

| 項目 | ver7 | v8 |
|---|---|---|
| デザイン | 素の2画面 | 表示側＝放送自動運行システム風（ON AIR・超過・警告色・進行表・テロップ）、送信側＝現代WebAppカードUI |
| 構造 | `config.html` / `display.html` 直書き・重複ロジック | `index / console / display / rooms` + `assets/js|css` 共通化 + `api/room.js` |
| 操作性 | textarea一発＋停止のみ | 表エディタ（追加/削除/並替/確定時刻プレビュー）・プリセット・＋60秒ずらし・再開/リセット・Ctrl+Enter・sticky送信バー |
| 正統進化 | — | 警告色（黄/赤・秒数可変）・超過表示・カウント音・カンペ点滅/のみ表示・演台オンライン監視・QR配布・複数ルーム監視・ショートカット |
| モバイル | 送信側がPC前提（横2列固定・200px入力欄） | レスポンシブ・大ボタン・stickyバー・viewport対応 |
| DB | Firebase RTDB（APIキー直書き） | **Vercel Serverless + KV(Upstash Redis)のポーリングAPI**。未設定でもローカル動作。旧キーは削除済み |
| 運用 | ファイル手渡し | GitHub管理・Vercelホスト前提（`vercel.json`同梱） |

### TIME-PONとの関係
参考リポジトリ [pondashicom/timepon](https://github.com/pondashicom/timepon) は **PHP単一ファイル＋`data/*.json`＋ポーリング＋6桁ID＋adminKey＋QR＋複数ルーム** という構成。
VercelはPHP・永続ファイルシステムを持たないため、そのままは動かない。そこで思想だけ継承し、実装をVercel流に置き換えた：

- `index.php` → `api/room.js`（Node Serverless、JSON per room、ポーリング、adminKey、TTL 7日、レート制限）
- `data/*.json` → **Vercel KV（Upstash Redis）**。未設定時は `/tmp`＋メモリ（ローカルdev用）
- 6桁ID・管理URL（`#k=`）・QR・複数ルーム・ack/hb・点滅/カンペのみ等の現場機能はそのまま移植＋拡張

Firebase維持案は不採用（キー直書きの廃止・ベンダーロック回避のため）。旧ver7は `legacy/config-v7.html` に保存。

## 使い方

- `index.html` … 入口（ルーム作成・入場）
- `console.html` … 送信・設定側（管理キー必要。`?id=XXXXXX#k=...`）
- `display.html?id=XXXXXX` … 表示側（スタジオの大画面・配布用）
- `rooms.html` … 複数ルーム監視（管理キー不要）

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
2. Vercelダッシュボード → **Storage → Create Database → KV** を作成し、プロジェクトに接続（`KV_REST_API_URL / KV_REST_API_TOKEN` が自動設定される）。
3. Redeploy。これで複数端末・複数拠点で同期する。

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
- `GET ?act=get&id=` → `{state, exists, serverNowMs}`
- `POST {act:'set', id, k, cmd:'publish'|'stop'|'resume'|'reset'|'message'|'adjust'|'flags', ...}`
- `POST {act:'setSettings', id, k, warn1Sec, warn2Sec}`
- `POST {act:'hb', id, fs}`（管理キー不要・演台の生存報告）
- state: `{id, state, stopped, events[{title,eventTime,order,mode}], configTime, extraMessage, warn1Sec, warn2Sec, flash, promptOnly, stage{lastSeen,fullscreen,ackMs}}`

## ファイル構成

```
index.html  console.html  display.html  rooms.html  config.html(→consoleへ転送)
assets/js/{store,parse,format,console,display}.js
assets/css/{tokens,console,display}.css
api/room.js  vercel.json  package.json
legacy/config-v7.html  tests/basic.test.js
```
