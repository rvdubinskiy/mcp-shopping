import type { ZodSchema, z } from "zod";

declare module "@modelcontextprotocol/sdk/server" {
  export interface ToolResponseContentText {
    type: "text";
    text: string;
  }

  export interface ToolResponseContentJson {
    type: "json";
    json: unknown;
  }

  export type ToolResponseContent = ToolResponseContentText | ToolResponseContentJson;

  export interface ToolHandlerContext {
    signal?: AbortSignal;
  }

  export interface ToolHandlerResult {
    content: ToolResponseContent[];
  }

  export interface ToolDefinition<TInput> {
    name: string;
    description: string;
    inputSchema: ZodSchema<TInput> | z.ZodType<TInput>;
    handler: (input: TInput, context: ToolHandlerContext) => Promise<ToolHandlerResult>;
  }

  export interface ServerOptions {
    name: string;
    version: string;
    description?: string;
  }

  export class Server {
    constructor(options: ServerOptions);
    registerTool<TInput>(definition: ToolDefinition<TInput>): void;
    start(): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/client" {
  export interface ClientTransportOptions {
    type: "stdio";
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
  }

  export interface ClientOptions {
    transport: ClientTransportOptions;
  }

  export interface ToolCall {
    name: string;
    input: unknown;
  }

  export interface ToolResponseContentText {
    type: "text";
    text?: string;
  }

  export interface ToolResponseContentJson {
    type: "json";
    json?: unknown;
  }

  export type ToolResponseContent = ToolResponseContentText | ToolResponseContentJson;

  export interface ToolResponse {
    content: ToolResponseContent[];
  }

  export class Client {
    constructor(options: ClientOptions);
    connect(): Promise<void>;
    callTool(call: ToolCall): Promise<ToolResponse>;
    close(): Promise<void>;
  }
}
