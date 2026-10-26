# Simple Timer — Firefox 版

Liquid Glass デザインのシンプルなタイマー拡張機能（Chrome 版 v1.0.0 の Firefox 移植）です。
Chrome 版の UI・機能はそのままに、Firefox で動作させるために必要な変更だけを加えています。

## 動作環境

- Firefox 140 以上（デスクトップ版）
  - `manifest.json` の `data_collection_permissions`（AMO への新規提出で必須の宣言）が Firefox 140 から対応のため、`strict_min_version` を `140.0` にしています。
- Firefox for Android は対象外です（未検証。UI がマウスホイール／矢印キー操作を前提としています）。

## ファイル構成

```
manifest.json     Firefox 用マニフェスト（MV3 / background.scripts / gecko 設定）
background.js     タイマー状態管理・終了検知（イベントページ）
audio.js          終了音の生成・再生（Chrome 版 offscreen.js を流用）
popup.html/.css/.js  ポップアップ UI（HTML・CSS は Chrome 版とバイト同一）
icons/            アイコン（Chrome 版と同一）
build.sh          XPI のビルドスクリプト
tests/mock-test.js  任意: Firefox API をモックした動作テスト（実機テストではありません）
```

## ビルド方法

必要なもの: `zip` コマンド（`bash` 環境）。

```bash
./build.sh            # dist/simple-timer-extension-1.0.0-firefox.xpi を生成
```

手動で作る場合は、**`manifest.json` が ZIP のルートに来るように** ファイルを指定して圧縮します（フォルダごと圧縮しないでください）。

```bash
zip -X -9 simple-timer-extension-1.0.0-firefox.xpi \
  manifest.json background.js audio.js popup.html popup.css popup.js icons/*.png
```

`web-ext` を使う場合（任意）:

```bash
npm install -g web-ext
web-ext lint            # マニフェスト等の検査
web-ext build --overwrite-dest
```

任意の動作テスト（Node.js 18 以上。Firefox 自体は不要）:

```bash
node tests/mock-test.js
```

## インストール方法

### A. 動作確認用（一時的な読み込み・署名不要）

1. Firefox で `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む…」をクリック
3. ソース ZIP を展開したフォルダの `manifest.json`（または `.xpi`）を選択

※ Firefox を終了すると削除されます。

### B. 一般配布用（署名済み XPI）

リリース版 Firefox では、Mozilla が署名した XPI のみ恒久インストールできます。
本リポジトリの `.xpi` は署名前のため、次のいずれかで署名してください。

- **AMO（addons.mozilla.org）の開発者ハブ**で「自分で配布する（非公開／unlisted）」を選び、XPI（または ZIP）をアップロード → 署名済み XPI をダウンロード
- または `web-ext sign --channel=unlisted --api-key=... --api-secret=...`

署名済み XPI は、Firefox の「ファイルからアドオンをインストール」またはリンクのクリックでインストールできます。

### C. 署名なし XPI を使える環境

Firefox Developer Edition / Nightly / ESR / 非ブランド版では、`about:config` の
`xpinstall.signatures.required` を `false` にすると署名なし XPI をインストールできます（リリース版では不可）。

## Chrome 版との違い

| 項目 | Chrome 版 | Firefox 版 |
| --- | --- | --- |
| バックグラウンド | `background.service_worker` | `background.scripts`（イベントページ）: `["audio.js", "background.js"]` |
| API 名前空間 | `chrome.*` | `browser.*`（Promise 版 API）。`chrome.*` → `browser.*` の置換のみ |
| 終了音の再生 | `offscreen` ドキュメントを生成し、メッセージで再生/停止を指示 | Firefox に offscreen API が無いため、`audio.js` を背景ページ内で直接呼び出し |
| 追加/削除ファイル | `offscreen.html`, `offscreen.js` | 削除（音生成ロジックは `audio.js` に流用） |
| permissions | `storage`, `alarms`, `offscreen` | `storage`, `alarms`（`offscreen` は Firefox に存在しないため削除） |
| マニフェスト追加 | — | `browser_specific_settings.gecko`（`id` / `strict_min_version: 140.0` / `data_collection_permissions: none`） |
| UI（HTML/CSS/アイコン） | — | 変更なし（Chrome 版とバイト同一） |

タイマーのロジック（アラーム + `setTimeout` の二重化、`storage.local` での状態保持、バッジ表示、
起動時の再スケジュール）は Chrome 版と同じです。

> **拡張機能 ID について**: `simple-timer@stone-block9965` は移植時に仮置きした ID です。
> AMO で一度署名すると同じ ID で更新を出し続ける必要があるため、変えたい場合は **初回署名の前** に
> `manifest.json` の `browser_specific_settings.gecko.id` を編集してください。

## 動作確認状況

### 確認済み（Firefox 実機ではなく、静的検査とモックによる検証）

- `manifest.json` の構文、必須項目（`background.scripts`、`gecko.id`、`data_collection_permissions`、`strict_min_version` ≥ 140）、参照ファイルの存在
- JavaScript の構文チェック、`chrome.*` / `offscreen` 参照の残存なし
- `popup.html` / `popup.css` / アイコンが Chrome 版とバイト同一
- Firefox API（`browser.*`）のモックを用いた 15 項目のテスト（`tests/mock-test.js`）
  - 開始 → アラーム/終了検知 → バッジ `END` → 終了音（4 回 × 3 音）の再生要求 → 停止・リセット・リスタート
  - 終了時刻前の早すぎるアラームの無視、`setTimeout` 保険経由の終了、起動時の再スケジュール
  - ポップアップの表示・ホイール/矢印キー操作・ボタン切り替え・`timerEnded` の 1 回送信

### 未確認（Firefox 実機での確認が必要）

- [ ] `about:debugging` で一時読み込みでき、マニフェストの警告が出ないこと
- [ ] ツールバーアイコンとポップアップの見た目（背景ぼかし・縁のハイライト・400×600 のレイアウト、スクロールバーが出ないこと）
- [ ] 実際の音声出力（終了音が鳴ること。Firefox のソースコード上、拡張機能ページを自動再生ブロックの対象外にする分岐（設定項目で制御）があることは確認したが、既定値と実機での再生は未検証）
- [ ] ポップアップを閉じてもタイマーが継続し、終了時にバッジ `END` と終了音が出ること
- [ ] イベントページが停止した後（数分以上のタイマー）でも、アラームで終了を検知できること
- [ ] 「終了」「リスタート」ボタンで音が止まる／再開すること
- [ ] Firefox の再起動をまたいだタイマー
- [ ] 署名済み XPI をリリース版 Firefox にインストールできること
