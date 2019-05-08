#!ts-node
import "dotenv/config";

import fetch from "node-fetch";
import gql from "graphql-tag";

import { KibelaClient } from "./KibelaClient";
import { ensureNonNull } from "./ensureNonNull";
import { name, version } from "./package.json";

const TEAM = ensureNonNull(process.env.KIBELA_TEAM, "KIBELA_TEAM");
const TOKEN = ensureNonNull(process.env.KIBELA_TOKEN, "KIBELA_TOKEN");
const USER_AGENT = `${name}/${version}`;

const client = new KibelaClient({
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

async function main() {
  const response = await client.request({
    query: gql`
      query HelloKibeaClient {
        currentUser {
          account
        }
      }
    `,
  });
  console.dir(response, { depth: 100 });
}

main();
