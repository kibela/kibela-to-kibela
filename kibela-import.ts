import "dotenv/config"; // to load .env

import fs from "fs";
import path from "path";

import fetch from "node-fetch";
import unzipper from "unzipper";
import commander from "commander";
import { ulid } from "ulid";
import gql from "graphql-tag";
import frontMatter from "front-matter";
import { basename } from "path";

import { name, version } from "./package.json";
import {
  KibelaClient,
  FORMAT_JSON,
  FORMAT_MSGPACK,
  ensureStringIsPresent,
  getEnv,
} from "@kibela/kibela-client";

const TEAM = ensureStringIsPresent(getEnv("KIBELA_TEAM"), "KIBELA_TEAM");
const TOKEN = ensureStringIsPresent(getEnv("KIBELA_TOKEN"), "KIBELA_TOKEN");
const ENDPOINT = getEnv("KIBELA_ENDPOINT"); //
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

const APPLY = commander.apply && !commander.dryRun;

const exportedFrom = commander.exportedFrom as (string | undefined);
if (!stringIsPresent(exportedFrom)) {
  console.log("--exported-from <subdomain> is required.");
  process.exit(1);
}
const kibelaDomainExportedFrom = `https://${exportedFrom}.kibe.la`;
console.log(`The archives come from ${kibelaDomainExportedFrom}\n`);

const TRANSACTION_ID = ulid();

// main

const client = new KibelaClient({
  endpoint: ENDPOINT,
  team: TEAM,
  accessToken: TOKEN,
  userAgent: USER_AGENT,
  format: commander.json ? FORMAT_JSON : FORMAT_MSGPACK,
  fetch: (fetch as any) as typeof window.fetch,
  retryCount: 5,
});

const UploadAttachment = gql`
  mutation UploadAttachment($input: UploadAttachmentInput!) {
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

const GetAuthor = gql`
  query GetAuthor($account: String!) {
    user: userByAccount(account: $account) {
      id
      account
    }
  }
`;

type RelayId = unknown;

type AttachmentType = {
  id: RelayId;
  path: string;
};

type CommentType = {
  id: RelayId | null;
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
  folderName: string | null;
  publishedAt: string;

  comments: ReadonlyArray<CommentType>;
};

type AuthorType = {
  id: RelayId;
  account: string;
};

function getSourceId(filename: string) {
  const basename = path.basename(filename);
  return /^([^-\.]+)/.exec(basename)![1];
}

function isAttachment(path: string): boolean {
  return /^kibela-\w+-\d+\/attachments\//.test(path);
}

async function uploadAttachment(name: string, data: Buffer): Promise<AttachmentType> {
  if (!APPLY) {
    const dummy = ulid();
    return {
      id: dummy,
      path: `/attachments/${dummy}`,
    };
  }

  const result = await client.request({
    query: UploadAttachment,
    variables: {
      input: {
        name: basename(name),
        data,
        kind: "GENERAL",
      },
    },
  });

  return {
    id: result.data.uploadAttachment.attachment.id,
    path: result.data.uploadAttachment.attachment.path,
  };
}

function stringIsPresent(s: string | null | undefined): s is string {
  return s != null && s.length > 0;
}

const accountToAuthorCache = new Map<string, AuthorType>();

async function getAuthor(account: string): Promise<AuthorType> {
  if (accountToAuthorCache.has(account)) {
    return accountToAuthorCache.get(account)!;
  } else {
    const result = await client.request({
      query: GetAuthor,
      variables: { account },
    });
    return result.data!.user;
  }
}

/**
 *
 * @param filename "kibela-$team-$seq/(?:notes|blogs|wikis)/$folderName/$id-$title.md`
 */
function extractFolderNameFromFilename(filename: string): string | null {
  const matched = /[^/]+\/(?:notes|blogs|wikis)\/(?:(.+)\/)?[^/]+$/iu.exec(filename);
  return matched && matched[1];
}

async function createNote(filename: string, exportedContent: string): Promise<NoteType> {
  const md = frontMatter<any>(exportedContent);

  const [, title, content] = /^# +([^\n]*)\n\n(.*)/s.exec(md.body)!;

  // Kibela API requires an ISO8601 string representation for DateTime
  const publishedAt = stringIsPresent(md.attributes["published_at"])
    ? new Date(md.attributes["published_at"]).toISOString()
    : null;

  const authorAccount = md.attributes.author.replace(/^@/, "");
  const folderName = extractFolderNameFromFilename(filename);
  const comments: ReadonlyArray<CommentType> = md.attributes.comments.map((c) => {
    return {
      id: null,
      author: c.author,
      content: c.content,
      publishedAt: c.published_at,
    };
  });
  //console.log(md.attributes);

  if (!APPLY) {
    const dummy = ulid();
    return {
      id: dummy,
      path: `/notes/${dummy}`,
      author: authorAccount,
      title,
      content,
      folderName,
      publishedAt: md.attributes.published_at,
      comments,
    };
  }

  const authorId = null; // (await getAuthor(authorAccount)).id;

  const result = await client.request({
    query: CreateNote,
    variables: {
      input: {
        title,
        content,
        draft: !!publishedAt,
        coediting: true,
        groupIds: [], // TODO: speccified by --group option
        folderName,
        authorId,
        publishedAt,
      },
    },
  });

  return {
    id: result.data.createNote.note.id,
    path: result.data.createNote.note.path,
    author: authorAccount,
    title,
    content,
    folderName,
    publishedAt: md.attributes.published_at,
    comments,
  };
}

async function createComment(note, comment) {
  if (!APPLY) {
    const dummy = ulid();
    return {
      id: dummy,
      path: `${note.path}#comment_${dummy}`,
      content: comment.content,
    };
  }

  const result = await client.request({
    query: CreateComment,
    variables: {
      input: {
        commentableId: note.id,
        content: comment.content,
        publishedAt: new Date(comment.publishedAt).toISOString(),
        authorId: null, // TODO
      },
    },
  });

  return {
    id: result.data.createComment.comment.id,
    path: result.data.createComment.comment.path,
    content: comment.content,
  };
}

async function processZipArchives(zipArchives: ReadonlyArray<string>) {
  let id = 0;
  let dataSize = 0;
  let successCount = 0;
  let failureCount = 0;

  const logFile = `transaction-${TRANSACTION_ID}.log`;
  const logFh = await fs.promises.open(logFile, "wx");
  process.on("exit", () => {
    if (fs.statSync(logFile).size === 0 || !APPLY) {
      //fs.unlinkSync(logFile);
    }
  });
  process.on("SIGINT", () => {
    // just exit to handle "exit" events to cleanup
    process.exit();
  });

  for (const zipArchive of zipArchives) {
    const zipBuffer = await fs.promises.readFile(zipArchive);
    const directory = await unzipper.Open.buffer(zipBuffer);

    for (const file of directory.files) {
      const buffer = await file.buffer();

      const idTag = (++id).toString().padStart(5, "0");
      const label = APPLY ? "Processing" : "Processing (dry-run)";
      const byteLengthKiB = Math.round(buffer.byteLength / 1024);
      console.log(`${label} [${idTag}] ${file.path} (${byteLengthKiB} KiB)`);
      dataSize += buffer.byteLength;

      try {
        if (isAttachment(file.path)) {
          const newAttachment = await uploadAttachment(file.path, buffer);
          await logFh.appendFile(
            JSON.stringify({
              type: "attachment",
              file: file.path,
              sourceId: getSourceId(file.path),
              destPath: newAttachment.path,
              destId: newAttachment.id,
            }) + "\n",
          );
        } else {
          const markdownWithFrontMatter = buffer.toString("utf-8");
          const newNote = await createNote(file.path, markdownWithFrontMatter);
          await logFh.appendFile(
            JSON.stringify({
              type: "note",
              file: file.path,
              sourceId: getSourceId(file.path),
              destPath: newNote.path,
              destRelayId: newNote.id,
              content: newNote.content,
            }) + "\n",
          );

          for (const comment of newNote.comments) {
            const newComment = await createComment(newNote, comment);
            await logFh.appendFile(
              JSON.stringify({
                type: "comment",
                file: file.path,
                sourceId: getSourceId(file.path), // TODO: currently exported data has no comment id
                destPath: newComment.path,
                destRelayId: newComment.id,
                content: newComment.content,
              }) + "\n",
            );
          }
        }

        successCount++;
      } catch (e) {
        console.error(`Failed to request[${idTag}]`, e);
        failureCount++;
      }
    }
  }

  const dataSizeMiB = Math.round(dataSize / 1024 ** 2);
  console.log(
    `Uploaded data size=${dataSizeMiB}MiB, success/failure=${successCount}/${failureCount}`,
  );
  console.log(`\nInitial phase finished (logfile=${logFile})\n`);
}

processZipArchives(commander.args);
