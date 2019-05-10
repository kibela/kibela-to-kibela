#!ts-node
import "dotenv/config";

import fetch from "node-fetch";
import gql from "graphql-tag";

import { KibelaClient, getEnv, ensureStringIsPresent } from "@kibela/kibela-client";
import { name, version } from "./package.json";

const TEAM = ensureStringIsPresent(getEnv("KIBELA_TEAM"), "KIBELA_TEAM");
const TOKEN = ensureStringIsPresent(getEnv("KIBELA_TOKEN"), "KIBELA_TOKEN");
const ENDPOINT = getEnv("KIBELA_ENDPOINT");
const USER_AGENT = `${name}/${version}`;

const client = new KibelaClient({
  endpoint: ENDPOINT,
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

const HelloKibelaClient = gql`
  query HelloKibeaClient {
    currentUser {
      account
    }
  }
`;

async function main() {
  console.log(`Querying to ${client.endpoint} ...`);
  const response = await client.request({
    query: HelloKibelaClient,
  });
  console.dir(response, { depth: 100 });
}

main();
