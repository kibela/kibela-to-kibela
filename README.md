# Kibela to Kibela import script

**注意: このスクリプトは現在開発中です。**

Kibelaの「エクスポート」機能でエクスポートしたZIPファイルを、再びKibelaにimportしなおすスクリプトです。

## 機能

### kibela-ping

Kibela Web APIを叩くための設定を確認するためのスクリプトです。

### kibela-import

実際にリソースのimportを行うスクリプトです。また、NoteやCommen本文のパスも新しいチームのパスに修正します。

最終的に `transaction-*.log` というログを生成します。このログを `kibela-unimport` スクリプトに与えると、importしたリソースをすべて削除します。

TBD

### kibela-unimport

`kibela-import` でimportしたリソースを削除します。

import後に行ったリソースの変更もすべて削除されるため注意してください。

TBD

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
