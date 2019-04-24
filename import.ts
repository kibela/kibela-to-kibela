import "dotenv/config"; // to load .env

import util from "util";
import fs from "fs";

import fetch from "node-fetch";
import msgpack from "msgpack-lite";
import unzipper from "unzipper";
import commander from "commander";
import TraceError from "trace-error";
import { ulid } from "ulid";
import gql from "graphql-tag";
import frontMatter from "front-matter";

import { name, version } from "./package.json";
import { ensureNonNull } from "./ensureNonNull";
import { KibelaClient, FORMAT_JSON, FORMAT_MSGPACK } from "./KibelaClient";

const TEAM = ensureNonNull(process.env.KIBELA_TEAM, "KIBELA_TEAM");
const TOKEN = ensureNonNull(process.env.KIBELA_TOKEN, "KIBELA_TOKEN");
const USER_AGENT = `${name}/${version}`;

commander
  .version(version)
  .option("--json", "Use JSON instead of MessagePack in serialization")
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

  const result = await client.request({
    query: CreateNote,
    variables: {
      input: {
        title,
        content,
        draft: false,
        coediting: true,
        groupIds: [],
        folderName: null, // FIXME
        authorId: null, // FIXME
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

  const logFd = fs.openSync(`transaction-${TRANSACTION_ID}.log`, "wx");

  for (const zipArchive of zipArchives) {
    await fs
      .createReadStream(zipArchive)
      .pipe(unzipper.Parse())
      .on("entry", async (entry: unzipper.Entry) => {
        const buffer = await entry.buffer();

        console.log(`Processing [${(++id).toString().padStart(5, "0")}]`, entry.path, entry.type, buffer.byteLength);
        dataSize += buffer.byteLength;

        if (isAttachment(entry.path)) {
          const newAttachment = await uploadAttachment(entry.path, buffer);
          attachmentMap.set(entry.path, newAttachment);
          fs.writeSync(logFd, `${entry.path}\t${newAttachment.path}\n`);
        } else {
          const newNote = await createNote(entry.path, buffer.toString("utf-8"));
          noteMap.set(entry.path, newNote);
          fs.writeSync(logFd, `${entry.path}\t${newNote.path}\n`);
        }

        await entry.autodrain().promise();
      })
      .promise();
  }

  console.log("data size:", dataSize);
}

processZipArchives(commander.args);
