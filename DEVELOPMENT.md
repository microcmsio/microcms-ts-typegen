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

| パターン                                                                                                             | 使用データ                                                                                       | 対応するテスト                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| スキーマからの生成結果がサンプルと一致し、コンパイルできる                                                           | [examples/schemas.json](examples/schemas.json) → [microcms-types.ts](examples/microcms-types.ts) | [captured-schemas.test.js](test/captured-schemas.test.js)                                                                                                        |
| 各フィールド型・空値・共通日時、リストの`id`、オブジェクトの`id`なし、拡張データのread/write、文字列のエスケープ     | テスト内の合成スキーマ・拡張データ型                                                             | [generate.test.js](test/generate.test.js)、[generated-types.test.js](test/generated-types.test.js)                                                               |
| 多段・循環参照、`depth: 0`〜`3`の境界、3層の繰り返し、`fieldId`の絞り込み・不正な書き込み                            | [tree-schema.json](test/fixtures/tree-schema.json) → テスト内で生成した型                        | [relation-depth.test.js](test/relation-depth.test.js)                                                                                                            |
| 命名衝突、不正・未対応のスキーマ、欠落した参照先、エンドポイント選択、拡張フィールド設定の誤り                       | テスト内の合成スキーマ・設定                                                                     | [generate-validation.test.js](test/generate-validation.test.js)、[generate.test.js](test/generate.test.js)                                                       |
| `satisfies Config`、環境変数、複数サービス、init・generate・check、上書き保護、設定・ファイルのエラー                | テスト内の設定・一時ファイル                                                                     | [config-types.test.js](test/config-types.test.js)、[init.test.js](test/init.test.js)、[cli.test.js](test/cli.test.js)、[generate.test.js](test/generate.test.js) |
| API一覧・スキーマ取得のURL・認証・レスポンス検査、HTTP／ネットワークエラー、タイムアウト、再試行・間隔、キーの非露出 | `fetchImpl`、時計・タイマーのモック                                                              | [management.test.js](test/management.test.js)、[generate.test.js](test/generate.test.js)                                                                         |

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

### 検証方針

管理画面の必須設定を根拠に、生成型から空値・省略を除外しません。必須項目の保存バリデーションと、旧リッチエディタのobject形式の自動推論、拡張フィールドUI独自のクリア値は検証対象外です。

## SDKとの分担・データ更新

typegenはスキーマ取得と生成型の正しさ、SDKは生成型を使うメソッドの推論・入力制約・型抽出と通信処理を検査します。SDKのデータとテストの対応は、SDKリポジトリの`DEVELOPMENT.md`を参照してください。

生成型の形式を変更した場合は、SDKの`tests/fixtures/typegen/generated/`と利用例の生成型も更新し、SDKの`npm run test:types`を実行します。各リポジトリのCIは単独で動き、隣接リポジトリや未公開の変更には依存しません。

保存データを更新するときは、入力・クエリ・レスポンスの対応を保ち、URL・メールアドレスをダミー化します。APIキーなどの認証情報は保存しません。型検査の共通処理は`test/helpers/`、性能測定は[scripts/check-type-performance.mjs](scripts/check-type-performance.mjs)にあります。性能は`tsc --extendedDiagnostics`で3回測定し、固定時間での合否判定には使いません。

## カバレッジ・CI・リリース

- [カバレッジ設定](.c8rc.json)：ファイルごとに文・行98%、分岐95%、関数100%。型定義のみのファイルは対象外で、生成型はコンパイルで検査します。レポートは`coverage/index.html`・`lcov.info`・`coverage-summary.json`です。
- [CI](.github/workflows/ci.yml)：Node.js22.18.0・22系・24系でテスト・カバレッジ・型・パッケージを検査。TypeScript6.0.2の互換性とLint・フォーマットも検査し、カバレッジレポートを14日間保存します。
- `test:package`とCIはnpmへ公開しません。初回バージョンは`1.0.0`。レビュー後の公開に向け、パッケージ名の最終確認、npmのアカウント・公開権限、認証方法とリリース用CIを整えます。
