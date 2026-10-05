# 型生成のサンプル

入力スキーマ・生成結果を確認するためのサンプルです。型は生成済みのため、APIキーやサービスへのアクセス権、生成コマンドの実行は不要です。

| ファイル | 内容 |
| --- | --- |
| [schemas.json](schemas.json) | マネジメントAPIから取得したAPI一覧と各APIのスキーマ |
| [microcms-types.ts](microcms-types.ts) | 上記スキーマから生成した型 |

`schemas.json`内の拡張フィールドURLは、公開用の`example.com`のダミーに置き換えています。

## 生成される型

サンプル用サービスには、オブジェクト形式の`banner`、リスト形式の`blogs`・`categories`・`all_fields`があります。

生成ファイルには、エンドポイントごとの標準的な読み取り型（`Blogs`など）、カスタムフィールドの型、画像・ファイルの型、サービス全体を表す`ExampleServiceSchema`が含まれます。

`ExampleServiceSchema`には、標準の読み取り型に加えて`depth: 0`〜`3`の読み取り型、指定できるフィールドパス、作成・更新用の入力型が含まれます。このサンプルは、設定の`services`のキーを`example`とした場合の生成結果です。

## SDKで使う

生成型を使った読み書き・`fields`・`depth`・型抽出・型エラーの確認は、[JavaScript SDKの利用例](https://github.com/microcmsio/microcms-js-sdk/tree/main/examples)にまとめています。SDKの仕様は[READMEのTypeScript節](https://github.com/microcmsio/microcms-js-sdk#typescript)を参照してください。
