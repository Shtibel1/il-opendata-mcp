#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, parseAllowedOrigins, startHttpServer } from "./http.js";
import { createServer } from "./server.js";

const { values } = parseArgs({
  options: {
    http: { type: "boolean", default: false },
    port: { type: "string" },
    host: { type: "string" },
    "allowed-origin": { type: "string", multiple: true },
    "cache-ttl": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.error(`il-opendata-mcp — Israeli open data (data.gov.il) MCP server

Usage:
  il-opendata-mcp                         speak MCP over stdio (default)
  il-opendata-mcp --http [--port 3000] [--host 127.0.0.1] [--allowed-origin https://app.example]
                                          serve Streamable HTTP at /mcp (stateless) and GET /healthz

Options:
  --cache-ttl <seconds>                   cache data.gov.il responses in memory for this long
                                          (default 300, 0 disables; shared by all HTTP requests)

Environment: PORT, HOST, ALLOWED_ORIGINS (comma-separated) and IL_OPENDATA_CACHE_TTL are used when the flags are omitted.`);
  process.exit(0);
}

const rawTtl = values["cache-ttl"] ?? process.env.IL_OPENDATA_CACHE_TTL;
let cacheTtlMs: number | undefined;
if (rawTtl !== undefined && rawTtl.trim() !== "") {
  const seconds = Number(rawTtl);
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.error(`Invalid cache TTL: ${rawTtl}`);
    process.exit(1);
  }
  cacheTtlMs = seconds * 1000;
}

if (values.http) {
  const port = Number(values.port ?? process.env.PORT ?? DEFAULT_HTTP_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${values.port ?? process.env.PORT}`);
    process.exit(1);
  }
  const host = values.host ?? process.env.HOST ?? DEFAULT_HTTP_HOST;
  let allowedOrigins: string[];
  try {
    allowedOrigins = values["allowed-origin"]?.length
      ? parseAllowedOrigins(values["allowed-origin"].join(","))
      : parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const running = await startHttpServer({ host, port, allowedOrigins, cacheTtlMs });
  console.error(`il-opendata-mcp listening on ${running.url}`);
  const shutdown = () => void running.close().finally(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else {
  const server = createServer({ cacheTtlMs });
  await server.connect(new StdioServerTransport());
  console.error("il-opendata-mcp running on stdio");
}
