# 実装とテストの取り決め

評価モードと評価ボックス（企画書の「作るもの」の1.）について、実装とテストの両方が依存する名前と形式を決めます。動作の要件は `docs/proposal.md` に従います。この文書と企画書が食い違う場合は、この文書を直してから実装とテストを直します。

## ファイル

| ファイル | 種類 | 役割 |
|---|---|---|
| `src/content/accessible-name.js` | 通常のスクリプト | アクセシブルネームの計算と分類。`globalThis.AltEvalName` を定義する |
| `src/content/content.js` | 通常のスクリプト | 評価ボックスの挿入、評価の保存、メッセージの受信 |
| `src/lib/tab-control.js` | ESモジュール | 評価モードの状態の取得と切り替え。ポップアップとバックグラウンドで共通 |
| `src/background/background.js` | ESモジュール（service worker） | キーボードショートカットの処理 |
| `src/popup/popup.html`、`popup.js` | ポップアップ | 評価モードの切り替えと件数の表示 |

ページへの挿入は `chrome.scripting.executeScript` で、`files: ['src/content/accessible-name.js', 'src/content/content.js']` の順に行います。何度挿入しても、2回目以降は初期化をやり直しません。

## `globalThis.AltEvalName`

### Chromiumとの既知の違い

自動テストで、Chromiumが計算した名前と比べて見つかった違いです。どちらも名前は空で一致しますが、扱いが違います。

- 空白だけの `alt="   "`：この取り決めでは「空の名前」（読み上げられない）とするが、Chromiumは画像として扱う
- `alt=""` と `title` の両方がある画像：この取り決めでは「空の名前」とするが、Chromiumは名前が空の画像として扱う

`accessible-name.js` は、ページに読み込むだけで次の2つの関数を定義します。テストは、このファイルを単独でページに読み込んで呼び出せます。

### `computeName(img)`

戻り値は `{ name, source, presentational }` です。

- `name`：計算した名前。空白は連続を1つにまとめ、前後を削る
- `source`：`'aria-labelledby'`、`'aria-label'`、`'alt'`、`'title'`、`'none'` のどれか
- `presentational`：`role="presentation"` か `role="none"` で名前が空になった時だけ `true`

計算の順番は次のとおりです。

1. `aria-labelledby` が指す要素（各要素の `aria-label`、無ければ `textContent`）を空白でつないだもの。空なら次へ
2. `aria-label`。空なら次へ
3. `role` が `presentation` か `none` なら、名前は空（`presentational: true`）
4. alt属性があれば、その値。空なら名前は空（`title` は見ない）
5. `title`
6. どれも無ければ、名前は空

### `describe(img)`

戻り値は次のオブジェクトです。

| キー | 値 |
|---|---|
| `category` | `'hidden'`（`aria-hidden="true"` の要素の中）、`'named'`、`'empty'`（名前が空で、alt属性があるか `presentational`）、`'none'`（名前が空で、alt属性が無い）のどれか。`'hidden'` を最初に調べる |
| `name`、`nameSource`、`presentational` | `computeName` の結果 |
| `altState` | `'present'`、`'empty'`（空白だけの場合を含む）、`'missing'` のどれか |
| `alt` | alt属性の値。無ければ `null` |
| `imageUrl` | `currentSrc`（無ければ `src`）。`data:` と `blob:` で始まる場合は `null` |
| `embedded` | `data:` か `blob:` で始まる場合は `true` |
| `linkUrl` | 祖先の `a[href]` の `href`。無ければ `null` |

## 評価ボックスのDOM

- ホスト要素は `<alt-eval-box data-alt-eval="box">` で、`mode: 'open'` のシャドウルートを持つ
- ホスト要素の属性：`data-category`（`describe` の `category`）、`data-mode`（`'inline'` か `'compact'`）
- シャドウルートの中：
  - `p.line`：1行目。`category` が `'named'` の時だけ `aria-hidden="true"`
  - `div[role="group"][aria-label="直前の画像の評価"]`：2つのボタンのグループ
  - `button[data-rating="good"]`、`[data-rating="poor"]`：`type="button"`、`aria-pressed` 付き。アクセシブルネームは「良い」「悪い」。画面には記号「○」「×」だけを表示する（記号は `aria-hidden="true"`）。「良い」「悪い」の文字は、通常表示でも小さい表示でも視覚的に隠す（読み上げには残す）

### 1行目の文字

| `category` | 文字 |
|---|---|
| `named` | `名前：{name}（{nameSource}から）` |
| `empty` | `読み上げられない画像（空のalt）`。`presentational` の時は `読み上げられない画像（role="presentation"）`（`role` の値をそのまま入れる） |
| `none` | `名前なし（ファイル名が読み上げられる場合があります）` |
| `hidden` | `スクリーンリーダーに伝わらない画像（aria-hidden）。` の後に、`alt：{alt}`、`空のalt`、`alt属性なし` のどれか |

### 挿入する位置

企画書の「挿入する位置」の表に従います。挿入の基準になる要素は、次の順で決めます。

1. `img` 要素
2. 親が `picture` 要素なら、`picture` 要素
3. 祖先に `a[href]`、`button`、`summary`、`label`、`[role="button"]`、`[role="link"]` があれば、いちばん外側のもの
4. 3.の要素が `details` 要素の `summary` なら、`details` 要素。`summary` の直後は `details` の中になり、`details` が閉じている間は評価ボックスが表示されず、Tabキーでも届かないため
5. 基準の要素が `aria-hidden="true"` の要素の中にあれば、`aria-hidden="true"` が付いたいちばん外側の要素

同じ基準の要素に複数の画像がある場合（リンクの中に画像が2枚ある場合など）は、評価ボックスを画像と同じ順番で並べます。

### 小さい表示にする条件

- 画像の表示上の幅か高さが48px未満
- 通常表示の評価ボックスが、`overflow` が `hidden` か `clip` の祖先に切り取られる

小さい表示（`data-mode="compact"`）では、次のようにします。

- ホスト要素に `popover="manual"` を付けて最前面に表示する（`:popover-open`）
- 画像の実際に見えている部分（画像の矩形と、`overflow` が `hidden` か `clip` の祖先の矩形の重なり）の左上から、右と下に4pxずらした位置に置く
- 最初から「○」「×」の2つのボタンを表示する。ボタンの大きさは28×28px以上
- 1行目（`p.line`）は、最初は視覚的に隠す（`display: none` は使わず、読み上げには残す）。評価ボックスにマウスを重ねるか、評価ボックスの中にフォーカスがある間だけ表示する。表示している間にEscキーを押すと、マウスが離れるかフォーカスが外れるまで隠す

### 対象にしない画像

画面にも表示されず、スクリーンリーダーにも伝わらない画像は対象にしません。

- 表示されていない画像（`getClientRects()` の数が0。`display: none` など）
- `visibility: hidden` か `visibility: collapse` の画像（カルーセルの表示していないスライドなど）
- `aria-hidden="true"` の要素の中にあり、`overflow` が `hidden` か `clip` の祖先の外に完全に出ている画像（無限に回るカルーセルの複製など）
- ページのシャドウDOMの中の画像、`iframe` の中の画像

## 読み上げ用の領域

`<alt-eval-live data-alt-eval="live">` をbodyの末尾に挿入し、そのシャドウルートの中の `[role="status"]` に文字を入れます。

| 場面 | 文字 |
|---|---|
| オンにした時（`announce` が `true` の時） | `評価モードをオンにしました。画像は{n}枚です` |
| オフにした時（`announce` が `true` の時） | `評価モードをオフにしました` |
| 保存に失敗した時 | `評価を保存できませんでした` |

## メッセージ

`chrome.tabs.sendMessage` で送ります。

| `type` | 送る内容 | 返る内容 |
|---|---|---|
| `altEval:getState` | なし | `{ enabled, total, rated }` |
| `altEval:setEnabled` | `{ enabled, announce }` | `{ enabled, total, rated }` |

`total` は評価ボックスの数、`rated` は評価済みの評価ボックスの数です。

`src/lib/tab-control.js` は、`getState(tabId)` と `setEnabled(tabId, enabled, { announce })` をexportします。評価モードがまだ挿入されていないタブの `getState` は、`{ enabled: false, total: 0, rated: 0 }` を返します。

## 保存の形式

`chrome.storage.local` に、評価1件を1つのキーで保存します。

- キー：`'r:' + JSON.stringify([pageUrl, imageKey, name])`
  - `pageUrl`：`location.href` から `#` 以降を除いたもの
  - `imageKey`：`imageUrl`。`embedded` の時は `'embedded'`
- 値：`{ pageUrl, pageTitle, imageUrl, embedded, category, name, nameSource, altState, alt, linkUrl, rating, ratedAt }`
  - `rating`：`'good'` か `'poor'`
  - `ratedAt`：ISO 8601の文字列

評価を取り消したら、キーを削除します。同じキーの評価ボックスが複数ある場合は、すべての押した状態をそろえます。

## テストの方法

- テストは `node --test tests/` で実行する。Playwrightは `package.json` の `devDependencies` で固定したものを使う
- 自動テストでは `activeTab` の許可を得られないため、拡張機能を一時フォルダにコピーし、コピーのmanifest.jsonにだけ `"host_permissions": ["<all_urls>"]` を加えて読み込む
- バックグラウンドの service worker は、テスト用に `globalThis.altEval = { getState, setEnabled }` を公開する。テストは service worker の `evaluate` から呼び出す
- ポップアップは `popup.html?tabId={id}` で開くと、そのタブを対象にする（指定が無い時は、表示中のタブを対象にする）
- テスト用のページは `tests/fixtures/` に置き、テストの中で起動したHTTPサーバーから配信する
