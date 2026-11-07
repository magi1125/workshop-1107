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

---

# 設定画面と、書き出し・取り込み

企画書の「作るもの」の2.と3.について決めます。

## ファイル

| ファイル | 役割 |
|---|---|
| `src/options/options.html`、`options.js`、`options.css` | 設定画面（記録の一覧、評価モードの設定、使わないサイト、書き出し、取り込み） |
| `src/lib/settings.js` | ESモジュール。設定の読み書きと、既定でオンのための登録・解除。設定画面、ポップアップ、バックグラウンドで共通 |
| `src/lib/records.js` | ESモジュール。記録の一覧の取得、書き出しのデータの作成、取り込んだデータの検証。設定画面とテストで共通 |

manifest.json には次を加えます。権限（`permissions`）は増やしません。

- `"options_ui": { "page": "src/options/options.html", "open_in_tab": true }`
- `"optional_host_permissions": ["<all_urls>"]`

## 保存の形式

`chrome.storage.local` に次のキーで保存します。

| キー | 値 |
|---|---|
| `r:` で始まるキー | 自分の評価1件（「保存の形式」のとおり） |
| `i:` で始まるキー | 取り込んだ評価1件。キーは `'i:' + JSON.stringify([evaluator, pageUrl, imageKey, name])`。値は自分の評価と同じ項目に、`evaluator`（評価した人。空文字列も可）と `importedAt`（ISO 8601）を加えたもの |
| `settings` | `{ defaultOn, excludedSites, exportedSites }` |

`settings` の各項目は次のとおりです。キーが無い時、項目が無い時は、右の値とみなします。

| 項目 | 内容 | 無い時 |
|---|---|---|
| `defaultOn` | 評価モードを既定でオンにするか | `false` |
| `excludedSites` | 評価モードを使わないサイトのホスト名の配列 | `[]` |
| `exportedSites` | 前回書き出したサイトのホスト名の配列 | `[]` |

「サイト」は、どこでもホスト名（`new URL(url).hostname`）で扱います。

## 使わないサイト

- ポップアップに、表示中のタブのホスト名と、「このサイトでは評価モードを使わない」ボタン（`#exclude`）を表示する。ローカルのファイル（`file:`）では、ホスト名が空になり、登録するとすべてのファイルが対象になってしまうため、`#exclude` を表示しない。登録済みのサイトでは、ボタンの文字を「このサイトで評価モードを使えるようにする」にし、押すと登録を外す
- 登録すると、表示中のタブの評価モードをオフにする
- 登録済みのサイトでは、`altEval:setEnabled` で `enabled: true` を送っても評価モードはオンにならない。返す状態は `{ enabled: false, total: 0, rated: 0, excluded: true }`。`announce` が `true` の時は「このサイトは、評価モードを使わないサイトに登録されています」と読み上げる
- 登録済みのサイトでは、評価を保存しない
- 設定画面の「使わないサイト」の節に、登録したホスト名の一覧（`ul#excluded-list`）と、ホスト名ごとの「登録を外す」ボタンを表示する。登録が無い時は「登録したサイトはありません」と表示する

## 評価モードを既定でオンにする

- 設定画面に、チェックボックス `#default-on`（ラベル「評価モードを既定でオンにする」）を置く
- チェックを付けたら、`chrome.permissions.request({ origins: ['<all_urls>'] })` で許可を求める
  - 許可されたら、`settings.defaultOn` を `true` にし、`chrome.scripting.registerContentScripts` で、id `altEvalAuto`、`matches: ['<all_urls>']`、`js: ['src/content/accessible-name.js', 'src/content/content.js']`、`runAt: 'document_idle'` を登録する
  - 許可されなかったら、チェックを外し、`#default-on-status` に「すべてのサイトへのアクセスが許可されなかったため、既定でオンにできませんでした」と表示する
- チェックを外したら、`settings.defaultOn` を `false` にし、登録を外して、`chrome.permissions.remove({ origins: ['<all_urls>'] })` で権限を返す
- content.js は、読み込まれた時に `settings.defaultOn` が `true` で、使わないサイトに登録されていなければ、読み上げずに評価モードをオンにする
- バックグラウンドは、起動した時と `chrome.permissions.onRemoved` の時に、権限が無いのに `defaultOn` が `true` なら `false` に戻し、登録を外す

## ポップアップ

- これまでの表示に、表示中のタブのホスト名（`#site`）、`#exclude` ボタン、「記録と設定を開く」ボタン（`#open-options`。`chrome.runtime.openOptionsPage()` を呼ぶ）を加える
- `chrome://` のページなど、評価モードを使えないページでは、`#exclude` を表示しない

## 設定画面

`<html lang="ja">`。見出しは `h1`「alt通信簿の記録と設定」、各節は `h2` で、次の順に並べる。

1. 記録（`section#records`）
2. 書き出し（`section#export`）
3. 取り込み（`section#import`）
4. 評価モードの設定（`section#settings`。`#default-on` を含む）
5. 使わないサイト（`section#excluded`）

操作の結果（削除した、書き出した、取り込んだ、など）は `#status`（`role="status"`）に表示する。

### 記録

- 絞り込み：`select#filter-rating`（すべて・良い・悪い。値は `all`・`good`・`poor`）、`select#filter-site`（すべて・ホスト名ごと。値は `all` とホスト名）、`select#filter-source`（すべて・自分・取り込んだ記録。値は `all`・`own`・`imported`）
- 表：`table#records-table`。`caption` に表示中の件数（「12件の記録」）を入れる。列は、評価、名前、ページ、画像、評価した人、日時、操作の順。見出しのセルは `th scope="col"`
  - 評価：「○ 良い」「× 悪い」と文字でも表示する
  - 名前：1行目の文字と同じ表示（`名前：…（altから）` など）
  - ページ：ページのタイトルと、URL。URLは `http:` か `https:` で始まる時だけリンクにする
  - 画像：「画像を表示」ボタン。押した時だけ、その行に画像を読み込んで表示する（埋め込みの画像では「埋め込みの画像」と表示し、ボタンは置かない）
  - 評価した人：自分の記録は「自分」、取り込んだ記録は `evaluator`（空なら「名前なし」）
  - 操作：「削除」ボタン。アクセシブルネームに、行の名前を含める（例：「削除：会社のロゴ」）
- 行は日時の新しい順に並べる
- 記録が無い時は、表の代わりに「記録はまだありません」と表示する
- ページの文字（タイトル、名前、alt、URL）は、すべて `textContent` で表示する

### 書き出し

- 自分の記録（`r:`）のうち、ページのURLが `http:` か `https:` で始まるものだけを書き出す（ローカルのファイルの場所を外に出さないため）
- サイトごとのチェックボックスを `fieldset#export-sites` にまとめる（`legend`「書き出すサイト」）。ラベルは「ホスト名（N件）」。`value` はホスト名
  - `settings.exportedSites` にあるサイトだけ、最初からチェックを付ける
- チェックボックス `#strip-query`（ラベル「URLの ? 以降と # 以降を削る」）。最初からチェックを付ける
- テキスト入力 `#evaluator`（ラベル「評価した人の名前（任意）」）
- `button#export-button`（「書き出す」）。押すと、チェックしたサイトの記録をJSONファイルとしてダウンロードする。ファイル名は `alt-tsushinbo-YYYYMMDD.json`
  - チェックしたサイトが無い時は、ダウンロードせず、`#status` に「書き出すサイトを選んでください」と表示する
  - 書き出したら、`settings.exportedSites` を、今回チェックしたサイトの配列にする
- `#strip-query` にチェックがある時は、`pageUrl`、`imageUrl`、`linkUrl` の `?` 以降と `#` 以降を削る

書き出すファイルの形式：

```json
{
  "format": "alt-tsushinbo",
  "version": 1,
  "exportedAt": "2026-11-07T09:00:00.000Z",
  "evaluator": "",
  "records": [
    { "pageUrl": "", "pageTitle": "", "imageUrl": null, "embedded": false, "category": "named", "name": "", "nameSource": "alt", "altState": "present", "alt": "", "linkUrl": null, "rating": "good", "ratedAt": "" }
  ]
}
```

`records.js` は、`buildExport(records, { sites, stripQuery, evaluator, now })` で上の形のオブジェクトを返す。`records` は `listRecords(storage)` の結果（記録の値に、`key` と `source`（`'own'` か `'imported'`）を加えたもの）で、`source` が `'own'` の記録だけを書き出す。`now` は `Date`。

### 取り込み

- `input#import-file`（`type="file"`、`accept=".json,application/json"`、ラベル「書き出したファイルを選ぶ」）
- ファイルを選んだら、検証してから `i:` のキーで保存し、`#status` に「N件を取り込みました。M件は形式が合わないため取り込みませんでした」と表示する
- ファイル全体の形式が合わない時（JSONでない、`format` が違う、`version` が1でない、`records` が配列でない、5MBを超える）は、何も保存せず「このファイルは取り込めません」と表示する

`records.js` は、`validateImport(data)` で `{ ok, records, rejected, evaluator }` を返す。`ok` はファイル全体の形式が合うか、`records` は取り込める記録の配列（決めた12項目だけを取り出したもの）、`rejected` は取り込まない記録の数、`evaluator` は下の規則で決めた評価した人の名前。1件ごとに次を確かめる。

| 項目 | 条件 |
|---|---|
| `pageUrl` | `http:` か `https:` で始まる文字列。2,000文字以下 |
| `imageUrl`、`linkUrl` | `null`、または `http:` か `https:` で始まる2,000文字以下の文字列 |
| `pageTitle`、`name` | 文字列。1,000文字以下 |
| `alt` | `null`、または文字列。5,000文字以下 |
| `embedded` | 真偽値 |
| `category` | `named`・`empty`・`none`・`hidden` のどれか |
| `nameSource` | `aria-labelledby`・`aria-label`・`alt`・`title`・`none` のどれか |
| `altState` | `present`・`empty`・`missing` のどれか |
| `rating` | `good`・`poor` のどれか |
| `ratedAt` | 文字列。50文字以下 |

ファイルの `evaluator` は、文字列で100文字以下の時だけ使う。それ以外は空文字列にする。

---

# svg要素、role="img"の要素、input type="image"

評価の対象を、`img` 要素のほかに次の要素へ広げます。この節の規則は、上の節の規則より優先します。

## 対象にする要素

| 種類（`element`） | 要素 |
|---|---|
| `img` | `img` 要素 |
| `svg` | `svg` 要素（`role` が無いか、`img`・`graphics-document`・`presentation`・`none` のもの） |
| `role-img` | `role` の最初の値が `img` の要素（`svg` 要素を除く） |
| `input-image` | `input type="image"` |

次の要素は対象にしません。

- ほかの `svg` 要素の中の `svg` 要素
- `role="img"` の要素の中にある、対象の要素（`role="img"` の中身はスクリーンリーダーに伝わらず、外側の要素だけが1枚の画像として伝わるため）
- 評価ボックスの中の要素

`globalThis.AltEvalName` に、要素が対象の候補かを返す `isCandidate(el)` を加えます。`computeName` と `describe` は、上の4種類の要素を受け取ります。

## アクセシブルネーム

| 種類 | 名前を決める順番 |
|---|---|
| `img` | これまでどおり |
| `svg` | `aria-labelledby` → `aria-label` → `role` が `presentation`・`none` なら空 → 子の `title` 要素の文字（`source` は `svg-title`） |
| `role-img` | `aria-labelledby` → `aria-label` → `title` 属性 |
| `input-image` | `aria-labelledby` → `aria-label` → `alt` → `title` 属性 |

`source` の値に `svg-title` を加えます。

`input-image` の名前が空の時（alt属性が無い、または空）は、alt属性があっても `empty` ではなく `none` に分類します。Chromiumは、名前の無い `input type="image"` を読み飛ばさず、「送信」（英語の環境では「Submit」）という決まった名前のボタンとして読み上げるためです。

分類（`category`）の決め方は、これまでどおりです。`svg` と `role-img` には alt が無いため、名前が空なら、`role` が `presentation`・`none` の時は `empty`、それ以外は `none` にします。

## describe の戻り値

これまでの項目に、`element`（上の表の種類）を加えます。`img` 以外の要素では次のようにします。

| 項目 | `svg`・`role-img` | `input-image` |
|---|---|---|
| `alt`、`altState` | `null`、`'missing'` | `img` と同じ |
| `imageUrl`、`embedded` | `null`、`true` | `src` 属性の絶対URL、`false`（`data:`・`blob:` なら `img` と同じ） |

## 1行目の文字

- `named`：`名前：{name}（{出どころ}から）`。出どころは、`svg-title` の時だけ「title要素」と書き、それ以外は `nameSource` の値をそのまま書く
- `none`：`img` はこれまでどおり。`input-image` は `名前なし（「送信」などの決まった名前で読み上げられる場合があります）`。`svg`・`role-img` は `名前なし（「画像」とだけ読み上げられるか、読み飛ばされる場合があります）`
- `hidden`：`img`・`input-image` はこれまでどおり。`svg`・`role-img` は `スクリーンリーダーに伝わらない画像（aria-hidden）。` の後に、名前があれば `名前：{name}`、無ければ `名前なし`。この時の名前は、`aria-hidden` を無視して上の順番で求める

## 保存のキー

`imageKey` を次のようにします。`img` の規則はこれまでどおりです。

| 種類 | `imageKey` |
|---|---|
| `img` | `imageUrl`。`embedded` なら `'embedded'` |
| `input-image` | `img` と同じ |
| `svg`、`role-img` | `'{element}:' + hash`。`hash` は、要素を複製し、自分と子孫の `id`・`class`・`style` 属性を除いた `outerHTML` の先頭4,000文字の FNV-1a（32ビット、UTF-16のコード単位ごと）を、小文字の16進数8桁で表したもの。`id`・`class`・`style` を除くのは、読み込みのたびや、マウスを重ねた時に変わりやすく、保存した評価が表示されなくなるため |

`svg` と `role-img` には画像のURLが無く、名前の無いアイコンが同じページに何個もあると、`'embedded'` では区別できないためです。

## 保存する記録と、書き出し・取り込み

- 記録の値に `element` を加えます（13項目）
- 書き出すファイルの記録にも `element` を入れます。`version` は1のままです
- 取り込みでは、`element` が無い記録は `img` とみなします。ある時は、上の4種類のどれかでなければ取り込みません
- `nameSource` の検証の候補に `svg-title` を加えます
- 取り込んだ記録のキーの `imageKey` は、`embedded` の記録では `'{element}:{ratedAt}'` にする。書き出すファイルには `svg` のハッシュが入らず、同じページの名前の無いアイコンの記録が1件にまとまってしまうため
- 設定画面の記録の表では、画像の列で、`svg`・`role-img` の記録は「画像のURLはありません」と表示する。`empty` の記録の1行目は、`svg`・`role-img` では「読み上げられない画像（role="presentation" か role="none"）」にする
- 設定画面の記録の表では、名前の列で、`img` 以外の記録の1行目の後に「（svg要素）」「（role="img"の要素）」「（input type="image"）」を加えます
