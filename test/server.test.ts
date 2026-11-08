import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { DEFAULT_USER_AGENT } from "../src/lib/ckan.js";

const GSA_RESOURCE = "2d5abbad-4809-4900-b74f-b2f8b40bcfb8";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const samplePackage = {
  id: "pkg-uuid",
  name: "gsa",
  title: "רשימת חברות ממשלתיות ודירקטורים מכהנים",
  notes: "Government companies and sitting directors.",
  organization: { name: "mof", title: "משרד האוצר" },
  tags: [{ name: "gov-cos", display_name: "חברות ממשלתיות" }],
  resources: [
    {
      id: GSA_RESOURCE,
      name: "רשימת החברות הממשלתיות",
      format: "CSV",
      datastore_active: true,
      last_modified: "2026-11-08T05:00:09.772667",
    },
  ],
};

async function connect(fetchImpl?: typeof fetch) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(fetchImpl ? { fetch: fetchImpl } : {}).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP server", () => {
  it("lists all tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "describe_resource",
      "get_dataset",
      "list_featured_datasets",
      "search_datasets",
      "search_records",
    ]);
  });

  it("searches datasets through a mocked package_search", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith("/package_search")).toBe(true);
      expect(url.searchParams.get("q")).toBe("חברות ממשלתיות");
      expect(url.searchParams.get("rows")).toBe("10");
      return jsonResponse({ success: true, result: { count: 1, results: [samplePackage] } });
    };
    const client = await connect(fetchImpl);
    const res = await client.callTool({
      name: "search_datasets",
      arguments: { q: "חברות ממשלתיות" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      count: 1,
      datasets: [{ name: "gsa", datastoreActiveCount: 1, organization: "משרד האוצר" }],
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("gsa");
  });

  it("gets a dataset through a mocked package_show", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith("/package_show")).toBe(true);
      expect(url.searchParams.get("id")).toBe("gsa");
      return jsonResponse({ success: true, result: samplePackage });
    };
    const client = await connect(fetchImpl);
    const res = await client.callTool({ name: "get_dataset", arguments: { id: "gsa" } });
    expect(res.structuredContent).toMatchObject({
      name: "gsa",
      resources: [{ id: GSA_RESOURCE, datastore_active: true, format: "CSV" }],
    });
  });

  it("describes a datastore resource", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("resource_id")).toBe(GSA_RESOURCE);
      expect(url.searchParams.get("limit")).toBe("0");
      return jsonResponse({
        success: true,
        result: {
          total: 84,
          fields: [
            { id: "COMPANY_NAME", type: "text" },
            { id: "STATUS", type: "text" },
          ],
          records: [],
        },
      });
    };
    const client = await connect(fetchImpl);
    const res = await client.callTool({
      name: "describe_resource",
      arguments: { resource_id: GSA_RESOURCE },
    });
    expect(res.structuredContent).toMatchObject({
      resource_id: GSA_RESOURCE,
      total: 84,
      fields: [
        { id: "COMPANY_NAME", type: "text" },
        { id: "STATUS", type: "text" },
      ],
    });
  });

  it("searches datastore records", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("q")).toBe("חשמל");
      expect(url.searchParams.get("limit")).toBe("5");
      expect(url.searchParams.get("filters")).toBe(JSON.stringify({ STATUS: "פעיל" }));
      return jsonResponse({
        success: true,
        result: {
          total: 1,
          fields: [{ id: "COMPANY_NAME", type: "text" }],
          records: [{ COMPANY_NAME: "חברת החשמל" }],
        },
      });
    };
    const client = await connect(fetchImpl);
    const res = await client.callTool({
      name: "search_records",
      arguments: {
        resource_id: GSA_RESOURCE,
        q: "חשמל",
        filters: { STATUS: "פעיל" },
        limit: 5,
      },
    });
    expect(res.structuredContent).toMatchObject({
      total: 1,
      records: [{ COMPANY_NAME: "חברת החשמל" }],
    });
  });

  it("returns isError when CKAN fails instead of crashing the session", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        success: false,
        error: { message: "Not found" },
      });
    const client = await connect(fetchImpl);
    const res = await client.callTool({ name: "get_dataset", arguments: { id: "does-not-exist" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Not found");
  });

  it("lists featured datasets without touching the network", async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      throw new Error("network should not be used");
    };
    const client = await connect(fetchImpl);
    const all = await client.callTool({ name: "list_featured_datasets", arguments: {} });
    expect(all.isError).toBeFalsy();
    expect(fetches).toBe(0);
    const payload = all.structuredContent as { datasets: Array<{ name: string }>; note: string };
    expect(payload.note.toLowerCase()).toContain("curated");
    expect(payload.datasets.some((entry) => entry.name === "ica_companies")).toBe(true);
    expect(payload.datasets.filter((entry) => entry.name === "gsa")).toHaveLength(1);

    const vehicles = await client.callTool({
      name: "list_featured_datasets",
      arguments: { category: "vehicles" },
    });
    expect((vehicles.structuredContent as { datasets: Array<{ name: string }> }).datasets.map((entry) => entry.name)).toEqual(
      ["private-and-commercial-vehicles", "shinui_mivne"],
    );
    expect(fetches).toBe(0);
  });

  it("sends the documented User-Agent from tool calls", async () => {
    let agent: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      agent = new Headers(init?.headers).get("User-Agent");
      return jsonResponse({ success: true, result: { count: 0, results: [] } });
    };
    const client = await connect(fetchImpl);
    await client.callTool({ name: "search_datasets", arguments: { q: "test" } });
    expect(agent).toBe(DEFAULT_USER_AGENT);
  });
});
