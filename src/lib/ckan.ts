export const DEFAULT_BASE_URL = "https://data.gov.il/api/3/action";
export const DEFAULT_USER_AGENT =
  "il-opendata-mcp/0.4.0 (+https://github.com/Shtibel1/il-opendata-mcp)";
export const SEARCH_ROWS_DEFAULT = 10;
export const SEARCH_ROWS_MAX = 50;
export const DATASTORE_LIMIT_DEFAULT = 10;
export const DATASTORE_LIMIT_MAX = 100;
export const NOTES_MAX_CHARS = 500;
export const ORGANIZATIONS_LIMIT_DEFAULT = 25;
export const ORGANIZATIONS_LIMIT_MAX = 100;
/** CKAN organization slugs: lowercase letters, digits, "-" and "_" (2-100 chars). */
export const ORGANIZATION_NAME_PATTERN = /^[a-z0-9_-]{2,100}$/;

export interface CkanClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
}

export interface CompactResource {
  id: string;
  name: string;
  format: string;
  datastore_active: boolean;
  last_modified: string | null;
}

export interface CompactDataset {
  id: string;
  name: string;
  title: string;
  notes: string;
  organization: string | null;
  tags: string[];
  resources: CompactResource[];
  datastoreActiveCount: number;
}

export interface DatasetSearchResult {
  count: number;
  datasets: CompactDataset[];
}

export interface DatastoreField {
  id: string;
  type: string;
}

export interface ResourceDescription {
  resource_id: string;
  total: number;
  fields: DatastoreField[];
}

export interface RecordSearchResult {
  total: number;
  fields: DatastoreField[];
  records: Record<string, unknown>[];
}

export interface SearchDatasetsParams {
  q?: string;
  /** Restrict results to one publishing organization (CKAN slug, see listOrganizations). */
  organization?: string;
  rows?: number;
  start?: number;
}

export interface CompactOrganization {
  name: string;
  title: string;
  package_count: number;
  resources_count: number;
}

export interface OrganizationListResult {
  /** Number of organizations matching `q` (before limit/offset). */
  total: number;
  organizations: CompactOrganization[];
}

export interface ListOrganizationsParams {
  /** Case-insensitive substring match on slug or (Hebrew) title. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface SearchRecordsParams {
  resource_id: string;
  q?: string;
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
  fields?: string[];
}

interface CkanErrorBody {
  message?: string;
  __type?: string;
}

interface CkanEnvelope<T> {
  success?: boolean;
  result?: T;
  error?: CkanErrorBody | string;
}

interface RawTag {
  name?: string;
  display_name?: string;
}

interface RawOrganization {
  name?: string;
  title?: string;
}

interface RawResource {
  id?: string;
  name?: string;
  format?: string;
  datastore_active?: unknown;
  last_modified?: string | null;
}

interface RawPackage {
  id?: string;
  name?: string;
  title?: string;
  notes?: string | null;
  organization?: RawOrganization | string | null;
  tags?: RawTag[];
  resources?: RawResource[];
}

interface RawOrganizationListItem {
  name?: string;
  title?: string;
  display_name?: string;
  package_count?: number;
  resources_count?: number;
  __extras?: { package_count?: number; display_name?: string };
}

interface RawPackageSearch {
  count?: number;
  results?: RawPackage[];
}

interface RawDatastoreSearch {
  total?: number;
  fields?: Array<{ id?: string; type?: string }>;
  records?: Record<string, unknown>[];
}

export function capSearchRows(rows?: number): number {
  return clamp(rows, SEARCH_ROWS_DEFAULT, SEARCH_ROWS_MAX);
}

export function capDatastoreLimit(limit?: number): number {
  return clamp(limit, DATASTORE_LIMIT_DEFAULT, DATASTORE_LIMIT_MAX);
}

export function truncateNotes(notes: string | null | undefined): string {
  const text = notes ?? "";
  if (text.length <= NOTES_MAX_CHARS) return text;
  return text.slice(0, NOTES_MAX_CHARS);
}

export function capOrganizationsLimit(limit?: number): number {
  return clamp(limit, ORGANIZATIONS_LIMIT_DEFAULT, ORGANIZATIONS_LIMIT_MAX);
}

/** Builds a safe CKAN `fq` clause, rejecting anything that is not a plain organization slug. */
export function organizationFilterQuery(organization: string): string {
  const slug = organization.trim();
  if (!ORGANIZATION_NAME_PATTERN.test(slug)) {
    throw new Error(
      `Invalid organization "${organization}": expected a CKAN slug such as "ministry_of_transport" (use list_organizations)`,
    );
  }
  return `organization:${slug}`;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function mapOrganizationListItem(raw: RawOrganizationListItem): CompactOrganization {
  const name = raw.name ?? "";
  return {
    name,
    title: raw.title || raw.display_name || raw.__extras?.display_name || name,
    package_count: toCount(raw.package_count ?? raw.__extras?.package_count),
    resources_count: toCount(raw.resources_count),
  };
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(0, Math.floor(value)), max);
}

function isDatastoreActive(value: unknown): boolean {
  return value === true || value === "true";
}

function mapOrganization(org: RawPackage["organization"]): string | null {
  if (!org) return null;
  if (typeof org === "string") return org;
  return org.title || org.name || null;
}

function mapTags(tags: RawTag[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.display_name || tag.name || "")
    .filter((tag) => tag.length > 0);
}

function mapResource(resource: RawResource): CompactResource {
  return {
    id: resource.id ?? "",
    name: resource.name ?? resource.id ?? "",
    format: resource.format ?? "",
    datastore_active: isDatastoreActive(resource.datastore_active),
    last_modified: resource.last_modified ?? null,
  };
}

export function mapPackage(pkg: RawPackage): CompactDataset {
  const resources = (pkg.resources ?? []).map(mapResource);
  return {
    id: pkg.id ?? "",
    name: pkg.name ?? pkg.id ?? "",
    title: pkg.title ?? pkg.name ?? "",
    notes: truncateNotes(pkg.notes),
    organization: mapOrganization(pkg.organization),
    tags: mapTags(pkg.tags),
    resources,
    datastoreActiveCount: resources.filter((resource) => resource.datastore_active).length,
  };
}

function mapFields(fields: RawDatastoreSearch["fields"]): DatastoreField[] {
  return (fields ?? [])
    .filter((field) => field.id && field.id !== "_id" && field.id !== "_full_text")
    .map((field) => ({ id: field.id as string, type: field.type ?? "text" }));
}

function ckanErrorMessage(error: CkanEnvelope<unknown>["error"], action: string): string {
  if (!error) return `CKAN action ${action} failed`;
  if (typeof error === "string") return error;
  return error.message || error.__type || `CKAN action ${action} failed`;
}

export class CkanClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(options: CkanClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async searchDatasets(params: SearchDatasetsParams): Promise<DatasetSearchResult> {
    const q = params.q?.trim();
    const result = await this.request<RawPackageSearch>("package_search", {
      q: q ? q : undefined,
      fq: params.organization === undefined ? undefined : organizationFilterQuery(params.organization),
      rows: capSearchRows(params.rows),
      start: params.start === undefined ? undefined : Math.max(0, Math.floor(params.start)),
    });
    return {
      count: result.count ?? 0,
      datasets: (result.results ?? []).map(mapPackage),
    };
  }

  async listOrganizations(params: ListOrganizationsParams = {}): Promise<OrganizationListResult> {
    // data.gov.il publishes ~60 organizations, so one call is cheap and lets us
    // match Hebrew titles locally (CKAN's own `q` only matches the slug).
    const raw = await this.request<RawOrganizationListItem[]>("organization_list", {
      all_fields: "true",
      limit: 1000,
    });
    const needle = params.q?.trim().toLocaleLowerCase() ?? "";
    const matches = raw
      .map(mapOrganizationListItem)
      .filter((org) => org.name.length > 0)
      .filter(
        (org) =>
          needle.length === 0 ||
          org.name.toLocaleLowerCase().includes(needle) ||
          org.title.toLocaleLowerCase().includes(needle),
      )
      .sort((a, b) => b.package_count - a.package_count || a.name.localeCompare(b.name));
    const offset = params.offset === undefined ? 0 : Math.max(0, Math.floor(params.offset));
    return {
      total: matches.length,
      organizations: matches.slice(offset, offset + capOrganizationsLimit(params.limit)),
    };
  }

  async getDataset(id: string): Promise<CompactDataset> {
    const result = await this.request<RawPackage>("package_show", { id });
    return mapPackage(result);
  }

  async describeResource(resourceId: string): Promise<ResourceDescription> {
    try {
      const result = await this.request<RawDatastoreSearch>("datastore_search", {
        resource_id: resourceId,
        limit: 0,
      });
      return {
        resource_id: resourceId,
        total: result.total ?? 0,
        fields: mapFields(result.fields),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("CKAN HTTP")) throw err;
      throw new Error(`Resource has no active datastore (${resourceId}): ${message}`);
    }
  }

  async searchRecords(params: SearchRecordsParams): Promise<RecordSearchResult> {
    const query: Record<string, string | number | undefined> = {
      resource_id: params.resource_id,
      limit: capDatastoreLimit(params.limit),
      offset: params.offset === undefined ? undefined : Math.max(0, Math.floor(params.offset)),
      q: params.q,
      fields: params.fields && params.fields.length > 0 ? params.fields.join(",") : undefined,
      filters:
        params.filters && Object.keys(params.filters).length > 0
          ? JSON.stringify(params.filters)
          : undefined,
    };
    const result = await this.request<RawDatastoreSearch>("datastore_search", query);
    return {
      total: result.total ?? 0,
      fields: mapFields(result.fields),
      records: result.records ?? [],
    };
  }

  private async request<T>(
    action: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${action}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`CKAN request timed out after ${this.timeoutMs}ms (${action})`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(
        `CKAN HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""} for ${action}`,
      );
    }

    let body: CkanEnvelope<T>;
    try {
      body = (await response.json()) as CkanEnvelope<T>;
    } catch {
      throw new Error(`CKAN returned non-JSON for ${action}`);
    }

    if (!body.success) {
      throw new Error(ckanErrorMessage(body.error, action));
    }
    if (body.result === undefined) {
      throw new Error(`CKAN action ${action} returned no result`);
    }
    return body.result;
  }
}
