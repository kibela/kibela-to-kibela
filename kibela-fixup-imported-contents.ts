import "dotenv/config"; // to load .env

import readline from "readline";
import fs from "fs";
import fetch from "node-fetch";
import gql from "graphql-tag";
import commander from "commander";
import util from "util";
import path from "path";
import { escapeRegExp } from "lodash";
import { createPatch } from "diff";

import {
  ensureStringIsPresent,
  getEnv,
  KibelaClient,
  FORMAT_JSON,
  FORMAT_MSGPACK,
} from "@kibela/kibela-client";
import { name, version } from "./package.json";

const TEAM = ensureStringIsPresent(getEnv("KIBELA_TEAM"), "KIBELA_TEAM");
const TOKEN = ensureStringIsPresent(getEnv("KIBELA_TOKEN"), "KIBELA_TOKEN");
const ENDPOINT = getEnv("KIBELA_ENDPOINT"); // optional
const USER_AGENT = `${name}/${version}`;

commander
  .version(version)
  .option("--json", "Use JSON instead of MessagePack in serialization for debugging")
  .option("--apply", "Apply the actual change to the target team; default to dry-run mode.")
  .option(
    "--exported-from <subdomain>",
    "A Kibela team name that the archives come from",
    /^[a-zA-Z0-9-]+$/,
  )
  .parse(process.argv);

const APPLY = commander.apply as boolean;

const exportedFrom = commander.exportedFrom as (string | undefined);
if (!stringIsPresent(exportedFrom)) {
  console.log("--exported-from <subdomain> is required.");
  process.exit(1);
}
const kibelaUrlExportedFrom = `https://${exportedFrom}.kibe.la`;
console.log(`The archives come from ${kibelaUrlExportedFrom}\n`);

const client = new KibelaClient({
  endpoint: ENDPOINT,
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  format: commander.json ? FORMAT_JSON : FORMAT_MSGPACK,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

type RelayId = unknown;

type LogType = Readonly<{
  type: string;
  file: string;
  content?: string;
  sourceId: string;
  destPath: string;
  destRelayId: RelayId;
}>;

const noteMap = new Map<string, LogType>();
const commentMap = new Map<string, LogType>();
const attachmentMap = new Map<string, LogType>();

function stringIsPresent(s: string | null | undefined): s is string {
  return s != null && s.length > 0;
}

function getDestPath(pathOrUrl: string) {
  const a = /\/attachments\/([^\.\/]+)\.\w+$/.exec(pathOrUrl);
  if (a) {
    const sourceId = a[1];
    const attachment = attachmentMap.get(sourceId);
    if (attachment) {
      return attachment.destPath;
    } else {
      console.warn(`[WARN] No attachment found for ${pathOrUrl}`);
      return null;
    }
  }

  // only handles notes (/@:account/:id, /blogs/:id, /wikis/:id, /notes/:id),
  // Note that id will be changed to string in a future.
  const n = /\/(?:@[^/\s]+|blogs|wikis|notes)\/(\w+)/.exec(pathOrUrl);
  if (n) {
    const sourceId = n[1];
    const note = noteMap.get(sourceId);
    if (note) {
      return /^https?:/.test(pathOrUrl) ? `https://${TEAM}.kibe.la${note.destPath}` : note.destPath;
    } else {
      console.warn(`[WARN] No attachment found for ${pathOrUrl}`);
      return null;
    }
  }

  return null;
}

function fixupContent(content: string, matched: RegExpExecArray) {
  const sourcePath = matched[1];
  const destPath = getDestPath(sourcePath);

  if (destPath) {
    const a = content.slice(0, matched.index);
    const b = content.slice(matched.index).replace(new RegExp(escapeRegExp(sourcePath)), destPath);

    return a + b;
  }

  return content;
}

async function main(logFiles: ReadonlyArray<string>) {
  for (const logFile of logFiles) {
    console.log(`Loading ${logFile}`);

    const lines = readline.createInterface({
      input: fs.createReadStream(logFile),
    });

    for await (const line of lines) {
      const log = JSON.parse(line);
      switch (log.type) {
        case "note": {
          noteMap.set(log.sourceId, log);
          break;
        }
        case "comment": {
          commentMap.set(log.sourceId, log);
          break;
        }
        case "attachment": {
          attachmentMap.set(log.sourceId, log);
          break;
        }
        default: {
          throw new Error(`Unknown type: ${log.type}`);
        }
      }
    }
  }

  console.log(
    `Loaded: notes=${noteMap.size} comments=${commentMap.size} attachments=${attachmentMap.size}`,
  );

  const rawUrlPattern = new RegExp(
    `\\b(${escapeRegExp(kibelaUrlExportedFrom)}\\b[^\\s+\\)\\]?#]+)`,
    "g",
  );

  // handles only absolute paths (/notes/id) and relative paths (../id)
  // URLs are handled by the next secrion
  const mdLinkPattern = /\[[^\[]+\]\(([/\.][^\)]*)\)+/g;
  for (const note of noteMap.values()) {
    if (!note.content) {
      continue;
    }

    let matched: RegExpExecArray | null = null;

    let content = note.content;
    while ((matched = mdLinkPattern.exec(note.content))) {
      content = fixupContent(content, matched);
    }

    while ((matched = rawUrlPattern.exec(note.content))) {
      content = fixupContent(content, matched);
    }

    if (content !== note.content) {
      console.log(`TODO: update content for ${note.destPath}`);
      console.log(createPatch(note.destPath, note.content, content));
    }
  }
}

main(commander.args);
