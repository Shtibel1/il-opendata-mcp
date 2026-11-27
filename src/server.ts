import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  COUNT_GROUP_VALUES_MAX,
  CkanClient,
  FIELD_VALUES_LIMIT_MAX,
  FILTER_VALUES_MAX,
  SORT_KEYS_MAX,
  type CkanClientOptions,
  type FilterScalar,
  type RecordFilters,
  type SortKey,
} from "./lib/ckan.js";
import { FEATURED_CATEGORIES, FEATURED_DATASETS, listFeaturedDatasets } from "./lib/catalog.js";
import { VERSION } from "./version.js";

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

const filterScalar = z.union([z.string(), z.number(), z.boolean()]);
const filtersSchema = z
  .record(z.string(), z.union([filterScalar, z.array(filterScalar).min(1).max(FILTER_VALUES_MAX)]))
  .optional()
  .describe(
    'Exact-match field filters. A list means "any of these", e.g. { "tozeret_nm": ["טויוטה יפן", "מאזדה יפן"], "shnat_yitzur": 2026 }',
  );

const featuredCategoryEnum = z.enum(FEATURED_CATEGORIES);

const jsonResource = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
});

/** CKAN package names: lowercase letters, digits, "-" and "_" (2-100 chars). */
const DATASET_NAME_PATTERN = /^[a-z0-9_-]{2,100}$/;

/**
 * Build the MCP server. Pass client options, or an existing CkanClient to share
 * its response cache across server instances (the stateless HTTP transport does this).
 */
export function createServer(options: CkanClientOptions | CkanClient = {}): McpServer {
  const server = new McpServer({ name: "il-opendata-mcp", version: VERSION });
  const ckan = options instanceof CkanClient ? options : new CkanClient(options);

  server.registerTool(
    "search_datasets",
    {
      title: "Search data.gov.il datasets",
      description:
        "Search the Israeli government open-data catalog (data.gov.il CKAN package_search). Returns a compact list of matching datasets with titles, truncated notes, organizations, tags and resource summaries, including how many resources have an active datastore. Optionally restrict to one publishing organization (slug from list_organizations). Use list_featured_datasets for a curated starting point.",
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe("Free-text search query, e.g. 'חברות ממשלתיות' or 'fuel stations'. Omit to list everything (e.g. with organization)"),
        organization: z
          .string()
          .optional()
          .describe("Optional organization slug from list_organizations, e.g. 'ministry_of_transport'"),
        rows: z.number().int().nonnegative().optional().describe("Number of datasets to return (default 10, max 50)"),
        start: z.number().int().nonnegative().optional().describe("Offset for pagination (default 0)"),
      },
    },
    safe(
      ({ q, organization, rows, start }: { q?: string; organization?: string; rows?: number; start?: number }) =>
        ckan.searchDatasets({ q, organization, rows, start }),
    ),
  );

  server.registerTool(
    "list_organizations",
    {
      title: "List data.gov.il publishing organizations",
      description:
        "List the government ministries and authorities that publish on data.gov.il (CKAN organization_list), sorted by number of datasets. Optional q matches the slug or the Hebrew title, e.g. 'תחבורה' or 'transport'. Pass a returned name as search_datasets.organization.",
      inputSchema: {
        q: z.string().optional().describe("Substring to match in the organization slug or Hebrew title"),
        limit: z.number().int().nonnegative().optional().describe("Number of organizations to return (default 25, max 100)"),
        offset: z.number().int().nonnegative().optional().describe("Offset for pagination (default 0)"),
      },
    },
    safe(({ q, limit, offset }: { q?: string; limit?: number; offset?: number }) =>
      ckan.listOrganizations({ q, limit, offset }),
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
        "Query rows in a data.gov.il datastore resource (CKAN datastore_search). Supports full-text q, exact-match filters (a list means any of these), field selection, sort, limit (default 10, max 100) and offset. The resource must have an active datastore.",
      inputSchema: {
        resource_id: z.string().min(1).describe("CKAN resource UUID with datastore_active=true"),
        q: z.string().optional().describe("Full-text search across the datastore"),
        filters: filtersSchema,
        limit: z.number().int().nonnegative().optional().describe("Number of records to return (default 10, max 100)"),
        offset: z.number().int().nonnegative().optional().describe("Offset for pagination (default 0)"),
        fields: z.array(z.string()).optional().describe("Optional list of field names to return"),
        sort: z
          .array(
            z.object({
              field: z.string().min(1).describe("Field name from describe_resource"),
              direction: z.enum(["asc", "desc"]).optional().describe("asc (default) or desc"),
            }),
          )
          .max(SORT_KEYS_MAX)
          .optional()
          .describe(`Sort keys applied in order (max ${SORT_KEYS_MAX}), e.g. [{ "field": "shnat_yitzur", "direction": "desc" }]`),
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
        sort,
      }: {
        resource_id: string;
        q?: string;
        filters?: RecordFilters;
        limit?: number;
        offset?: number;
        fields?: string[];
        sort?: SortKey[];
      }) => ckan.searchRecords({ resource_id, q, filters, limit, offset, fields, sort }),
    ),
  );

  server.registerTool(
    "count_records",
    {
      title: "Count datastore records",
      description: `Exact number of records in a data.gov.il datastore resource that match optional q/filters, without downloading rows (datastore_search with limit 0). Optional group_by counts records per value of one field (up to ${COUNT_GROUP_VALUES_MAX} values, e.g. manufacturers or roles from list_field_values) and returns each count, its share of the total and the remainder ("other").`,
      inputSchema: {
        resource_id: z.string().min(1).describe("CKAN resource UUID with datastore_active=true"),
        q: z.string().optional().describe("Full-text search across the datastore"),
        filters: filtersSchema,
        group_by: z
          .object({
            field: z.string().min(1).describe("Field to break the count down by"),
            values: z
              .array(filterScalar)
              .min(1)
              .max(COUNT_GROUP_VALUES_MAX)
              .describe("Values of that field to count (exact match)"),
          })
          .optional()
          .describe('Optional breakdown, e.g. { "field": "tozeret_nm", "values": ["טויוטה יפן", "קיה קוריאה"] }'),
      },
    },
    safe(
      ({
        resource_id,
        q,
        filters,
        group_by,
      }: {
        resource_id: string;
        q?: string;
        filters?: RecordFilters;
        group_by?: { field: string; values: FilterScalar[] };
      }) => ckan.countRecords({ resource_id, q, filters, group_by }),
    ),
  );

  server.registerTool(
    "list_field_values",
    {
      title: "List distinct values of a field",
      description: `Distinct values of one field in a data.gov.il datastore resource (datastore_search with distinct=true), sorted, optionally under q/filters. Use it to discover valid filter values (statuses, cities, manufacturers) before search_records or count_records. limit caps the rows CKAN scans (default 100, max ${FIELD_VALUES_LIMIT_MAX}); complete=false means the list is partial.`,
      inputSchema: {
        resource_id: z.string().min(1).describe("CKAN resource UUID with datastore_active=true"),
        field: z.string().min(1).describe("Field name from describe_resource"),
        q: z.string().optional().describe("Full-text search across the datastore"),
        filters: filtersSchema,
        limit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(`Maximum values to return (default 100, max ${FIELD_VALUES_LIMIT_MAX})`),
      },
    },
    safe(
      ({
        resource_id,
        field,
        q,
        filters,
        limit,
      }: {
        resource_id: string;
        field: string;
        q?: string;
        filters?: RecordFilters;
        limit?: number;
      }) => ckan.listFieldValues({ resource_id, field, q, filters, limit }),
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

  server.registerResource(
    "featured-datasets",
    "opendata://featured",
    {
      title: "Featured data.gov.il datasets",
      description:
        "Curated, verified shortlist of well-known data.gov.il datasets (companies, vehicles, education, fuel, government). Not a complete index. No network request is made.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        note: "Curated starting point, not a complete catalog index. Read opendata://dataset/{name} or use search_datasets.",
        categories: FEATURED_CATEGORIES.filter((category) => category !== "all"),
        datasets: FEATURED_DATASETS,
      }),
  );

  server.registerResource(
    "organizations",
    "opendata://organizations",
    {
      title: "data.gov.il publishing organizations",
      description:
        "Every ministry and authority that publishes on data.gov.il, sorted by number of datasets (CKAN organization_list). Use a name as search_datasets.organization.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, await ckan.listOrganizations({ limit: 1000 })),
  );

  server.registerResource(
    "dataset",
    new ResourceTemplate("opendata://dataset/{name}", {
      // Advertise the curated datasets; any valid CKAN package name can be read.
      list: async () => ({
        resources: FEATURED_DATASETS.map((dataset) => ({
          uri: `opendata://dataset/${dataset.name}`,
          name: dataset.name,
          title: dataset.titleHe,
          description: dataset.why,
          mimeType: "application/json",
        })),
      }),
      complete: {
        name: (value) => FEATURED_DATASETS.map((dataset) => dataset.name).filter((name) => name.startsWith(value)),
      },
    }),
    {
      title: "data.gov.il dataset metadata",
      description:
        "Compact metadata and resource list for one data.gov.il dataset by CKAN package name (package_show), e.g. opendata://dataset/gsa.",
      mimeType: "application/json",
    },
    async (uri, { name }) => {
      const id = decodeURIComponent(String(Array.isArray(name) ? name[0] : name));
      if (!DATASET_NAME_PATTERN.test(id)) {
        throw new Error(`Invalid dataset name "${id}": expected a CKAN package name such as "gsa"`);
      }
      return jsonResource(uri, await ckan.getDataset(id));
    },
  );

  return server;
}
