import fetch from "node-fetch";

import { KibelaClient, getEnv, ensureStringIsPresent } from "@kibela/kibela-client";
import { name, version } from "./package.json";
import gql from "graphql-tag";

export const TEAM = ensureStringIsPresent(getEnv("KIBELA_TEAM"), "KIBELA_TEAM");
export const TOKEN = ensureStringIsPresent(getEnv("KIBELA_TOKEN"), "KIBELA_TOKEN");
export const ENDPOINT = getEnv("KIBELA_ENDPOINT");
export const USER_AGENT = `${name}/${version}`;

export const client = new KibelaClient({
  endpoint: ENDPOINT,
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

export async function ping() {
  const query = gql`
    query HelloKibeaClient {
      currentUser {
        account
      }
    }
  `;

  console.log(`Requesting to ${client.endpoint} ...`);
  const response = await client.request({ query });
  console.dir(response, { depth: 100 });
}
