#!ts-node
import "dotenv/config";

import fetch from "node-fetch";
import gql from "graphql-tag";

import { KibelaClient } from "./KibelaClient";
import { name, version } from "./package.json";
import { getEnv } from "./getEnv";

const TEAM = getEnv("KIBELA_TEAM");
const TOKEN = getEnv("KIBELA_TOKEN");
const USER_AGENT = `${name}/${version}`;

const client = new KibelaClient({
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

async function main() {
  console.log(`Querying to ${client.endpoint} ...`)
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
