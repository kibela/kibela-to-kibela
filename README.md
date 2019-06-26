# Kibela to Kibela import script

**注意: このスクリプトは現在開発中です。実際のデータで試すことはおすすめません。もし実行する場合は自己責任でお願いします。**

Kibelaの「エクスポート」機能でエクスポートしたZIPファイルを、再びKibelaにimportしなおすスクリプトです。

## TODO

* [ ] authorをベストエフォートで復元する
* [ ] groupをベストエフォートで復元する
* [ ] groupを指定するオプションの実装

## 機能


ping以外のスクリプトはデフォルトで **dry-run** を行います。実際に適用するときは `--apply` オプションを与えてください。

### kibela-ping

Kibela Web APIを叩くための設定を確認するためのスクリプトです。

なおこの "ping" スクリプトはその他のスクリプトでも冒頭で呼ばれるようになっています。

### kibela-import

実際にリソースのimportを行うスクリプトです。また、NoteやCommen本文のパスも新しいチームのパスに修正します。

最終的に `transaction-*.log` というログを生成します。このログを `kibela-unimport` スクリプトに与えると、importしたリソースをすべて削除します。

`--exported-from <subdomain>` オプションでexport元のsubdomainを指定してください。

## kibela-fixup-contents

`kibela-import` でimportしたcontentにあるexport元のリンク / URL をimport先のものに修正します。

ただし、Kibelaは歴史的経緯により様々なURLフォーマットがあり、すべてを正しく修正できるわけではないことをご了承ください。

`--exported-from <subdomain>` オプションでexport元のsubdomainを指定してください。

### kibela-unimport

`kibela-import` でimportしたリソースを削除します。

import後に行ったリソースの変更もすべて削除されるため注意してください。

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

## License

This project is destributed under the ICS license.

See [LICENSE](./LICENSE) for details.
