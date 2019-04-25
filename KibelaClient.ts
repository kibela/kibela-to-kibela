// Kibela Client for NodeJS
// This will be released to npmjs.com when the API becomes stable.

import msgpack from "msgpack-lite";
import { StringDecoder } from "string_decoder";
import { DocumentNode, OperationDefinitionNode, print } from "graphql";
import { URL } from "url";
import debugBuilder from "debug";

// enabled by env DEBUG=KibelaClient
const debug = debugBuilder("KibelaClient");

const decoder = new StringDecoder("utf8");

function createEndpoint(subdomain: string) {
  return `http://${subdomain}.lvh.me:3000/api/v1`;
  // return `https://${subdomain}.kibe.la/api/v1`;
}

export const FORMAT_JSON = "application/json";
export const FORMAT_MSGPACK = "application/x-msgpack";
type FormatType = typeof FORMAT_JSON | typeof FORMAT_MSGPACK;

export interface DataSerializer {
  serialize(mimeType: string, body: object): ArrayBuffer | string;
  deserialize(mimeType: string, body: ArrayBuffer): any;
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

  deserialize(mimeType: string, body: ArrayBuffer) {
    if (mimeType === FORMAT_MSGPACK) {
      return msgpack.decode(Buffer.from(body));
    } else if (mimeType === FORMAT_JSON) {
      return JSON.parse(decoder.write(Buffer.from(body)));
    } else {
      // While Kibela is in maintenance mode, it may return text/html or text/plain for the API endpoint.
      return {
        errors: [
          {
            message: `Unrecognized content-type: ${mimeType}`,
            extensions: {
              code: "KibelaClient.UNRECOGNIZED_CONTENT_TYPE",
              contentType: mimeType,
            },
          },
        ],
      }
    }
  }
}

export const META = Symbol("META");

export type KibelaClientOptions = Readonly<{
  team: string;
  accessToken: string;
  userAgent: string;
  fetch: typeof fetch;

  leastDelayMs?: number;
  retryCount?: number;
  format?: FormatType;
  serializer?: DataSerializer;
}>;

function getOperationName(doc: DocumentNode): string | null {
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

export type ErrorType = BasicErrorType | BudgetExceededErrorType;

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
  constructor(
    message: string,
    readonly errors: ReadonlyArray<any>,
  ) {
    super(message);
  }
}

const DEFAULT_LEAST_DELAY_MS = 100; // as described in https://github.com/kibela/kibela-api-v1-document

const LEAST_DELAY_AFTER_NETWORK_ERROR_MS = 2000;

const DEFAULT_RETRY_COUNT = 0;

export class KibelaClient {
  private readonly endpoint: string;
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
    this.endpoint = createEndpoint(options.team);
    this.headers = {
      "content-type": this.format,
      accept: this.format,
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
    variables: VariablesType;
  }): Promise<{ data: DataType }> {
    const t0 = Date.now();

    this.retrying = 0;

    const networkErrors: Array<any> = [];

    const queryString = print(query);
    const operationName = getOperationName(query);
    const body = this.serializer.serialize(this.format, {
      query: queryString,
      operationName,
      variables,
    });
    const url = new URL(this.endpoint);
    if (operationName) {
      url.searchParams.set("operationName", operationName);
    }
    const tBeforeRawRequest = Date.now();

    let response: Response | null = null;
    let rawBody: ArrayBuffer | null = null;
    let responseBody: any = null;
    do {
      debug("fetch %s (retrying=%d/%d, delayMs=%d)", url, this.retrying, this.retryCount, this.delayMs);
      await this.sleep(this.delayMs);
      try {
        response = await this.fetch(url.toString(), {
          method: "POST",
          redirect: "follow",
          referrerPolicy: "unsafe-url", // useless for node-fetch, but recommended for browsers
          headers: this.headers,
          body,
        });
        rawBody = await response.arrayBuffer();
      } catch (e) { // Network errors including timeout
        this.delayMs = Math.max(this.delayMs * 2, LEAST_DELAY_AFTER_NETWORK_ERROR_MS);

        networkErrors.push(e);
        debug("Network error!", e);
        // fallthrough
      }

      if (response != null && rawBody != null) {
        const contentType = this.normalizeMimeType(response.headers.get("content-type")) || this.format;
        responseBody = this.serializer.deserialize(contentType, rawBody);

        if (responseBody.errors) {
          if (!this.addToDelayMsIfBudgetExhausted(responseBody.errors)) {
            break; // just break the retry loop unless budget exhausted errors
          }
        } else if (response.ok && responseBody.data) {
          break; // seems OK
        }
      }
    } while (++this.retrying < this.retryCount);

    const tAfterRawRequest = Date.now();

    if (responseBody && responseBody.errors) {
      this.addToDelayMsIfBudgetExhausted(responseBody.errors);

      throw new GraphqlError("GraphQL errors", queryString, variables, responseBody.errors);
    }

    if (!(response && response.ok && rawBody && responseBody && !responseBody.data)) {
      throw new NetworkError("Invalid GraphQL response", networkErrors);
    }

    // reset delayMs only if the requesrt succeeded.
    this.delayMs = this.leastDelayMs;

    const tEnd = Date.now();

    const xRuntime = Math.round(Number.parseFloat(response.headers.get("x-runtime") || "0") * 1000);
    responseBody[META] = {
      time: {
        serialize: tBeforeRawRequest - t0,
        api: xRuntime,
        htttp: tAfterRawRequest - tBeforeRawRequest - xRuntime,
        deserialize: tEnd - tAfterRawRequest,
        total: tEnd - t0,
      },
      contentType: response.headers.get("content-type"),
      contentLength: rawBody.byteLength,
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
