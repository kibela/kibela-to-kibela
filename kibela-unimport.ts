#!/usr/bin/env npx ts-node
import "dotenv/config";

import readline from "readline";
import fs from "fs";
import gql from "graphql-tag";
import commander from "commander";
import util from "util";

import {
  getOperationName,
  GraphqlError,
  isNotFoundError,
} from "@kibela/kibela-client";
import { version } from "./package.json";
import { client, ping } from "./kibela-config";

util.inspect.defaultOptions.depth = 100;

commander
  .version(version)
  .option("--apply", "Apply the actual change to the target team; default to dry-run mode.")
  .parse(process.argv);

const APPLY = commander.apply as boolean;

const DeleteNote = gql`
  mutation DeleteNote($input: DeleteNoteInput!) {
    deleteNote(input: $input) {
      clientMutationId
    }
  }
`;

const DeleteComment = gql`
  mutation DeleteComment($input: DeleteCommentInput!) {
    deleteComment(input: $input) {
      clientMutationId
    }
  }
`;

const DeleteAttachment = gql`
  mutation DeleteAttachment($input: DeleteAttachmentInput!) {
    deleteAttachment(input: $input) {
      clientMutationId
    }
  }
`;

const typeToQuery = new Map<string, ReturnType<typeof gql>>([
  ["note", DeleteNote],
  ["comment", DeleteComment],
  ["attachment", DeleteAttachment],
]);

async function main(logFiles: ReadonlyArray<string>) {
  await ping();

  for (const logFile of logFiles) {
    const lines = readline.createInterface({
      input: fs.createReadStream(logFile),
    });

    for await (const line of lines) {
      const log = JSON.parse(line);
      const query = typeToQuery.get(log.type);
      if (!query) {
        throw new Error(`No query for log.type=${log.type}`);
      }
      console.log(`${getOperationName(query)} id=${log.destRelayId}, path=${log.destPath}`);

      if (APPLY) {
        try {
          await client.request({
            query,
            variables: { input: { id: log.destRelayId } },
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
