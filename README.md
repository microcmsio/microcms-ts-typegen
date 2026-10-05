# microcms-typegen

microCMSのマネジメントAPIスキーマから、`microcms-js-sdk`で使うTypeScript型を生成するCLIです。

## 保守方針

このツールの現在の保守レベルは`Active`です。

詳細は[SDKの保守方針](https://document.microcms.io/manual/limitations#h8e929adf81)をご覧ください。

## 動作環境

- Node.js 22.18+
- TypeScript 6.0+（設定ファイル・生成型を型検査する場合）

CLIの実行自体にTypeScriptのインストールは不要です。

## 使い方

### npmから利用する

> [!NOTE]
> npm公開後の利用手順です。公開前は下記のリポジトリからの手順で試してください。

#### 1. 初期設定を作成する

導入するプロジェクトのルートで実行します。

```sh
npm install -D microcms-typegen
npx microcms-typegen init
```

`init`は実行したディレクトリに`microcms-typegen.config.ts`を作成します。既存ファイルは上書きせずスキップします。作成後は出力先を確認してください。

#### 2. 環境変数を設定する

[「API情報の取得」権限](https://document.microcms.io/management-api/get-api-info)を持つAPIキーを用意し、プロジェクトの`.env`に設定します。既存の`.env`がある場合は、必要な項目を追加してください。

```dotenv
MICROCMS_SERVICE_DOMAIN=your-service
MICROCMS_API_INFO_API_KEY=your-api-info-api-key
```

#### 3. 型を生成・確認する

型を生成します。

```sh
npx microcms-typegen generate
```

生成済みの型と現在のAPIスキーマの差分を確認する場合は、`check`を実行します。

```sh
npx microcms-typegen check
```

### リポジトリから利用する（暫定）

npm公開前に試すための手順です。クローンしたディレクトリ内で実行します。

#### 1. リポジトリを取得して初期設定を作成する

```sh
git clone https://github.com/microcmsio/microcms-ts-typegen.git
cd microcms-ts-typegen
```

PRのレビュー時は、ここで対象PRのブランチをチェックアウトしてから進めてください。

```sh
npm ci
node src/cli.js init
```

作成した`microcms-typegen.config.ts`の出力先を確認してください。

#### 2. 環境変数を設定する

クローンしたディレクトリの`.env`にサービスIDとAPIキーを設定します。必要な権限と変数名は、上記の[環境変数の設定](#2-環境変数を設定する)と同じです。

#### 3. 型を生成・確認する

```sh
node src/cli.js generate
node src/cli.js check
```

### コマンドの役割

| コマンド | 説明 |
| --- | --- |
| `init` | 最小限のTypeScript設定ファイルを作成。既存ファイルはスキップ |
| `generate` | 現在のAPIスキーマから型ファイルを生成・更新 |
| `check` | 生成済みの型と現在のAPIスキーマを比較。差分やファイルの欠落があれば終了コード`1` |

`check`はファイルを変更しないため、CIでも利用できます。

## 設定ファイル

設定ファイルはES modules形式のTypeScript（`.ts`）のみ対応しています。`package.json`で`"type": "commonjs"`を明示しているプロジェクトでの設定読み込みには対応していません。

作業ディレクトリの`microcms-typegen.config.ts`を自動で読み込みます。設定ファイルの`services`にサービスごとの設定を記述します。[設定例](microcms-typegen.config.example.ts)は次の形式です。

```ts
import type { Config } from 'microcms-typegen';

export default {
  services: {
    main: {
      serviceDomain: process.env.MICROCMS_SERVICE_DOMAIN,
      apiKey: process.env.MICROCMS_API_INFO_API_KEY,
      output: './src/microcms-types.ts',
      endpoints: ['blog', 'category'],
      extensionFieldTypes: {
        blog: {
          extension: {
            from: './blog-extension-types',
            data: 'BlogExtension',
          },
          'panel.embed': {
            from: './blog-extension-types',
            data: 'PanelEmbed',
          },
        },
      },
    },
  },
} satisfies Config;
```

> [!NOTE]
> 型検査で`process`が見つからない場合は、開発依存関係に`@types/node`を追加し、設定ファイルに適用する`tsconfig.json`の`compilerOptions.types`に`"node"`を含めてください。

`services`の各キー（例の`main`）がサービス名です。複数サービスではキーを追加し、それぞれ別の出力先を指定します。既定では全サービスを処理し、1サービスだけ実行する場合は`--service main`で選択できます。各サービス設定に記述する項目は次のとおりです。

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| `serviceDomain` | はい | サービスID。URLではなく`your-service`の部分を指定 |
| `apiKey` | はい | [「API情報の取得」権限](https://document.microcms.io/management-api/get-api-info)を持つAPIキー |
| `output` | はい | コマンドを実行したディレクトリを基準とする、生成する`.ts`ファイルのパス |
| `endpoints` | いいえ | 対象APIのエンドポイントIDの配列。省略すると全APIが対象 |
| `extensionFieldTypes` | いいえ | エンドポイント・フィールドごとの拡張フィールド型の設定 |
| `extensionFieldTypes.<endpoint>.<fieldPath>.from` | - | 生成ファイルから見た、型定義ファイルのモジュールパス |
| `extensionFieldTypes.<endpoint>.<fieldPath>.data` | - | 型定義ファイルからエクスポートした`data`の型名 |

拡張フィールドを設定する場合は、対象フィールドの`from`と`data`を両方指定します。`<fieldPath>`は、通常は拡張フィールドのフィールドID（例：`extension`）です。カスタムフィールド内の拡張フィールドでは、カスタムフィールドIDとその中の拡張フィールドIDをつないだ文字列を用いてください。その場合、カスタムフィールドを配置したフィールドIDは指定に含める必要はありません。

### 拡張フィールドの設定（`extensionFieldTypes`）

拡張フィールドの`data`の形式はAPIスキーマから判定できないため、指定がなければ読み取り型は`unknown`となります。
`data`の型が決まっている場合は、あらかじめ定義することが可能です。
メタデータ（`id`・`title`・`description`・`imageUrl`・`updatedAt`）は規定の項目となるため、定義は不要です。

```ts
// src/blog-extension-types.ts
export type BlogExtension = {
  place: {
    name: string;
    address: string;
  };
};

export type PanelEmbed = { html: string };
```

## CLIオプション

| オプション | 説明 |
| --- | --- |
| `--service <name>` | 設定ファイルの1サービスを選択。省略時は全サービス |
| `--config <file>` | TypeScript設定ファイルを指定。省略時は作業ディレクトリの`microcms-typegen.config.ts`を読み込み |
| `--force` | `generate`専用。生成済みコメントがない既存ファイルも上書き |
| `--help` | ヘルプを表示 |

## 生成型の利用方法

生成ファイルには、エンドポイントごとの標準的な読み取り型（`Blog`など）と、全エンドポイントの型情報をまとめたサービス型が出力されます。サービス型の名前は`services`のキーから作られ、設定例の`main`なら`MainServiceSchema`です。この型には`depth`別の読み取り型、指定可能な`fields`、書き込み用の型も含まれます。

SDKの`createClient`にサービス型を指定すると、読み取りではエンドポイントと`depth`・`fields`に応じた戻り値型を、書き込みではエンドポイントに応じた入力型を推論します。エンドポイントごとの標準型は、メソッドへ個別に型を指定する方法でも利用できます。

具体的な読み書き、クエリに応じた型抽出、メソッドごとの型指定は、[SDKのREADMEのTypeScript節](https://github.com/microcmsio/microcms-js-sdk#typescript)を参照してください。

[型生成のサンプル](examples/README.md)で入力スキーマ・生成結果を確認できます。補完や戻り値の型をエディタで試す例は、[SDKの利用例](https://github.com/microcmsio/microcms-js-sdk/tree/main/examples)を参照してください。

## 補足

### 空値

[フィールドごとのレスポンス形式](https://document.microcms.io/content-api/get-api-field-responses#hf57c580171)に合わせ、生成型には未入力時の省略・`null`・空文字・空配列などを含めています。
登録方法が限定されている場合や、必須設定の設定タイミングによっては、実際には生じない空値まで含み、型が広くなることがあります。

> [!NOTE]
> 空値の厳格性を緩めるオプションの提供を今後検討します。

## 開発者向け情報

typegenの開発に関する情報は、[開発ガイド](DEVELOPMENT.md)を参照してください。

## ライセンス

[Apache License 2.0](LICENSE)
