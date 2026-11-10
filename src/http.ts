import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CkanClientOptions } from "./lib/ckan.js";
import { createServer } from "./server.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3000;
export const MCP_PATH = "/mcp";
export const MAX_BODY_BYTES = 1_000_000;

export interface HttpServerOptions extends CkanClientOptions {
  /** Interface to bind. Defaults to 127.0.0.1 so the server is not exposed by accident. */
  host?: string;
  /** TCP port. Use 0 for an ephemeral port (handy in tests). */
  port?: number;
  /**
   * Allowed browser origins. Requests with an Origin header not in this list are
   * rejected with 403 (DNS-rebinding protection). Requests without Origin
   * (CLI clients, server-to-server) are always allowed.
   */
  allowedOrigins?: string[];
}

/**
 * Parse a comma- or whitespace-separated list of origins (e.g. the ALLOWED_ORIGINS
 * env var) into a de-duplicated array. Trailing slashes are dropped because browsers
 * never send them in the Origin header. Throws on anything that is not an http(s) origin.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const origins = new Set<string>();
  for (const entry of raw.split(/[\s,]+/)) {
    const value = entry.trim().replace(/\/+$/, "");
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid origin: ${entry}`);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
      throw new Error(`Invalid origin (expected scheme://host[:port]): ${entry}`);
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export interface RunningHttpServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Parse error: body is not valid JSON");
  }
}

/**
 * Serve the MCP tools over Streamable HTTP in stateless mode: every POST to
 * /mcp gets a fresh McpServer + transport, so instances can scale horizontally
 * behind a load balancer with no sticky sessions. GET /healthz is a liveness probe.
 */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<RunningHttpServer> {
  const { host = DEFAULT_HTTP_HOST, port = DEFAULT_HTTP_PORT, allowedOrigins, ...ckanOptions } = options;

  const server = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/healthz" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", name: "il-opendata-mcp" });
      return;
    }
    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const origin = req.headers.origin;
    if (origin && !(allowedOrigins ?? []).includes(origin)) {
      rpcError(res, 403, `Origin not allowed: ${origin}`);
      return;
    }

    if (req.method !== "POST") {
      // Stateless mode has no server-initiated stream or session to delete.
      res.setHeader("Allow", "POST");
      rpcError(res, 405, "Method not allowed. This server is stateless; use POST.");
      return;
    }

    try {
      const body = await readJsonBody(req);
      const mcp = createServer(ckanOptions);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) rpcError(res, err.status, err.message);
      else rpcError(res, 500, "Internal server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    server,
    url: `http://${urlHost}:${address.port}${MCP_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
