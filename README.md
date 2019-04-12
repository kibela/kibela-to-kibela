# Kibela to Kibela import script

This script imports Kibela resources from archive files exported from a Kibela team.

## Prerequisites

NodeJS v10 or greater.

## Setup

```shell-session
# Install dependencies
npm install

# Configure KIBELA_TEAM and KIBELA_TOKEN
code .env

# Run a simple script
npx ts-node import.ts path-to-archive-files
```

## License

This project is destributed under the ICS license.

See [LICENSE](./LICENSE) for details.
