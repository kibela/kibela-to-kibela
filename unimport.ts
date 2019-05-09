#!ts-node
import "dotenv/config";

import readline from "readline";
import fs from "fs";
import fetch from "node-fetch";
import gql from "graphql-tag";
import commander from "commander";

import { KibelaClient, FORMAT_JSON, FORMAT_MSGPACK, getOperationName, GraphqlError, isNotFoundError } from "./KibelaClient";
import { ensureNonNull } from "./ensureNonNull";
import { name, version } from "./package.json";

const TEAM = ensureNonNull(process.env.KIBELA_TEAM, "KIBELA_TEAM");
const TOKEN = ensureNonNull(process.env.KIBELA_TOKEN, "KIBELA_TOKEN");
const USER_AGENT = `${name}/${version}`;

commander
  .version(version)
  .option("--json", "Use JSON instead of MessagePack in serialization for debugging")
  .option("--apply", "Apply the actual change to the target team; default to dry-run mode.")
  .parse(process.argv);

const APPLY = commander.apply as boolean;

const client = new KibelaClient({
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  format: commander.json ? FORMAT_JSON : FORMAT_MSGPACK,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

const DeleteNote = gql`
  mutation DeleteNote($input: DeleteNoteInput!) {
    deleteNote(input: $input) {
      clientMutationId
    }
  }
`;

const DeleteAttachment = gql`
  mutation DeleteAttachment($input: DeleteNoteInput!) {
    deleteNote(input: $input) {
      clientMutationId
    }
  }
`;

require("util").inspect.defaultOptions.depth = 100;

async function main(logFiles: ReadonlyArray<string>) {
  for (const logFile of logFiles) {
    const lines = readline.createInterface({
      input: fs.createReadStream(logFile),
    });

    for await (const line of lines) {
      const log = JSON.parse(line);
      const query = log.type === "attachment" ? DeleteAttachment : DeleteNote;
      console.log(`${getOperationName(query)} id=${log.kibelaId}, path=${log.kibelaPath}`);

      if (APPLY) {
        try {
          await client.request({
            query,
            variables: { input: { id: log.kibelaId } },
          });
        } catch (e) {
          if (e instanceof GraphqlError) {
            if (isNotFoundError(e)) {
              console.log(" ... resource not found");
            } else {
              console.warn("  ... failed with", e.message, e.errors);
            }
          } else {
            console.error(" ... failed with", e);
          }
        }
      }
    }
  }
}

main(commander.args);
