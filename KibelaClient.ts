// Kibela Client for JavaScript
// This will be released to npmjs.com when the API gets stable.

import * as msgpack from "@msgpack/msgpack";
import { DocumentNode, OperationDefinitionNode, print } from "graphql";
import { URL } from "url";
import { inspect } from "util";
import debugBuilder from "debug";

// enabled by env DEBUG=KibelaClient
const debug = debugBuilder("KibelaClient");

const DEFAULT_ENDPOINT = "https://${KIBELA_TEAM}.kibe.la/api/v1";
export function createEndpoint(subdomain: string, endpoint = DEFAULT_ENDPOINT) {
  return endpoint.replace(/\${KIBELA_TEAM}/, subdomain);
}

export const FORMAT_JSON = "application/json";
export const FORMAT_MSGPACK = "application/x-msgpack";
type FormatType = typeof FORMAT_JSON | typeof FORMAT_MSGPACK;

export interface DataSerializer {
  serialize(mimeType: string, body: object): ArrayBufferView | string;
  deserialize<T = unknown>(mimeType: string, response: Response): Promise<T>;
}

function isAsyncIterable<T>(stream: object): stream is AsyncIterable<T> {
  return !!stream[Symbol.asyncIterator];
}

async function* asyncIterableFromStream(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | null,
) {
  if (stream == null) {
    return;
  }

  // node-fetch
  if (isAsyncIterable(stream)) {
    for await (const buffer of stream) {
      yield buffer;
    }
    return;
  }

  // WHATWG fetch (not an async iterators)
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class DefaultSerializer implements DataSerializer {
  serialize(mimeType: string, body: object) {
    if (mimeType === FORMAT_MSGPACK) {
      return msgpack.encode(body);
    } else if (mimeType === FORMAT_JSON) {
      return JSON.stringify(body);
    } else {
      throw new Error(`Unrecognized MIME type: ${mimeType}`);
    }
  }

  async deserialize(mimeType: string, response: Response): Promise<any> {
    if (mimeType === FORMAT_MSGPACK) {
      return await msgpack.decodeAsync(asyncIterableFromStream(response.body));
    } else if (mimeType === FORMAT_JSON) {
      return await response.json();
    } else {
      // While Kibela is in maintenance mode, it may return text/html or text/plain for the API endpoint.
      return {
        errors: [
          {
            message: `Unrecognized content-type: ${mimeType}`,
            extensions: {
              code: "KibelaClient.UNRECOGNIZED_CONTENT_TYPE",
              contentType: mimeType,
              body: mimeType.startsWith("text/")
                ? await response.text()
                : new Uint8Array(await response.arrayBuffer()),
            },
          },
        ],
      };
    }
  }
}

export const $metadata = Symbol("metadata");

export type KibelaClientOptions = Readonly<{
  team: string;
  accessToken: string;
  userAgent: string;
  fetch: typeof window.fetch; // it also works on NodeJS

  leastDelayMs?: number;
  retryCount?: number;
  format?: FormatType;
  serializer?: DataSerializer;
  endpoint?: string;
}>;

export function getOperationName(doc: DocumentNode): string | null {
  return (
    doc.definitions
      .filter(
        (definition): definition is OperationDefinitionNode => {
          return definition.kind === "OperationDefinition" && definition.name != null;
        },
      )
      .map((node) => node.name!.value)[0] || null
  );
}

export type BasicErrorType = {
  message?: string;
  extensions?: {
    code?: string;
  };
};

export type BudgetExceededErrorType = {
  extensions: {
    code: "TOKEN_BUDGET_EXHAUSTED" | "TEAM_BUDGET_EXHAUSTED";
    waitMilliseconds: number;
  };
};

export type NotFoundError = {
  extensions: {
    code: "NOT_FOUND";
  };
};

export type ErrorType = BasicErrorType | BudgetExceededErrorType | NotFoundError;

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly query: string,
    readonly variables: unknown,
    readonly errors: ReadonlyArray<ErrorType>,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  constructor(message: string, readonly errors: ReadonlyArray<any>) {
    super(message);
  }
}

export function isNotFoundError(e: unknown): e is NotFoundError {
  if (e instanceof GraphqlError) {
    const ext = e.errors[0].extensions;
    if (ext && ext.code === "NOT_FOUND") {
      return true;
    }
  }
  return false;
}

// As described in https://github.com/kibela/kibela-api-v1-documentconst
const DEFAULT_LEAST_DELAY_MS = 100;
const LEAST_DELAY_AFTER_NETWORK_ERROR_MS = 1000;

const DEFAULT_RETRY_COUNT = 0;

export class KibelaClient {
  public readonly endpoint: string;
  private readonly format: FormatType;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetch: typeof fetch; // browser's fetch
  private readonly serializer: DataSerializer;
  private readonly leastDelayMs: number;
  private readonly retryCount: number;

  private delayMs = 0;
  private retrying = 0;

  constructor(options: KibelaClientOptions) {
    this.format = options.format || FORMAT_MSGPACK;
    this.endpoint = createEndpoint(options.team, options.endpoint);
    this.headers = {
      "user-agent": options.userAgent,
      "content-type": this.format,
      accept: this.format !== FORMAT_JSON ? `${this.format}, application/json` : this.format,
      authorization: `Bearer ${options.accessToken}`,
    };
    this.fetch = options.fetch;
    this.serializer = options.serializer || new DefaultSerializer();
    this.leastDelayMs = options.leastDelayMs || DEFAULT_LEAST_DELAY_MS;
    this.retryCount = options.retryCount || DEFAULT_RETRY_COUNT;
  }

  async request<DataType extends {} = any, VariablesType extends {} = {}>({
    query,
    variables,
  }: {
    query: DocumentNode;
    variables?: VariablesType;
  }): Promise<{ data: DataType }> {
    const t0 = Date.now();

    this.retrying = 0;

    const networkErrors: Array<any> = [];

    const operationName = getOperationName(query);
    if (!operationName) {
      throw new Error("GraphQL query's operationName is required");
    }

    const queryString = print(query);
    const body = this.serializer.serialize(this.format, {
      query: queryString,
      operationName,
      variables,
    });
    const url = new URL(this.endpoint);
    if (operationName) {
      url.searchParams.set("operationName", operationName);
    }
    const tBeforeRequest = Date.now();

    let response: Response | null = null;
    let responseBody: any = null;
    do {
      debug(
        "fetch %s (retrying=%d/%d, delayMs=%d)",
        url,
        this.retrying,
        this.retryCount,
        this.delayMs,
      );
      await this.sleep(this.delayMs);
      try {
        response = await this.fetch(url.toString(), {
          method: "POST",
          redirect: "follow",
          referrerPolicy: "unsafe-url", // useless for node-fetch, but recommended for browsers
          headers: this.headers,
          body,
        });
      } catch (e) {
        // Network errors including timeout
        this.delayMs = Math.max(this.delayMs * 2, LEAST_DELAY_AFTER_NETWORK_ERROR_MS);

        networkErrors.push(e);
        debug("Network error!", e);
        // fallthrough
      }

      if (response != null) {
        const contentType =
          this.normalizeMimeType(response.headers.get("content-type")) || this.format;

        // TODO: handle network errors when downloading response body is not finished.
        responseBody = await this.serializer.deserialize(contentType, response);

        if (responseBody.errors) {
          if (!this.addToDelayMsIfBudgetExhausted(responseBody.errors)) {
            break; // just break the retry loop unless budget exhausted errors
          }
        } else if (response.ok && responseBody.data) {
          break; // seems OK
        }
      }
    } while (++this.retrying < this.retryCount);

    const tAfterRequest = Date.now();

    if (!response) {
      throw new NetworkError("Invalid HTTP response", networkErrors);
    }

    if (responseBody && responseBody.errors) {
      this.addToDelayMsIfBudgetExhausted(responseBody.errors);
      throw new GraphqlError("GraphQL errors", queryString, variables, responseBody.errors);
    }

    if (!(response.ok && responseBody && responseBody.data)) {
      throw new NetworkError(
        `Invalid GraphQL response: ${response.status} ${response.statusText} ${response.headers.get(
          "content-type",
        )} ${inspect(responseBody)}`,
        networkErrors,
      );
    }

    const tEnd = Date.now();
    const xRuntime = Math.round(Number.parseFloat(response.headers.get("x-runtime") || "0") * 1000);

    // request metadata
    responseBody[$metadata] = {
      time: {
        api: xRuntime,
        client: tAfterRequest - tBeforeRequest - xRuntime,
        total: tEnd - t0,
      },
      contentType: response.headers.get("content-type"),
    };

    return responseBody;
  }

  private addToDelayMsIfBudgetExhausted(errors: ReadonlyArray<ErrorType>) {
    if (errors.length == 1) {
      const x = errors[0].extensions;
      if (x && (x.code === "TOKEN_BUDGET_EXHAUSTED" || x.code === "TEAM_BUDGET_EXHAUSTED")) {
        this.delayMs = Math.min(this.leastDelayMs, x["waitMilliseconds"]);
        return true;
      }
    }

    return false;
  }

  private normalizeMimeType(type: string | null): string | null {
    if (type) {
      return type
        .split(/;/)[0]
        .trim()
        .toLocaleLowerCase();
    } else {
      return type;
    }
  }

  private sleep(value: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, value);
    });
  }
}
