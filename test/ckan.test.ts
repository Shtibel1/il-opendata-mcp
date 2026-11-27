import { describe, expect, it } from "vitest";
import {
  CkanClient,
  DEFAULT_BASE_URL,
  DEFAULT_USER_AGENT,
  NOTES_MAX_CHARS,
  COUNT_GROUP_VALUES_MAX,
  FIELD_VALUES_LIMIT_MAX,
  buildSortClause,
  capDatastoreLimit,
  capFieldValuesLimit,
  serializeFilters,
  validateFieldName,
  capOrganizationsLimit,
  capSearchRows,
  mapOrganizationListItem,
  mapPackage,
  organizationFilterQuery,
  truncateNotes,
} from "../src/lib/ckan.js";

const GSA_RESOURCE = "2d5abbad-4809-4900-b74f-b2f8b40bcfb8";

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "",
    headers: { "Content-Type": "application/json" },
  });
}

function samplePackage(overrides: Record<string, unknown> = {}) {
  return {
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
      {
        id: "res-inactive",
        name: "legacy-export",
        format: "XLSX",
        datastore_active: false,
        last_modified: null,
      },
    ],
    ...overrides,
  };
}

describe("pagination helpers", () => {
  it("defaults search rows to 10 and caps at 50", () => {
    expect(capSearchRows()).toBe(10);
    expect(capSearchRows(5)).toBe(5);
    expect(capSearchRows(999)).toBe(50);
    expect(capSearchRows(-3)).toBe(0);
  });

  it("defaults datastore limit to 10 and caps at 100", () => {
    expect(capDatastoreLimit()).toBe(10);
    expect(capDatastoreLimit(25)).toBe(25);
    expect(capDatastoreLimit(999)).toBe(100);
  });

  it("truncates notes to 500 characters", () => {
    const long = "נ".repeat(600);
    expect(truncateNotes(long)).toHaveLength(NOTES_MAX_CHARS);
    expect(truncateNotes("short")).toBe("short");
    expect(truncateNotes(undefined)).toBe("");
  });
});

describe("mapPackage", () => {
  it("maps a compact dataset shape and counts datastore-active resources", () => {
    const mapped = mapPackage(samplePackage());
    expect(mapped).toMatchObject({
      name: "gsa",
      title: "רשימת חברות ממשלתיות ודירקטורים מכהנים",
      organization: "משרד האוצר",
      tags: ["חברות ממשלתיות"],
      datastoreActiveCount: 1,
    });
    expect(mapped.resources).toHaveLength(2);
    expect(mapped.resources[0]).toMatchObject({
      id: GSA_RESOURCE,
      format: "CSV",
      datastore_active: true,
    });
  });
});

describe("CkanClient", () => {
  it("builds package_search URLs with query, capped rows and start", async () => {
    const seen: string[] = [];
    const client = new CkanClient({
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse({ success: true, result: { count: 0, results: [] } });
      },
    });
    await client.searchDatasets({ q: "חינוך", rows: 999, start: 20 });
    const url = new URL(seen[0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${DEFAULT_BASE_URL}/package_search`);
    expect(url.searchParams.get("q")).toBe("חינוך");
    expect(url.searchParams.get("rows")).toBe("50");
    expect(url.searchParams.get("start")).toBe("20");
  });

  it("defaults search rows to 10 and sends the default User-Agent", async () => {
    let headers: Headers | undefined;
    const client = new CkanClient({
      fetch: async (input, init) => {
        headers = new Headers(init?.headers);
        expect(String(input)).toContain("rows=10");
        return jsonResponse({ success: true, result: { count: 0, results: [] } });
      },
    });
    await client.searchDatasets({ q: "fuel" });
    expect(headers?.get("User-Agent")).toBe(DEFAULT_USER_AGENT);
    expect(headers?.get("Accept")).toBe("application/json");
  });

  it("parses a successful package_search into a compact list", async () => {
    const notes = "x".repeat(620);
    const client = new CkanClient({
      fetch: async () =>
        jsonResponse({
          success: true,
          result: { count: 12, results: [samplePackage({ notes })] },
        }),
    });
    const result = await client.searchDatasets({ q: "gsa" });
    expect(result.count).toBe(12);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].name).toBe("gsa");
    expect(result.datasets[0].notes).toHaveLength(NOTES_MAX_CHARS);
    expect(result.datasets[0].datastoreActiveCount).toBe(1);
  });

  it("throws a clear error when CKAN returns success:false", async () => {
    const client = new CkanClient({
      fetch: async () =>
        jsonResponse({
          success: false,
          error: { __type: "Search Error", message: "SOLR returned an error" },
        }),
    });
    await expect(client.searchDatasets({ q: "x" })).rejects.toThrow("SOLR returned an error");
  });

  it("throws on HTTP errors", async () => {
    const client = new CkanClient({
      fetch: async () => new Response("gateway exploded", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(client.searchDatasets({ q: "x" })).rejects.toThrow("CKAN HTTP 502 Bad Gateway for package_search");
  });

  it("uses a custom base URL", async () => {
    let called = "";
    const client = new CkanClient({
      baseUrl: "https://example.test/api/3/action/",
      fetch: async (input) => {
        called = String(input);
        return jsonResponse({
          success: true,
          result: samplePackage(),
        });
      },
    });
    await client.getDataset("gsa");
    expect(called.startsWith("https://example.test/api/3/action/package_show?")).toBe(true);
  });

  it("fetches a single dataset via package_show", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.pathname.endsWith("/package_show")).toBe(true);
        expect(url.searchParams.get("id")).toBe("gsa");
        return jsonResponse({ success: true, result: samplePackage() });
      },
    });
    const dataset = await client.getDataset("gsa");
    expect(dataset.name).toBe("gsa");
    expect(dataset.resources[0].id).toBe(GSA_RESOURCE);
  });

  it("describes a datastore resource with limit 0", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.pathname.endsWith("/datastore_search")).toBe(true);
        expect(url.searchParams.get("resource_id")).toBe(GSA_RESOURCE);
        expect(url.searchParams.get("limit")).toBe("0");
        return jsonResponse({
          success: true,
          result: {
            total: 84,
            fields: [
              { id: "_id", type: "int" },
              { id: "COMPANY_NAME", type: "text" },
              { id: "STATUS", type: "text" },
            ],
            records: [],
          },
        });
      },
    });
    const described = await client.describeResource(GSA_RESOURCE);
    expect(described).toEqual({
      resource_id: GSA_RESOURCE,
      total: 84,
      fields: [
        { id: "COMPANY_NAME", type: "text" },
        { id: "STATUS", type: "text" },
      ],
    });
  });

  it("explains when a resource has no active datastore", async () => {
    const client = new CkanClient({
      fetch: async () =>
        jsonResponse({
          success: false,
          error: { __type: "Not Found Error", message: "Not found: Resource" },
        }),
    });
    await expect(client.describeResource("missing-resource")).rejects.toThrow(
      /Resource has no active datastore \(missing-resource\): Not found: Resource/,
    );
  });

  it("searches records with q, filters, fields, offset and a capped limit", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("resource_id")).toBe(GSA_RESOURCE);
        expect(url.searchParams.get("q")).toBe("חשמל");
        expect(url.searchParams.get("limit")).toBe("100");
        expect(url.searchParams.get("offset")).toBe("5");
        expect(url.searchParams.get("fields")).toBe("COMPANY_NAME,STATUS");
        expect(url.searchParams.get("filters")).toBe(JSON.stringify({ STATUS: "פעיל" }));
        return jsonResponse({
          success: true,
          result: {
            total: 1,
            fields: [
              { id: "COMPANY_NAME", type: "text" },
              { id: "STATUS", type: "text" },
            ],
            records: [{ COMPANY_NAME: "חברת החשמל", STATUS: "פעיל" }],
          },
        });
      },
    });
    const result = await client.searchRecords({
      resource_id: GSA_RESOURCE,
      q: "חשמל",
      filters: { STATUS: "פעיל" },
      limit: 999,
      offset: 5,
      fields: ["COMPANY_NAME", "STATUS"],
    });
    expect(result.total).toBe(1);
    expect(result.records[0]).toMatchObject({ COMPANY_NAME: "חברת החשמל" });
    expect(result.fields.map((field) => field.id)).toEqual(["COMPANY_NAME", "STATUS"]);
  });

  it("defaults datastore search limit to 10", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        expect(new URL(String(input)).searchParams.get("limit")).toBe("10");
        return jsonResponse({ success: true, result: { total: 0, fields: [], records: [] } });
      },
    });
    const result = await client.searchRecords({ resource_id: GSA_RESOURCE });
    expect(result.records).toEqual([]);
  });
});

describe("datastore query helpers", () => {
  it("builds quoted sort clauses and rejects unsafe or excessive keys", () => {
    expect(buildSortClause(undefined)).toBeUndefined();
    expect(buildSortClause([])).toBeUndefined();
    expect(buildSortClause([{ field: "shnat_yitzur", direction: "desc" }, { field: " mispar_rechev " }])).toBe(
      '"shnat_yitzur" desc, "mispar_rechev" asc',
    );
    expect(buildSortClause([{ field: "שם עיר" }])).toBe('"שם עיר" asc');
    expect(() => buildSortClause([{ field: 'x" desc; --' }])).toThrow(/Invalid sort field/);
    expect(() => buildSortClause([{ field: "a,b" }])).toThrow(/Invalid sort field/);
    expect(() => buildSortClause([{ field: "a", direction: "sideways" as "asc" }])).toThrow(/sort direction/);
    expect(() => buildSortClause(Array.from({ length: 6 }, (_, i) => ({ field: `f${i}` })))).toThrow(/at most 5/);
  });

  it("validates field names", () => {
    expect(validateFieldName("  COMPANY_NAME ")).toBe("COMPANY_NAME");
    expect(() => validateFieldName("")).toThrow(/Invalid field/);
    expect(() => validateFieldName("a\\b")).toThrow(/Invalid field/);
    expect(() => validateFieldName("x".repeat(101))).toThrow(/Invalid field/);
  });

  it("serializes scalar and multi-value filters and rejects bad ones", () => {
    expect(serializeFilters(undefined)).toBeUndefined();
    expect(serializeFilters({})).toBeUndefined();
    expect(JSON.parse(serializeFilters({ tozeret_nm: ["טויוטה יפן", "מאזדה יפן"], shnat_yitzur: 2026 }) ?? "")).toEqual({
      tozeret_nm: ["טויוטה יפן", "מאזדה יפן"],
      shnat_yitzur: 2026,
    });
    expect(() => serializeFilters({ STATUS: [] })).toThrow(/1-100 values/);
    expect(() => serializeFilters({ STATUS: Array.from({ length: 101 }, (_, i) => i) })).toThrow(/1-100 values/);
    expect(() => serializeFilters({ STATUS: { $gt: 1 } as unknown as string })).toThrow(/must be a string/);
    expect(() => serializeFilters({ STATUS: [null] as unknown as string[] })).toThrow(/values must be/);
    expect(() => serializeFilters({ 'a"b': "x" })).toThrow(/Invalid filter field/);
  });

  it("caps list_field_values limit", () => {
    expect(capFieldValuesLimit()).toBe(100);
    expect(capFieldValuesLimit(5000)).toBe(FIELD_VALUES_LIMIT_MAX);
  });

  it("sends sort and multi-value filters to datastore_search", async () => {
    const client = new CkanClient({
      cacheTtlMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("sort")).toBe('"shnat_yitzur" desc');
        expect(JSON.parse(url.searchParams.get("filters") ?? "")).toEqual({ tozeret_nm: ["a", "b"] });
        return jsonResponse({ success: true, result: { total: 2, fields: [], records: [] } });
      },
    });
    const result = await client.searchRecords({
      resource_id: GSA_RESOURCE,
      filters: { tozeret_nm: ["a", "b"] },
      sort: [{ field: "shnat_yitzur", direction: "desc" }],
    });
    expect(result.total).toBe(2);
  });

  it("explains data.gov.il's 404 for invalid datastore queries", async () => {
    const client = new CkanClient({
      fetch: async () => new Response("<!DOCTYPE html>", { status: 404, statusText: "Not Found" }),
    });
    await expect(client.searchRecords({ resource_id: GSA_RESOURCE, sort: [{ field: "nope" }] })).rejects.toThrow(
      /CKAN HTTP 404 Not Found for datastore_search \(data\.gov\.il answers invalid datastore queries with 404/,
    );
    await expect(client.getDataset("nope")).rejects.toThrow(/^CKAN HTTP 404 Not Found for package_show$/);
  });
});

describe("count_records", () => {
  const totals: Record<string, number> = { "": 300, "טויוטה יפן": 120, "קיה סלובקיה": 45, "אין כזה": 0 };

  function countClient(seen: URL[]) {
    return new CkanClient({
      cacheTtlMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        seen.push(url);
        expect(url.pathname.endsWith("/datastore_search")).toBe(true);
        expect(url.searchParams.get("limit")).toBe("0");
        const filters = JSON.parse(url.searchParams.get("filters") ?? "{}") as Record<string, unknown>;
        expect(filters.shnat_yitzur).toBe(2026);
        const maker = typeof filters.tozeret_nm === "string" ? filters.tozeret_nm : "";
        return jsonResponse({ success: true, result: { total: totals[maker] ?? 0, fields: [], records: [] } });
      },
    });
  }

  it("counts matching records with one limit=0 request", async () => {
    const seen: URL[] = [];
    const result = await countClient(seen).countRecords({ resource_id: GSA_RESOURCE, filters: { shnat_yitzur: 2026 } });
    expect(result).toEqual({ resource_id: GSA_RESOURCE, total: 300 });
    expect(seen).toHaveLength(1);
  });

  it("breaks the count down by field values, sorted by count, with shares and remainder", async () => {
    const seen: URL[] = [];
    const result = await countClient(seen).countRecords({
      resource_id: GSA_RESOURCE,
      filters: { shnat_yitzur: 2026 },
      group_by: { field: "tozeret_nm", values: ["אין כזה", "קיה סלובקיה", "טויוטה יפן", "קיה סלובקיה"] },
    });
    expect(result.total).toBe(300);
    expect(result.group_by).toEqual({
      field: "tozeret_nm",
      groups: [
        { value: "טויוטה יפן", count: 120, share: 0.4 },
        { value: "קיה סלובקיה", count: 45, share: 0.15 },
        { value: "אין כזה", count: 0, share: 0 },
      ],
      other: 135,
    });
    // One total + three de-duplicated values.
    expect(seen).toHaveLength(4);
  });

  it("limits concurrent requests while counting", async () => {
    let inFlight = 0;
    let peak = 0;
    const client = new CkanClient({
      cacheTtlMs: 0,
      fetch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return jsonResponse({ success: true, result: { total: 1, fields: [], records: [] } });
      },
    });
    const values = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const result = await client.countRecords({ resource_id: GSA_RESOURCE, group_by: { field: "f", values } });
    expect(result.group_by?.groups).toHaveLength(12);
    expect(result.group_by?.groups.every((group) => group.share === 1)).toBe(true);
    // 4 group workers + the total request.
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("rejects conflicting, empty or oversized group_by", async () => {
    const client = new CkanClient({
      fetch: async () => {
        throw new Error("network should not be used");
      },
    });
    await expect(
      client.countRecords({
        resource_id: GSA_RESOURCE,
        filters: { tozeret_nm: "x" },
        group_by: { field: "tozeret_nm", values: ["x"] },
      }),
    ).rejects.toThrow(/also in filters/);
    await expect(
      client.countRecords({ resource_id: GSA_RESOURCE, group_by: { field: "f", values: [] } }),
    ).rejects.toThrow(/1-25 values/);
    await expect(
      client.countRecords({
        resource_id: GSA_RESOURCE,
        group_by: { field: "f", values: Array.from({ length: COUNT_GROUP_VALUES_MAX + 1 }, (_, i) => i) },
      }),
    ).rejects.toThrow(/1-25 values/);
  });
});

describe("list_field_values", () => {
  it("returns sorted distinct values and marks complete lists", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("fields")).toBe("ROLE");
        expect(url.searchParams.get("distinct")).toBe("true");
        expect(url.searchParams.get("limit")).toBe("100");
        return jsonResponse({
          success: true,
          result: {
            total: 5,
            fields: [{ id: "ROLE", type: "text" }],
            records: [{ ROLE: "מנכ\"ל" }, { ROLE: "דירקטור" }, { ROLE: null }, { ROLE: "יו\"ר" }, { ROLE: "דח\"צ" }],
          },
        });
      },
    });
    const result = await client.listFieldValues({ resource_id: GSA_RESOURCE, field: "ROLE" });
    expect(result).toEqual({
      resource_id: GSA_RESOURCE,
      field: "ROLE",
      total_distinct: 5,
      values: ["דח\"צ", "דירקטור", "יו\"ר", "מנכ\"ל"],
      has_null: true,
      complete: true,
    });
  });

  it("sorts numbers numerically and flags partial lists", async () => {
    const client = new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("limit")).toBe("1000");
        expect(JSON.parse(url.searchParams.get("filters") ?? "")).toEqual({ tozeret_nm: "טויוטה יפן" });
        return jsonResponse({
          success: true,
          result: { total: 40, fields: [], records: [{ y: 2026 }, { y: 2009 }, { y: 2019 }, { y: 2009 }] },
        });
      },
    });
    const result = await client.listFieldValues({
      resource_id: GSA_RESOURCE,
      field: "y",
      filters: { tozeret_nm: "טויוטה יפן" },
      limit: 9999,
    });
    expect(result.values).toEqual([2009, 2019, 2026]);
    expect(result.complete).toBe(false);
    expect(result.note).toMatch(/Partial list/);
  });

  it("rejects unsafe field names before calling CKAN", async () => {
    const client = new CkanClient({
      fetch: async () => {
        throw new Error("network should not be used");
      },
    });
    await expect(client.listFieldValues({ resource_id: GSA_RESOURCE, field: 'a",b' })).rejects.toThrow(/Invalid field/);
  });
});

describe("organizations", () => {
  const rawOrgs = [
    { name: "airport_authority", title: "רשות שדות התעופה", resources_count: 4, __extras: { package_count: 4 } },
    { name: "ministry_of_transport", title: "משרד התחבורה והבטיחות בדרכים", resources_count: 120, __extras: { package_count: 57 } },
    { name: "mof", title: "משרד האוצר", package_count: 12, resources_count: 30 },
    { title: "nameless" },
  ];

  function orgClient(seen: URL[] = []) {
    return new CkanClient({
      fetch: async (input) => {
        const url = new URL(String(input));
        seen.push(url);
        return jsonResponse({ success: true, result: rawOrgs });
      },
    });
  }

  it("validates organization slugs before building fq", () => {
    expect(organizationFilterQuery(" ministry_of_transport ")).toBe("organization:ministry_of_transport");
    expect(() => organizationFilterQuery("mof OR tags:x")).toThrow(/Invalid organization/);
    expect(() => organizationFilterQuery("משרד")).toThrow(/list_organizations/);
  });

  it("maps package_count from top level or __extras", () => {
    expect(mapOrganizationListItem(rawOrgs[1])).toEqual({
      name: "ministry_of_transport",
      title: "משרד התחבורה והבטיחות בדרכים",
      package_count: 57,
      resources_count: 120,
    });
    expect(mapOrganizationListItem(rawOrgs[2]).package_count).toBe(12);
    expect(mapOrganizationListItem({ name: "x" })).toEqual({ name: "x", title: "x", package_count: 0, resources_count: 0 });
  });

  it("caps organization limit at 100", () => {
    expect(capOrganizationsLimit()).toBe(25);
    expect(capOrganizationsLimit(500)).toBe(100);
  });

  it("lists organizations sorted by dataset count, skipping nameless rows", async () => {
    const seen: URL[] = [];
    const result = await orgClient(seen).listOrganizations();
    expect(seen[0].pathname.endsWith("/organization_list")).toBe(true);
    expect(seen[0].searchParams.get("all_fields")).toBe("true");
    expect(result.total).toBe(3);
    expect(result.organizations.map((org) => org.name)).toEqual(["ministry_of_transport", "mof", "airport_authority"]);
  });

  it("matches Hebrew titles and slugs, then paginates", async () => {
    const client = orgClient();
    const hebrew = await client.listOrganizations({ q: "תחבורה" });
    expect(hebrew.organizations.map((org) => org.name)).toEqual(["ministry_of_transport"]);
    const slug = await client.listOrganizations({ q: "AIRPORT" });
    expect(slug.organizations.map((org) => org.name)).toEqual(["airport_authority"]);
    const page = await client.listOrganizations({ limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 3, organizations: [{ name: "mof" }] });
  });

  it("filters package_search by organization and allows an empty query", async () => {
    let seen: URL | undefined;
    const client = new CkanClient({
      fetch: async (input) => {
        seen = new URL(String(input));
        return jsonResponse({ success: true, result: { count: 0, results: [] } });
      },
    });
    await client.searchDatasets({ organization: "mof" });
    expect(seen?.searchParams.get("fq")).toBe("organization:mof");
    expect(seen?.searchParams.has("q")).toBe(false);
    await expect(client.searchDatasets({ q: "x", organization: "bad slug" })).rejects.toThrow(/Invalid organization/);
  });
});
