# Kibela to Kibela import script [![Build Status](https://travis-ci.org/kibela/kibela-to-kibela.svg?branch=master)](https://travis-ci.org/kibela/kibela-to-kibela)

**注意: このスクリプトは不可逆な操作をいくつか含みます。READMEをよく読んでから実行してください。**

ある [Kibela](https://kibe.la) team の「エクスポート」機能でエクスポートしたZIPファイルを、ほかのKibela teamにimportしなおすスクリプトです。

このスクリプトでimportしたコンテンツは、importスクリプトのログファイルに基づいて削除もできます。つまり、何度でも実行と実行の取り消しをできるようになっています。

## importスクリプトの作業フロー概要

1. kibela-import.ts の実行
2. kibela-fixup-contents.ts の実行
3. 内容を確認して問題があったら kibela-unimport.ts を実行して一旦削除する
    * → 1. からやりなおし

kibela-import.ts 自体には重複実行を抑制する機能はないので、問題があったら常にunimportする必要があります。 また、^C (SIGINT) で中断したあとも必ずunimportでcleanupしてください。

なお、unimportはnote, comment, attachmentのみを削除します。作成されたuserとgroupはunimportを実行しても削除されません。

## コマンド

ping以外のスクリプトはデフォルトで **dry-run** を行います。実際に適用するときは `--apply` オプションを与えてください。

### kibela-ping.ts

Kibela Web APIを叩くための設定を確認するためのスクリプトです。

なおこの "ping" スクリプトはその他のスクリプトでも冒頭で呼ばれるようになっています。

### kibela-import.ts

実際にリソースのimportを行うスクリプトです。importするリソースはNote, Comment, Attachmentです。それぞれの更新履歴やLikeは維持されません。

このスクリプトは最終的に `transaction-*.log` というログを生成します。

このログは次に `kibela-fixup-contents` を実行するときに必要です。また、ログを `kibela-unimport` スクリプトに与えると、importしたリソースをすべて削除します。

`--exported-from <subdomain>` オプションでexport元のsubdomainを指定してください。

なお、デフォルトではdry-runモードで起動するため何も処理をしません。処理を実際に行いたいときは `--apply` オプションを与えてください。

```console
./kibela-import.ts --exported-from <subdomain> [--apply] kibela-<subdomain>-<n>.zip...
```

groupについては次のような振る舞いになっています。

* Noteをimporする際、同名のgroupがあればそこに、なければ新しいgroupをつくってそこに紐付ける
  * 名前しかみないので、Home groupもあらかじめほかの名前をつけておくことで別groupとしてimportできる
* privateかどうかは維持されない
  * `--private-groups` オプションで一括で新規作成分をprivateにはできる
* groupの説明や画像はimportされない

folderについても「同名のfolderがあればそこに、なければ新しいfolderを作ってそこに紐付ける」ですが、privateフラグはないので振る舞いとしてはずっとシンプルです。

### kibela-fixup-contents.ts

`kibela-import` でimportしたcontentにあるexport元のリンク / URL をimport先のものにベストエフォートで修正します。

ただし、Kibelaは歴史的経緯により様々なURLフォーマットがあり、すべてを正しく修正できるわけではないことをご了承ください。

`--exported-from <subdomain>` オプションでexport元のsubdomainを指定してください。

なお、デフォルトではdry-runモードで起動するため何も処理をしません。処理を実際に行いたいときは `--apply` オプションを与えてください。

```console
./kibela-fixup-contents.ts --exported-from <subdomain> [--apply] transactio-*.log
```

### kibela-unimport.ts

`kibela-import` でimportしたリソースを削除します。

import後に行ったリソースの変更もすべて削除されるため注意してください。

なお、デフォルトではdry-runモードで起動するため何も処理をしません。処理を実際に行いたいときは `--apply` オプションを与えてください。

```console
./kibela-unimport.ts [--apply] transactio-*.log
```

## Prerequisites

NodeJS v12 or greater.

## Setup

```shell-session
# Install dependencies
npm install

# Configure KIBELA_TEAM and KIBELA_TOKEN
code .env

npm run ping # to test configurations
```

## import詳細

exportされたzipをもとにするので、そこにある情報のみimport可能です。

### importされるもの

* noteのtitle, content, folder, groups, author, published_at
* commentのcontent, author, published_at
* attachments （noteに添付されているもののみ）
* groupのname
  * 同名のgroupがあればそれを利用
  * import先に存在しないgroupは生成する（unimort不可）
* userのaccount
  * 同名（accountが完全一致）のuserがいればそれを利用
  * import先に存在しないユーザはdisabled userとして作成（unimport不可）

## importされないもの

* noteの変更履歴
* commentの変更履歴
* note template
* groupのdescription, dashboardと所属メンバー
* userのaccount以外の情報 (emailやrole含む)
* 通知およびwatch状態
* like
* access token
* 各種ログ（audit logsやacces token logs）

## See Also

* https://github.com/kibela/kibela-api-v1-document

## License

This project is destributed under the ICS license.

See [LICENSE](./LICENSE) for details.
