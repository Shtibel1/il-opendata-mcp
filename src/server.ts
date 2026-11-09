import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CkanClient, type CkanClientOptions } from "./lib/ckan.js";
import { FEATURED_CATEGORIES, listFeaturedDatasets } from "./lib/catalog.js";

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
});

function safe<A>(fn: (args: A) => unknown | Promise<unknown>) {
  return async (args: A) => {
    try {
      return json(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

const featuredCategoryEnum = z.enum(FEATURED_CATEGORIES);

export function createServer(options: CkanClientOptions = {}): McpServer {
  const server = new McpServer({ name: "il-opendata-mcp", version: "0.2.0" });
  const ckan = new CkanClient(options);

  server.registerTool(
    "search_datasets",
    {
      title: "Search data.gov.il datasets",
      description:
        "Search the Israeli government open-data catalog (data.gov.il CKAN package_search). Returns a compact list of matching datasets with titles, truncated notes, organizations, tags and resource summaries, including how many resources have an active datastore. Use list_featured_datasets for a curated starting point.",
      inputSchema: {
        q: z.string().describe("Free-text search query, e.g. 'חברות ממשלתיות' or 'fuel stations'"),
        rows: z.number().int().nonnegative().optional().describe("Number of datasets to return (default 10, max 50)"),
        start: z.number().int().nonnegative().optional().describe("Offset for pagination (default 0)"),
      },
    },
    safe(({ q, rows, start }: { q: string; rows?: number; start?: number }) =>
      ckan.searchDatasets({ q, rows, start }),
    ),
  );

  server.registerTool(
    "get_dataset",
    {
      title: "Get a data.gov.il dataset",
      description:
        "Fetch metadata and resources for one dataset by CKAN package name or UUID (package_show). Resource summaries include format, last_modified and whether datastore_active is true (needed before search_records).",
      inputSchema: {
        id: z.string().min(1).describe("Dataset name or UUID, e.g. 'gsa' or a package UUID"),
      },
    },
    safe(({ id }: { id: string }) => ckan.getDataset(id)),
  );

  server.registerTool(
    "describe_resource",
    {
      title: "Describe a datastore resource",
      description:
        "Return field names/types and the total record count for a CKAN datastore resource (datastore_search with limit 0). Fails with a clear error if the resource has no active datastore — use get_dataset to find resources where datastore_active is true.",
      inputSchema: {
        resource_id: z.string().min(1).describe("CKAN resource UUID"),
      },
    },
    safe(({ resource_id }: { resource_id: string }) => ckan.describeResource(resource_id)),
  );

  server.registerTool(
    "search_records",
    {
      title: "Search datastore records",
      description:
        "Query rows in a data.gov.il datastore resource (CKAN datastore_search). Supports full-text q, exact-match filters, field selection, limit (default 10, max 100) and offset. The resource must have an active datastore.",
      inputSchema: {
        resource_id: z.string().min(1).describe("CKAN resource UUID with datastore_active=true"),
        q: z.string().optional().describe("Full-text search across the datastore"),
        filters: z
          .record(z.string(), z.string())
          .optional()
          .describe('Exact-match field filters, e.g. { "STATUS": "פעיל" }'),
        limit: z.number().int().nonnegative().optional().describe("Number of records to return (default 10, max 100)"),
        offset: z.number().int().nonnegative().optional().describe("Offset for pagination (default 0)"),
        fields: z.array(z.string()).optional().describe("Optional list of field names to return"),
      },
    },
    safe(
      ({
        resource_id,
        q,
        filters,
        limit,
        offset,
        fields,
      }: {
        resource_id: string;
        q?: string;
        filters?: Record<string, string>;
        limit?: number;
        offset?: number;
        fields?: string[];
      }) => ckan.searchRecords({ resource_id, q, filters, limit, offset, fields }),
    ),
  );

  server.registerTool(
    "list_featured_datasets",
    {
      title: "List curated featured datasets",
      description:
        "Return a curated starting point of well-known data.gov.il datasets (companies, vehicles, education, fuel, government). This is not a complete index of the catalog — use search_datasets to find everything else. No network request is made.",
      inputSchema: {
        category: featuredCategoryEnum
          .default("all")
          .describe("Optional category filter: companies, vehicles, education, fuel, government, or all"),
      },
    },
    safe(({ category }: { category: (typeof FEATURED_CATEGORIES)[number] }) => ({
      note: "Curated starting point verified against data.gov.il, not a complete catalog index. Use search_datasets for everything else.",
      category,
      datasets: listFeaturedDatasets(category),
    })),
  );

  return server;
}
