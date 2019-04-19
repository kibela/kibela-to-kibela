// Kibela Client for NodeJS
// This will be released to npmjs.com when the API becomes stable.

import msgpack from "msgpack-lite";
import { StringDecoder } from "string_decoder";
import { DocumentNode, OperationDefinitionNode, print } from "graphql";
import { URL } from "url";

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
      throw new Error(`Unrecognized MIME type: ${mimeType}`);
    }
  }
}

export const META = Symbol('META');

export type KibelaClientOptions = Readonly<{
  team: string;
  accessToken: string;
  userAgent: string;
  fetch: typeof fetch;

  format?: FormatType;
  serializer?: DataSerializer;
}>;

function getOperationName(doc: DocumentNode): string | null {
  return (
    doc.definitions
      .filter(
        (definition): definition is OperationDefinitionNode => {
          return (
            definition.kind === "OperationDefinition" && definition.name != null
          );
        }
      )
      .map(node => node.name!.value)[0] || null
  );
}

export type ErrorType = {
  message?: string;
  extensions?: {
    code?: string;
  };
};

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly query: string,
    readonly variables: unknown,
    readonly errors: ReadonlyArray<ErrorType>
  ) {
    super(message);
  }
}

export class KibelaClient {
  private readonly endpoint: string;
  private readonly format: FormatType;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetch: typeof fetch; // browser's fetch
  private readonly serializer: DataSerializer;

  constructor(options: KibelaClientOptions) {
    this.format = options.format || FORMAT_MSGPACK;
    this.endpoint = createEndpoint(options.team);
    this.headers = {
      "content-type": this.format,
      accept: this.format,
      authorization: `Bearer ${options.accessToken}`
    };
    this.fetch = options.fetch;
    this.serializer = options.serializer || new DefaultSerializer();
  }

  async request<DataType extends {} = any, VariablesType extends {} = {}>({
    query,
    variables
  }: {
    query: DocumentNode;
    variables: VariablesType;
  }): Promise<{ data: DataType }> {
    const t0 = Date.now();

    const queryString = print(query);
    const operationName = getOperationName(query);
    const body = this.serializer.serialize(this.format, {
      query: queryString,
      operationName,
      variables
    });
    const url = new URL(this.endpoint);
    if (operationName) {
      url.searchParams.set("operationName", operationName);
    }
    const tBeforeRawRequest = Date.now();

    const response = await this.fetch(url.toString(), {
      method: "POST",
      headers: this.headers,
      referrerPolicy: "unsafe-url",
      body
    });

    const rawBody = await response.arrayBuffer();

    const tAfterRawRequest = Date.now();

    const contentType =
      this.normalizeMimeType(response.headers.get("content-type")) ||
      this.format;
    const responseBody = this.serializer.deserialize(contentType, rawBody);

    if (responseBody == null) {
      throw new Error("Response body is null");
    }
    if (responseBody.errors) {
      throw new GraphqlError(
        "Invalid response",
        queryString,
        variables,
        responseBody.errors
      );
    }

    if (!response.ok) {
      throw new Error(
        `Response is not ok but ${response.status} ${response.statusText}`
      );
    }

    if (!responseBody.data) {
      throw new Error("Response body has no `data` field");
    }

    const tEnd = Date.now();
    const xRuntime = Math.round(Number.parseFloat(response.headers.get("x-runtime") || '0') * 1000);
    responseBody[META] = {
      time: {
        serialize: tBeforeRawRequest - t0,
        api: xRuntime,
        htttp: (tAfterRawRequest - tBeforeRawRequest) - xRuntime,
        deserialize: tEnd - tAfterRawRequest,
        total: tEnd - t0,
      },
      contentType: response.headers.get('content-type'),
      contentLength: rawBody.byteLength,
    };

    return responseBody;
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
}
