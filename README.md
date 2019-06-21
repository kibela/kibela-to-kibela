# Kibela to Kibela import script

This script imports Kibela resources from archive files exported from a Kibela team.

## Prerequisites

NodeJS v12 or greater.

## Setup

```shell-session
# Install dependencies
npm install

# Configure KIBELA_TEAM and KIBELA_TOKEN
code .env

# Run the import script
npx ts-node kibela-import.ts path-to-archive-files --exported-from <subdomain> [--apply] kibela-<subdomain>-<id>.zip...

# Fix up the paths
npx ts-node kibela-fixup-imported-content.ts --exported-from <subdomain> [--apply] transaction-*.log

# Unimport the imported resources
npx ts-node kibela-unimport.ts [--appply] transaction-*.log
```

## License

This project is destributed under the ICS license.

See [LICENSE](./LICENSE) for details.
