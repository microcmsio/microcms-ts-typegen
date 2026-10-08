# 開発ガイド

microcms-typegen自体の開発・検証手順です。利用者向けの導入方法と設定は[README](README.md)、入力スキーマと生成結果のサンプルは[型生成のサンプル](examples/README.md)を参照してください。

## 開発環境

Node.js22.18以降を使用します。リポジトリのルートで依存関係をインストールしてください。

```sh
npm ci
npm run build
```

依存関係のインストールには、SDKと同じ`.npmrc`設定を適用します。

- `engine-strict=true`：依存パッケージの動作環境を満たさない場合はインストールを失敗させます。
- `min-release-age=7`：バージョンの解決時に、公開から7日未満のバージョンを除外します。この設定に対応したnpmが必要です。
- `registry=https://npm.flatt.tech`：SDKと同じレジストリを使用します。

実装は`src/`のTypeScriptです。`npm run build`で`tsconfig.build.json`に従ってJavaScriptと型定義を`dist/`へ生成します。npmには`dist/`と設定例を含め、CLIは`dist/cli.js`を実行します。利用者側でのビルドやTypeScriptのインストールは不要です。

設定ファイルの`process.env`には、開発依存関係の`@types/node`を使用します。ルートの`tsconfig.json`でNode.jsの型を読み込み、実装・設定例・`examples/`をエディタと`npm run test:types`で型検査します。

## テスト

### Lint・フォーマット

SDKと同じOxlint・Prettierを使用します。実装・テスト・検証スクリプト・設定例を対象に、SDKと共通のLintルールと、セミコロンあり・シングルクォートのフォーマット設定を適用します。型検査はTypeScriptで別途行います。生成済みの型や保存済みのJSONスキーマは手動で整形しません。

```sh
npm run lint
npm run format
```

自動修正は`npm run lint:fix`、`npm run format:fix`です。

### ユニットテスト・型検査

```sh
npm test
```

最初に実装をビルドし、ビルド済みJavaScriptを使ってCLI・設定の検証、型生成、生成型のコンパイルを確認します。保存済みのマネジメントAPIスキーマから生成した型と、チェックイン済みのサンプルの一致も検査します。通常のテストはネットワークとAPIキー不要です。

開発用のTypeScriptは`^7.0.2`で7系に揃えています。`npm ci`ではlockfileに記録したバージョンを使用します。利用者向けの対応範囲はTypeScript6.0以降で、開発用コンパイラのバージョンとは別です。設定型・生成型・生成サンプルを確認するには次を実行します。

```sh
npm run test:types
```

ビルドには開発用の`tsc`を使います。`test:types`も最初にビルドしてから、選択したコンパイラで実装・設定例・生成サンプルを型検査し、設定型と生成型のテストを実行します。CIではTypeScript6.0.2を別の一時ディレクトリへインストールし、同じ型検査とインストールしたパッケージの互換性を確認します。ローカルの依存関係には6系を含めません。

テスト・パッケージ確認・性能測定で使うコンパイラを切り替える場合は、`MICROCMS_TYPESCRIPT_BINARY`にCLIの絶対パスを指定します。この指定は`npx tsc`やエディタが使うTypeScriptのバージョンには影響しません。

### カバレッジ

```sh
npm run test:coverage
```

c8でCLIの子プロセスを含む実行時のカバレッジを計測します。このコマンドではインラインソースマップ付きでビルドし、レポートを`src/`のTypeScriptへ対応付けます。通常のビルドとnpm配布にはソースマップを含めません。

`coverage/index.html`でファイルごとの未実行箇所を確認できます。LCOVは`coverage/lcov.info`、集計JSONは`coverage/coverage-summary.json`です。未実行の実装ファイルも集計し、実行処理を持たない型定義のみの`config.ts`・`schema.ts`と、生成したコンテンツ型は集計しません。

`.c8rc.json`でファイルごとに行・文98%、分岐95%、関数100%を下限に設定し、下回る場合はコマンドとCIを失敗させます。カバレッジは実行された処理を示す指標であり、生成型の正しさは出力の照合とTypeScriptのコンパイルで別途検証します。

設定・CLIのエラーとファイル保護は`test/cli.test.js`、マネジメントAPIの入力・レスポンス・HTTPエラー・再試行間隔は`test/management.test.js`、型生成の不正スキーマ・名前・参照は`test/generate-validation.test.js`で追加検証します。文字列のエスケープは`test/generated-types.test.js`で生成結果をTypeScript6・7の両方でコンパイルします。通信は注入した`fetchImpl`でモックし、再試行・リクエスト間隔の検証では時計・タイマーを制御します。実サービスへのアクセスは不要です。

### SDKとの責務分担

| 対象 | 主な責務 |
| --- | --- |
| typegen | config・CLI・スキーマ取得、型の生成、命名、空値、参照の深さ、書き込み形式。保存済みスキーマから生成サンプルを再生成し、出力の一致とコンパイルを検査 |
| SDK | 通信などの実行時処理、手書きと生成済みスキーマによる読み書き・クエリ・型抽出の推論、不正な指定、従来genericsとの互換性、ビルド後の公開型定義と利用例 |

SDKの利用例・連携テスト・SDKを使った性能測定はSDKリポジトリにまとめています。typegen側にSDKの型定義やREADMEのコピーは置きません。SDKの連携テストには生成済み型を保存し、typegenや隣接リポジトリへの依存なしで検査します。

生成結果のサンプルとの一致は[`test/captured-schemas.test.js`](test/captured-schemas.test.js)、多段・循環参照の生成は[`test/relation-depth.test.js`](test/relation-depth.test.js)で確認します。

生成型の出力形式を変更した場合は、SDK側の生成済みスキーマも更新し、SDKの`npm run test:types`で連携を確認してください。各リポジトリの単独CIでは、もう一方の未公開の変更は取得しません。

## 保存済みのスキーマ

[`examples/schemas.json`](examples/schemas.json)は確認用の[typegenサービス](https://typegen.microcms.io/)から取得したAPI一覧と4つのAPIスキーマです。スキーマ内の拡張フィールドURLは公開用のダミーに置き換えています。通常のテストはこの保存済みデータを使い、実サービスにはアクセスしません。型のコンパイルを検査する共通処理は`test/helpers/`にあります。

[`test/fixtures/tree-schema.json`](test/fixtures/tree-schema.json)は、多段・循環参照、カスタムフィールド、繰り返しフィールドを組み合わせた合成スキーマです。

### 実APIによる型生成の確認

[`test/fixtures/live-type-matrix.json`](test/fixtures/live-type-matrix.json)は、2026年10月8日にtypegenサービスのマネジメントAPIから取得した6APIのスキーマと、コンテンツAPIの88件の取得レスポンス・18件の成功した書き込み入力・3件の400エラーの記録です。取得レスポンスのうち32件は、管理画面で入力・公開したコンテンツをGETしたものです（`inputMethod: "management-ui"`）。検証用API・コンテンツを追加して確認し、既存コンテンツは変更していません。画像・ファイルのURLと拡張フィールドの入力UIのURLは`example.com`へ置き換えています。

[`test/live-schema-values.test.js`](test/live-schema-values.test.js)は、このスキーマから型を生成し、保存したレスポンスと書き込み入力をTypeScriptで照合します。APIで拒否されたネスト入力が型エラーになることも検査します。通常のテストでは通信や書き込みを実行せず、APIキーも不要です。

| 確認したパターン | 検証内容 |
| --- | --- |
| 各フィールドの値あり・省略・空値 | テキスト、旧・新リッチエディタ、数値、真偽値、日時、選択、画像・複数画像、ファイル、拡張フィールド、単一・複数参照 |
| 参照の深さ | `depth: 0`〜`3`。単一・複数参照を3API経由で取得し、カスタム・繰り返しの階層が参照の深さを消費しないことを確認 |
| 繰り返しの3段ネスト | 複数種類の要素、空配列、要素内の省略・空値、参照、拡張データ。`fieldId`による型の絞り込みと不正な値・種類の拒否 |
| 作成・更新 | リスト形式のPUT、リスト・オブジェクト形式のPATCH。部分更新による他フィールドの保持、空値への更新、値の復元 |
| 管理画面の入力・クリア | 通常フィールドの初期空値・値あり・クリア後。3段ネスト内の文字列・数値・真偽値・単一／複数参照・選択肢を入力後にクリアし、繰り返し項目全体を削除。各状態を`depth: 0`〜`3`で取得 |
| オブジェクト形式 | 共通日時は返り、`id`は返らないこと。ネストを含む取得・更新。初回コンテンツは管理画面で公開してから検証 |

空文字の返却は、フィールドの種類と位置によって`null`・空文字・省略に分かれます。また、値ありのカスタムフィールドを`{}`で更新すると、今回の構造では`fieldId`と`children: null`が残りました。読み取り型はこうした空値・省略を許容し、テストでは取得時の実際の違いも確認します。拡張フィールドは、書き込み時のメタデータ付き入力に対し、読み取りでは`data`の内容だけが返ることを照合しています。

管理画面でクリアしたテキスト・旧／新リッチエディタ・数値は、PATCHでの空値更新と異なりキーが省略されました。3段ネストの末端でも、文字列・数値のキーは省略、真偽値は`false`、単一参照は`null`、複数参照・選択肢は`[]`でした。初期空値と全体クリア後のカスタムフィールドは`{ fieldId: "section", children: [] }`、繰り返しフィールドは`[]`でした。拡張フィールドは管理画面での未入力時の省略を確認しましたが、ローカル入力UIがアプリ内ブラウザのiframeに表示されなかったため、管理画面で一度入力してからクリアするケースは未確認です。

この記録でAPI仕様全体の網羅を保証するものではありません。POST・CSVからの入力、既存APIへのフィールド追加時の空値、必須設定ごとの保存制約、リッチエディタのobject形式、削除済み・非公開の参照、あらゆる階層・フィールドの組み合わせは、この実API検証の対象外です。循環参照とSDKの`fields`指定は別の回帰テストで検査します。

仕様は公式ドキュメントの[空値と入力方法ごとの返却値](https://document.microcms.io/content-api/get-api-field-responses#hf57c580171)、[繰り返しフィールド](https://document.microcms.io/manual/repeat-field)、[カスタムフィールド](https://document.microcms.io/manual/custom-field)、[コンテンツ更新](https://document.microcms.io/content-api/patch-content)も参照してください。

SDKによる推論と型抽出の検査には、SDK側の`tests/fixtures/typegen/generated/matrix.ts`と`matrix-usage.ts`を使用します。生成型をSDKに渡し、3段ネストの取得・選択・書き込みを検査します。

以前に取得したコンテンツAPIのレスポンス・書き込み入力・更新削除の記録は、SDKリポジトリの`tests/fixtures/typegen/`にあります。取得時に使ったスクリプトは保存していません。データを更新する場合は、取得元・取得日時を維持し、認証情報を保存しないでください。

## CI

[GitHub Actionsの設定](.github/workflows/ci.yml)は`main`へのpush・pull requestと手動実行に対応しています。Node.js22.18.0（対応下限）・22系・24系でテスト、開発用TypeScriptでの型チェック、npmパッケージの確認を実行します。別ジョブでTypeScript6.0.2を使い、設定型・生成型とインストールしたnpmパッケージの互換性を同じ手順で検査します。

別ジョブでLint・フォーマットを検査します。各Node.jsのテストでカバレッジの下限を検査し、HTML・LCOV・集計JSONをActionsのartifactへ14日間保存します。テスト失敗時も生成済みのレポートを保存します。

## publish前のパッケージ確認

```sh
npm run test:package
```

`npm pack`の`prepack`で実装をビルドし、配布用の`.tgz`を作って一時プロジェクトにインストールして確認します。

- ビルド済みJavaScript・設定の型定義・ルートの`LICENSE`など必要な配布ファイルが含まれ、実装のTSソースなど余分なファイルが入っていないこと
- インストールしたCLIの`init`・`generate`・`check`が動くこと
- インストールしたパッケージの`Config`型と`satisfies Config`が選択したTypeScriptで利用できること（ローカルでは7系、CIでは6.0.2でも確認）

API通信は保存済みfixtureで置き換えます。一時ファイルは終了時に削除します。

この確認とCIはpublishを行いません。実際のリリースはレビュー通過後に行います。

## 初回リリースまでの検討事項

- パッケージ名：現在の`microcms-typegen`は候補です。npm上の名前の利用可否、スコープの有無を確認して確定します。
- 公開アカウント：npmアカウント・Organizationと、パッケージの公開権限を準備します。
- リリース用CI：公開の認証方法、タグまたは手動実行によるリリース手順を決めます。現在のCIにはpublish処理を含めていません。

バージョンは初回リリース候補の`1.0.0`です。レビュー通過後、上記を整えて公開します。

## 型チェックの性能確認

```sh
npm run test:performance
```

最初に実装をビルドします。実サービスから保存した4API、50APIの大きなサービス、多段・循環参照を持つ10APIについて、生成した型を`tsc --extendedDiagnostics`で検査します。`depth: 0`〜`3`の型、生成されたフィールドパス、書き込み型を直接参照し、`strict`・`exactOptionalPropertyTypes`を有効にします。SDKやAPI通信は不要です。SDKによるクエリの推論・型抽出の性能測定はSDKリポジトリの`npm run test:performance`に移しています。

選択したTypeScriptコンパイラで3回測定し、入力規模・生成ファイルのサイズ・実行時間・コンパイラの診断情報をJSONで出力します。一時ファイルは終了時に削除します。測定値は環境によって変わるため、CIに固定の時間制限は設けていません。
