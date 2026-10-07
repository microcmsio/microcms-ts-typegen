# 開発ガイド

microcms-typegen自体の開発・検証手順です。利用者向けの導入方法と設定は[README](README.md)、入力スキーマと生成結果のサンプルは[型生成のサンプル](examples/README.md)を参照してください。

## 開発環境

Node.js22.18以降を使用します。リポジトリのルートで依存関係をインストールしてください。

```sh
npm ci
npm run build
```

実装は`src/`のTypeScriptです。`npm run build`で`tsconfig.build.json`に従ってJavaScriptと型定義を`dist/`へ生成します。npmには`dist/`と設定例を含め、CLIは`dist/cli.js`を実行します。利用者側でのビルドやTypeScriptのインストールは不要です。

設定ファイルの`process.env`には、開発依存関係の`@types/node`を使用します。ルートの`tsconfig.json`でNode.jsの型を読み込み、実装・設定例・`examples/`をエディタと`npm run test:types`で型検査します。

## テスト

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

コンテンツAPIの読み取りレスポンス・書き込み入力・更新削除の記録は、SDKリポジトリの`tests/fixtures/typegen/`へ移しています。取得時に使ったスクリプトは保存していません。データを更新する場合は、取得元・取得日時を維持し、認証情報を保存しないでください。

## CI

[GitHub Actionsの設定](.github/workflows/ci.yml)は`main`へのpush・pull requestと手動実行に対応しています。Node.js22.18.0（対応下限）・22系・24系でテスト、開発用TypeScriptでの型チェック、npmパッケージの確認を実行します。別ジョブでTypeScript6.0.2を使い、設定型・生成型とインストールしたnpmパッケージの互換性を同じ手順で検査します。

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
