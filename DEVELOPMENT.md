# 開発ガイド

利用者向けの導入・設定は[README](README.md)、生成型のサンプルは[examples](examples/README.md)を参照してください。

## 開発・検証コマンド

Node.js22.18以降を使用し、リポジトリのルートで実行します。

```sh
npm ci
npm run build
```

| コマンド                          | 確認すること                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `npm test`                        | ビルド後、CLI・通信・型生成・生成型のテストを実行                                   |
| `npm run test:types`              | 実装・設定例・サンプルと、設定型・生成型のコンパイルを検査                          |
| `npm run test:coverage`           | c8でCLIの子プロセスを含めて計測し、カバレッジ下限を検査                             |
| `npm run lint` / `npm run format` | Oxlint・Prettierによる検査。自動修正はそれぞれ`:fix`                                |
| `npm run test:package`            | `npm pack`した配布物を一時プロジェクトにインストールし、内容・CLI・公開設定型を検査 |
| `npm run test:performance`        | 保存済み4API、合成50API、多段・循環参照10APIの生成型を測定                          |

実装は`src/`、ビルド先は`dist/`です。通常のテストは保存済みデータと`fetchImpl`のモックを使用し、実サービスへのアクセスやAPIキーは不要です。

開発用TypeScriptは7系、利用者向けの対応範囲は6.0以降です。CIでは6.0.2でも同じ型検査・パッケージ検査を実行します。検証用コンパイラの切り替えには`MICROCMS_TYPESCRIPT_BINARY`へ`tsc`の絶対パスを指定します（ビルド・エディタのコンパイラは変わりません）。

`.npmrc`はSDKと共通で、`engine-strict=true`、`min-release-age=7`、`registry=https://npm.flatt.tech`を設定しています。

## 検証パターンと対応するテスト

### 型生成・CLI・通信

| パターン | 使用データ | 対応するテスト |
| --- | --- | --- |
| 保存済みスキーマからサンプルと同じ型を生成・コンパイル | [schemas.json](examples/schemas.json) → [microcms-types.ts](examples/microcms-types.ts) | [captured-schemas.test.js](test/captured-schemas.test.js) |
| 全フィールドのread・create・update、必須OFF・ONと読み取りオプションの省略・空値・必須項目 | 合成スキーマ、保存済み実APIデータの網羅性確認 | [field-types.test.js](test/field-types.test.js) |
| 共通日時・リストのid・オブジェクトのidなし、拡張データ型、文字列のエスケープ | 合成スキーマ・拡張データ型 | [generated-types.test.js](test/generated-types.test.js)、[generate.test.js](test/generate.test.js) |
| 多段・循環参照、depth:0〜3、3層の繰り返し、fieldIdの絞り込み・不正な書き込み | [tree-schema.json](test/fixtures/tree-schema.json) → 生成型 | [relation-depth.test.js](test/relation-depth.test.js) |
| 型生成結果・フィールドパス、命名衝突、不正スキーマ、参照先・拡張設定の誤り | 合成スキーマ・設定 | [generate.test.js](test/generate.test.js)、[generate-validation.test.js](test/generate-validation.test.js) |
| CLIの引数・設定ファイル・環境変数、satisfies Config、initで既存ファイルを保持 | 設定・一時ファイル | [cli.test.js](test/cli.test.js)、[config-types.test.js](test/config-types.test.js)、[init.test.js](test/init.test.js) |
| generate・check、ファイル保護、改行コード、複数サービスの出力・失敗時の保持 | 設定・一時ファイル、fetchImplのモック | [cli-generation.test.js](test/cli-generation.test.js) |
| API一覧・スキーマ取得のURL・認証・レスポンス検査、エラー・タイムアウト・再試行・キーの非露出 | fetchImpl、時計・タイマーのモック | [management.test.js](test/management.test.js) |

### フィールド種類の網羅

[公式の16種類](https://document.microcms.io/content-api/get-api-field-responses)は、[field-types.test.js](test/field-types.test.js)の`fieldCases`に対応します。セレクトの単一・複数選択を分けた17ケースで、各フィールドの読み取り・作成・更新の期待型とキーの省略可否を明示しています。

| フィールド | スキーマのkind | テストのフィールドID |
| --- | --- | --- |
| テキスト | `text` | `text` |
| テキストエリア | `textArea` | `textArea` |
| リッチエディタ | `richEditorV2` | `html` |
| 旧リッチエディタ | `richEditor` | `legacyHtml` |
| 画像 | `media` | `image` |
| 複数画像 | `mediaList` | `images` |
| 日時 | `date` | `date` |
| 真偽値 | `boolean` | `boolean` |
| セレクト（単一・複数選択） | `select` | `singleSelect`・`multiSelect` |
| コンテンツ参照 | `relation` | `related` |
| 複数コンテンツ参照 | `relationList` | `relatedMany` |
| 数字 | `number` | `number` |
| カスタムフィールド | `custom` | `details` |
| 繰り返し | `repeater` | `blocks` |
| ファイル | `file` | `file` |
| 拡張フィールド | `iframe` | `extension` |

トップレベル・カスタムフィールド内のread・create・updateを、必須OFF、必須ON（既定／読み取りオプション有効）の3構成で照合します。キーの省略・空値・更新時のクリア値・非空配列も検査します。

保存済み実APIデータにも16種類と両セレクト設定があり、値ありレスポンスに上記17項目が含まれることを同じテストで検査します。具体的な値・入力方法ごとの違いは次の実APIテスト、拡張フィールドのdata型指定は[generated-types.test.js](test/generated-types.test.js)、参照深度・多段ネストは[relation-depth.test.js](test/relation-depth.test.js)で確認します。

### 実APIの値と生成型の一致

データは[live-type-matrix.json](test/fixtures/live-type-matrix.json)、テストは[live-schema-values.test.js](test/live-schema-values.test.js)です。マネジメントAPIのスキーマから型を生成し、コンテンツAPIの保存済みレスポンス・書き込み入力をTypeScriptで照合します。空値の違いは実際のキー・値も検査します。

表のデータ名は`reads[].id`のプレフィックスです。書き込みは`writes[]`、APIが拒否した入力は`rejected[]`、CSV入力は`csvInputs[]`、フィールド追加は`schemaChanges[]`に対応します。

| パターン                                                                                                                                         | 対応する保存データ                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 通常フィールドの値あり・省略・空値。文字列、旧／新リッチエディタ、数値、真偽値、日時、選択、画像・複数画像、ファイル、拡張データ、単一・複数参照 | `typegen_matrix_values-{filled,omitted,empty}-depth-*`、`scalar-reset-depth-*`                              |
| 単一・複数参照の`depth: 0`〜`3`、3層の繰り返しと複数種類の要素、ネスト内の空値・参照・拡張データ                                                 | `typegen_matrix_nested-{filled,omitted,empty}-depth-*`                                                      |
| PUTによる作成、PATCHによる部分更新・クリア。兄弟フィールドの保持、ネストの不正入力の拒否                                                         | `writes[]`・`rejected[]`、`scalar-partial-*`、`custom-partial-*`、`nested-empty-values-*`、`nested-reset-*` |
| オブジェクト形式の共通日時・`id`なし、ネストを含む読み取り・PATCH                                                                                | `object-filled-depth-*`、`object-reset-depth-*`、`writes[]`のオブジェクト更新                               |
| 管理画面での通常フィールドの初期空値・入力・クリア。PATCHと異なるキーの省略                                                                      | `ui-values-{initially-empty,filled,cleared}-depth-*`                                                        |
| 管理画面での3層ネストの入力、末端の文字列・数値・真偽値・参照・選択肢のクリア、繰り返し項目全体の削除                                            | `ui-nested-{initially-empty,filled,leaves-cleared,cleared}-depth-*`                                         |
| 管理画面での未入力の拡張フィールドが省略される                                                                                                   | `ui-extension-initially-empty-depth-*`                                                                      |
| POSTの省略入力・CSVの空セルによる作成。既存のPUT省略入力と同じ空値になる                                                                         | `post-empty-typegen_matrix_{values,nested}-depth-*`、`csv-empty-nested-depth-*`、`writes[]`・`csvInputs[]`  |
| 既存コンテンツに任意テキストフィールドを追加し、コンテンツ更新前はキーが省略される                                                               | `field-added-existing-depth-*`、`schemaChanges[]`                                                           |
| 参照先が1件のみの状態で公開終了・再公開。単一参照は`null`、複数参照は`[]`になり、再公開後は復元される。3層ネスト内も同様                         | `single-reference-{published,closed,restored}-depth-*`                                                      |

管理画面でクリアした文字列・数値はキーが省略され、単一参照は`null`、複数参照・選択肢は`[]`でした。空値は入力方法とフィールドの種類で異なるため、[公式の返却値一覧](https://document.microcms.io/content-api/get-api-field-responses#hf57c580171)に対して上記の範囲を検証しています。

### 必須設定・更新範囲

[required-write-values.json](test/fixtures/required-write-values.json)に、`typegen_matrix_required`・`typegen_matrix_nested`のスキーマとPUT・POST・PATCHの50ケースを保存しています。[required-write-values.test.js](test/required-write-values.test.js)でAPIの挙動と成功レスポンスの読み取り型を照合します（実サービスへの通信なし）。

| 確認パターン | fixtureのケースID・記録 |
| --- | --- |
| 必須テキスト・数値の省略／クリアを拒否。初期値による補完なし。PATCHの省略項目は保持 | `create-omit-*`、`post-omit-title`、`{create,update}-clear-*`、`update-only-title` |
| APIは必須真偽値の省略を許可し`false`を返す。必須カスタムへの`{}`も許可し、必須の子が欠ける | `{create,post}-omit-enabled`、`{create,post,update}-clear-details` |
| カスタム内の必須の子を検査し、PATCHでは省略した任意の子を保持。繰り返しは配列全体を置換 | `create-*custom-omit-required-label`、`update-custom-*`、`update-optional-custom-*`、`update-*repeater-*` |
| 繰り返しの最小／最大件数と要素内の必須項目を検査。ネストも同様 | `{create,update}-{repeater,nested-repeater}-count-*`、`create-repeater-omit-required-label`、`update-repeater-{element-label-only,clear-nested-label}` |
| 管理画面は必須カスタムの空入力を下書き保存・公開とも拒否（手動確認） | `uiChecks[]` |

### 型生成ルール

[array-minimum-values.json](test/fixtures/array-minimum-values.json)の22ケースを[array-minimum-values.test.js](test/array-minimum-values.test.js)で検査。必須OFFでも最小件数1の複数参照・繰り返しはPOST・PUTで省略・`[]`・`null`を拒否し、PATCHはキー省略だけ許可して既存値を保持する。管理画面でも未選択の複数参照の下書き保存・公開を拒否する。

- 読み取り：`trustReadFieldConstraints`は省略・`false`でOFF、`true`またはオブジェクトでON。必須・最小件数1以上を信頼し、オブジェクト内の`trustReferenceAvailability: true`で必須単一参照の`null`や必須・最小件数1以上の複数参照の空配列も除く。子の既定は`false`。実データの検査はしない。
- 書き込み：必須設定を常に反映。複数参照・繰り返しの最小件数1以上も作成時にキー必須。更新のトップレベルは省略可能だが、指定したカスタム・繰り返し要素の必須の子は必要。任意のカスタムは更新時に`{}`でクリア可能。
- 配列：必須または最小件数1以上を`[T, ...T[]]`で表す。読み取りの繰り返しは制約の信頼、複数参照は両方の信頼が必要。最小件数のない任意フィールドの省略・空値は維持。通常の`T[]`は1件以上の配列型に代入不可。最小2件以上・最大件数・空文字の制約はAPI側に任せる。初期値による必須項目の省略は許可せず、`0`・`false`は許可する。
- **APIが許可する必須真偽値の省略・必須カスタムへの`{}`も、書き込み型では拒否する。**

[field-types.test.js](test/field-types.test.js)で全17設定を照合し、[required-rules.test.js](test/required-rules.test.js)で入力制約・不正設定、[required-combinations.test.js](test/required-combinations.test.js)で3層の異種繰り返し・オブジェクト形式・実レスポンスとの一致を検査します。[read-reference-rules.test.js](test/read-reference-rules.test.js)では`false`・`true`・空オブジェクト・参照の信頼OFF／ONを深度0〜3・ネスト・両API形式で確認し、書き込み型が変わらないことも検査します。合成スキーマは[required-combinations.mjs](test/helpers/required-combinations.mjs)、サービスごとの設定独立性は[cli-generation.test.js](test/cli-generation.test.js)で確認します。

### 検証方針

旧リッチエディタのobject形式の自動推論、拡張フィールドUI独自のクリア値は検証対象外です。

## SDKとの分担・データ更新

typegenはスキーマ取得と生成型の正しさ、SDKは生成型を使うメソッドの推論・入力制約・型抽出と通信処理を検査します。SDKのデータとテストの対応は、SDKリポジトリの`DEVELOPMENT.md`を参照してください。

生成型の形式を変更した場合は、SDKの`tests/fixtures/typegen/generated/`と利用例の生成型も更新し、SDKの`npm run test:types`を実行します。各リポジトリのCIは単独で動き、隣接リポジトリや未公開の変更には依存しません。

保存データを更新するときは、入力・クエリ・レスポンスの対応を保ち、URL・メールアドレスをダミー化します。APIキーなどの認証情報は保存しません。型検査の共通処理と合成スキーマは`test/helpers/`、性能測定は[scripts/check-type-performance.mjs](scripts/check-type-performance.mjs)にあります。性能は`tsc --extendedDiagnostics`で3回測定し、固定時間での合否判定には使いません。

## カバレッジ・CI・リリース

- [カバレッジ設定](.c8rc.json)：ファイルごとに文・行98%、分岐95%、関数100%。型定義のみのファイルは対象外で、生成型はコンパイルで検査します。レポートは`coverage/index.html`・`lcov.info`・`coverage-summary.json`です。
- [CI](.github/workflows/ci.yml)：Node.js22.18.0・22系・24系でテスト・カバレッジ・型・パッケージを検査。TypeScript6.0.2の互換性とLint・フォーマットも検査し、カバレッジレポートを14日間保存します。
- `test:package`と通常のCIはnpmへ公開しません。公開パッケージ名はスコープなしの`microcms-typegen`です。npmの初期登録用は`0.0.0`（`bootstrap`タグ）、初回正式版は`1.0.0`です。
- [公開ワークフロー](.github/workflows/publish.yml)：`v*`タグで起動し、バージョンの一致・`main`への反映、Lint・フォーマット・テスト・型・配布物を検査してから、Node.js24系でnpmへ`latest`として公開します。初期登録用の`0.0.0`やプレリリース版は対象外です。

### 初回公開

1. 公開ワークフローを`main`へマージし、CIの成功を確認します。
2. npmにログインし、`npm publish --tag bootstrap`で`0.0.0`を初期登録します。
3. npmのパッケージ設定でTrusted Publisherを登録します。Organizationは`microcmsio`、Repositoryは`microcms-ts-typegen`、Workflow filenameは`publish.yml`です。Environmentは空欄にし、`npm publish`を許可します。
4. `package.json`・`package-lock.json`のバージョンを`1.0.0`に変更するPRをマージし、CIの成功後、そのコミットに`v1.0.0`タグを作成・pushします。

公開ジョブだけに`id-token: write`を付与し、GitHubホストのランナーで[Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)を使用します。npmトークンの登録は不要です。npmのTrusted Publisher設定は初回公開の直前に行います。
