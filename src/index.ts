export {
  CkanClient,
  DEFAULT_BASE_URL,
  DEFAULT_USER_AGENT,
  SEARCH_ROWS_DEFAULT,
  SEARCH_ROWS_MAX,
  DATASTORE_LIMIT_DEFAULT,
  DATASTORE_LIMIT_MAX,
  NOTES_MAX_CHARS,
  capSearchRows,
  capDatastoreLimit,
  truncateNotes,
  mapPackage,
} from "./lib/ckan.js";
export type {
  CkanClientOptions,
  CompactDataset,
  CompactResource,
  DatasetSearchResult,
  DatastoreField,
  ResourceDescription,
  RecordSearchResult,
  SearchDatasetsParams,
  SearchRecordsParams,
} from "./lib/ckan.js";
export { FEATURED_CATEGORIES, FEATURED_DATASETS, listFeaturedDatasets } from "./lib/catalog.js";
export type { FeaturedCategory, FeaturedDataset } from "./lib/catalog.js";
export { createServer } from "./server.js";
export { startHttpServer, parseAllowedOrigins, DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, MCP_PATH, MAX_BODY_BYTES } from "./http.js";
export type { HttpServerOptions, RunningHttpServer } from "./http.js";
