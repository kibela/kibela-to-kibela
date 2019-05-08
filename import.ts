import "dotenv/config"; // to load .env

import fs, { promises as fsp } from "fs";

import fetch from "node-fetch";
import unzipper from "unzipper";
import commander from "commander";
import TraceError from "trace-error";
import { ulid } from "ulid";
import gql from "graphql-tag";
import frontMatter from "front-matter";
import * as ltsv from "ltsv";

import { name, version } from "./package.json";
import { ensureNonNull } from "./ensureNonNull";
import { KibelaClient, FORMAT_JSON, FORMAT_MSGPACK } from "./KibelaClient";

const TEAM = ensureNonNull(process.env.KIBELA_TEAM, "KIBELA_TEAM");
const TOKEN = ensureNonNull(process.env.KIBELA_TOKEN, "KIBELA_TOKEN");
const USER_AGENT = `${name}/${version}`;

commander
  .version(version)
  .option("--json", "Use JSON instead of MessagePack in serialization for debugging")
  .option("--apply", "Apply the actual change to the target team; default to dry-run mode.")
  .parse(process.argv);

const APPLY = commander.apply && !commander.dryRun;

const TRANSACTION_ID = ulid();

// main

const client = new KibelaClient({
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  format: commander.json ? FORMAT_JSON : FORMAT_MSGPACK,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

const UploadAttachment = gql`
  mutation UploadAttachment($input: UploadAttachmentInput) {
    uploadAttachment(input: $input) {
      attachment {
        id
        path
      }
    }
  }
`;

const CreateNote = gql`
  mutation CreateNote($input: CreateNoteInput!) {
    createNote(input: $input) {
      note {
        id
        path
      }
    }
  }
`;

const CreateComment = gql`
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      comment {
        id
        path
      }
    }
  }
`;

type RelayId = unknown;

type Connection<T> = Readonly<{
  edges: ReadonlyArray<{
    readonly node: T;
  }>;
}>;

type AttachmentType = {
  id: RelayId;
  path: string;
};

type CommentType = {
  id: RelayId;
  author: string;
  publishedAt: string;
  content: string;
};

type NoteType = {
  id: RelayId;
  path: string;
  author: string;
  title: string;
  content: string;
  publishedAt: string;

  comments: ReadonlyArray<CommentType>;
};

// the original path to the new path mapping
// note that new paths are only available after create it on the cloud (i.e. Kibela)
const attachmentMap = new Map<string, AttachmentType>();
const noteMap = new Map<string, NoteType>();

function isAttachment(path: string): boolean {
  return /^kibela-\w+-\d+\/attachments\//.test(path);
}

async function uploadAttachment(name: string, buffer: Buffer): Promise<AttachmentType> {
  const dummy = ulid();
  return {
    id: dummy,
    path: dummy,
  };
}

async function createNote(filename: string, exportedContent: string): Promise<NoteType> {
  const md = frontMatter<any>(exportedContent);

  const [, title, content] = /^#\s+(\S[^\n]*)\n\n(.*)/s.exec(md.body)!;

  // Kibela API requires an ISO8601 string representation for DateTime
  let publishedAt: string | null = null;
  try {
    publishedAt = new Date(md.attributes["published_at"]).toISOString();
  } catch (e) {
    console.warn("WARN: Invalid `published_at`: ", md.attributes["published_at"]);
  }

  const result = await client.request({
    query: CreateNote,
    variables: {
      input: {
        title,
        content,
        draft: !!publishedAt,
        coediting: true,
        groupIds: [],
        folderName: null, // FIXME
        authorId: null, // FIXME
        publishedAt,
      },
    },
  });

  return {
    id: result.data.createNote.note.id,
    path: result.data.createNote.note.path,
    author: md.attributes.author,
    title,
    content,
    publishedAt: md.attributes.published_at,
    comments: [], // FIXME
  };
}

async function processZipArchives(zipArchives: ReadonlyArray<string>) {
  let id = 0;
  let dataSize = 0;
  let successCount = 0;
  let failureCount = 0;

  const logFile = `transaction-${TRANSACTION_ID}.log`;
  const logFh = await fsp.open(logFile, "wx");
  process.on("exit", () => {
    if (fs.statSync(logFile).size === 0) {
      fs.unlinkSync(logFile);
    }
  });
  process.on("SIGINT", () => {
    // just exit to handle "exit" events to cleanup
    process.exit();
  });

  for (const zipArchive of zipArchives) {
    const zipBuffer = await fsp.readFile(zipArchive);
    const directory = await unzipper.Open.buffer(zipBuffer);

    for (const file of directory.files) {
      const buffer = await file.buffer();

      const idTag = (++id).toString().padStart(5, "0");
      const label = APPLY ? "Processing" : "Processing (dry-run)";
      console.log(`${label} [${idTag}]`, file.path, buffer.length);
      dataSize += buffer.byteLength;

      if (!APPLY) {
        continue; // dry-run
      }

      try {
        if (isAttachment(file.path)) {
          const newAttachment = await uploadAttachment(file.path, buffer);
          attachmentMap.set(file.path, newAttachment);
          await logFh.appendFile(
            ltsv.format({
              file: file.path,
              type: "attachment",
              kibelaPath: newAttachment.path,
              kibelaId: newAttachment.id,
            }) + "\n",
          );
        } else {
          const newNote = await createNote(file.path, buffer.toString("utf-8"));
          noteMap.set(file.path, newNote);
          await logFh.appendFile(
            ltsv.format({
              file: file.path,
              type: "note",
              kibelaPath: newNote.path,
              kibelaId: newNote.id,
            }) + "\n",
          );
        }

        successCount++;
      } catch (e) {
        console.error(`Failed to request[${idTag}]`, e);
        failureCount++;
      }
    }
  }

  console.log(
    `data size=${Math.round(
      dataSize / 1024 ** 2,
    )}MiB, success/failure=${successCount}/${failureCount}`,
    dataSize,
  );
}

processZipArchives(commander.args);
