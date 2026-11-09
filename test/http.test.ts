import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";

let running: RunningHttpServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const mockFetch = (async () =>
  new Response(
    JSON.stringify({ success: true, result: { count: 1, results: [{ id: "x", name: "gsa", title: "GSA", resources: [] }] } }),
    { headers: { "Content-Type": "application/json" } },
  )) as typeof fetch;

async function connect(url: string) {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("Streamable HTTP transport", () => {
  it("serves tools to a real MCP client over HTTP", async () => {
    running = await startHttpServer({ port: 0, fetch: mockFetch });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = await connect(running.url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("search_datasets");

    const featured = await client.callTool({ name: "list_featured_datasets", arguments: { category: "fuel" } });
    expect(featured.isError).toBeFalsy();

    const search = await client.callTool({ name: "search_datasets", arguments: { q: "gsa" } });
    expect((search.structuredContent as { count: number }).count).toBe(1);
    await client.close();
  });

  it("is stateless: separate clients work independently", async () => {
    running = await startHttpServer({ port: 0, fetch: mockFetch });
    const [a, b] = await Promise.all([connect(running.url), connect(running.url)]);
    const [ta, tb] = await Promise.all([a.listTools(), b.listTools()]);
    expect(ta.tools.length).toBe(tb.tools.length);
    await Promise.all([a.close(), b.close()]);
  });

  it("exposes a health check", async () => {
    running = await startHttpServer({ port: 0 });
    const res = await fetch(running.url.replace(/\/mcp$/, "/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "il-opendata-mcp" });
  });

  it("returns 404 for unknown paths and 405 for GET /mcp", async () => {
    running = await startHttpServer({ port: 0 });
    expect((await fetch(running.url.replace(/\/mcp$/, "/nope"))).status).toBe(404);
    const get = await fetch(running.url);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("rejects invalid JSON with 400", async () => {
    running = await startHttpServer({ port: 0 });
    const res = await fetch(running.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("blocks disallowed browser origins and allows listed ones", async () => {
    running = await startHttpServer({ port: 0, allowedOrigins: ["https://ok.example"] });
    const init = (origin: string) => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Origin: origin,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });
    expect((await fetch(running.url, init("https://evil.example"))).status).toBe(403);
    expect((await fetch(running.url, init("https://ok.example"))).status).toBe(200);
  });
});
