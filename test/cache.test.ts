import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/lib/cache.js";
import { CkanClient, DEFAULT_CACHE_TTL_MS, DEFAULT_USER_AGENT } from "../src/lib/ckan.js";
import { VERSION } from "../src/version.js";

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** Mock fetch that records every URL it is asked for. */
function recordingFetch(respond: (url: URL, call: number) => Response | Promise<Response>) {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    return respond(url, urls.length);
  }) as typeof fetch;
  return { impl, urls };
}

const pkg = { id: "pkg", name: "gsa", title: "GSA", resources: [] };

describe("TtlCache", () => {
  it("returns the cached value until the TTL expires", async () => {
    let now = 0;
    const cache = new TtlCache<number>(1000, 10, () => now);
    let calls = 0;
    const load = () => Promise.resolve(++calls);
    expect(await cache.getOrCreate("k", load)).toBe(1);
    now = 999;
    expect(await cache.getOrCreate("k", load)).toBe(1);
    now = 1000;
    expect(await cache.getOrCreate("k", load)).toBe(2);
  });

  it("shares one in-flight promise between concurrent callers", async () => {
    const cache = new TtlCache<string>(1000);
    let calls = 0;
    const load = () => new Promise<string>((resolve) => setTimeout(() => resolve(`v${++calls}`), 5));
    const [a, b] = await Promise.all([cache.getOrCreate("k", load), cache.getOrCreate("k", load)]);
    expect([a, b, calls]).toEqual(["v1", "v1", 1]);
  });

  it("never caches failures", async () => {
    const cache = new TtlCache<string>(1000);
    await expect(cache.getOrCreate("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(cache.size).toBe(0);
    expect(await cache.getOrCreate("k", () => Promise.resolve("ok"))).toBe("ok");
  });

  it("evicts the oldest entry when full", async () => {
    const cache = new TtlCache<string>(1000, 2);
    await cache.getOrCreate("a", () => Promise.resolve("a"));
    await cache.getOrCreate("b", () => Promise.resolve("b"));
    await cache.getOrCreate("c", () => Promise.resolve("c"));
    expect(cache.size).toBe(2);
    let reloaded = false;
    await cache.getOrCreate("a", () => {
      reloaded = true;
      return Promise.resolve("a2");
    });
    expect(reloaded).toBe(true);
  });

  it("is a pass-through when the TTL is 0", async () => {
    const cache = new TtlCache<number>(0);
    let calls = 0;
    await cache.getOrCreate("k", () => Promise.resolve(++calls));
    await cache.getOrCreate("k", () => Promise.resolve(++calls));
    expect([cache.enabled, cache.size, calls]).toEqual([false, 0, 2]);
  });
});

describe("CkanClient response cache", () => {
  it("serves repeated identical requests from memory", async () => {
    const { impl, urls } = recordingFetch(() => ok(pkg));
    const ckan = new CkanClient({ fetch: impl });
    expect(ckan.cacheEnabled).toBe(true);
    const first = await ckan.getDataset("gsa");
    const second = await ckan.getDataset("gsa");
    expect(second).toEqual(first);
    expect(urls).toHaveLength(1);
    expect(ckan.cacheSize).toBe(1);
  });

  it("keys the cache on the full request so different parameters still hit the network", async () => {
    const { impl, urls } = recordingFetch(() => ok({ count: 0, results: [] }));
    const ckan = new CkanClient({ fetch: impl });
    await ckan.searchDatasets({ q: "fuel" });
    await ckan.searchDatasets({ q: "fuel", rows: 5 });
    await ckan.searchDatasets({ q: "education" });
    await ckan.searchDatasets({ q: "  fuel  " }); // trimmed => same request as the first
    expect(urls).toHaveLength(3);
  });

  it("shares one in-flight request between concurrent identical calls", async () => {
    const { impl, urls } = recordingFetch(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(ok(pkg)), 5)),
    );
    const ckan = new CkanClient({ fetch: impl });
    const results = await Promise.all([ckan.getDataset("gsa"), ckan.getDataset("gsa"), ckan.getDataset("gsa")]);
    expect(results.map((dataset) => dataset.name)).toEqual(["gsa", "gsa", "gsa"]);
    expect(urls).toHaveLength(1);
  });

  it("expires entries after cacheTtlMs", async () => {
    let now = 1_000;
    const { impl, urls } = recordingFetch(() => ok(pkg));
    const ckan = new CkanClient({ fetch: impl, cacheTtlMs: 60_000, now: () => now });
    await ckan.getDataset("gsa");
    now += 59_999;
    await ckan.getDataset("gsa");
    expect(urls).toHaveLength(1);
    now += 1;
    await ckan.getDataset("gsa");
    expect(urls).toHaveLength(2);
  });

  it("does not cache CKAN errors or HTTP failures", async () => {
    const { impl, urls } = recordingFetch((_url, call) =>
      call === 1
        ? new Response("busy", { status: 503, statusText: "Service Unavailable" })
        : call === 2
          ? new Response(JSON.stringify({ success: false, error: { message: "Not found" } }), { status: 200 })
          : ok(pkg),
    );
    const ckan = new CkanClient({ fetch: impl });
    await expect(ckan.getDataset("gsa")).rejects.toThrow("CKAN HTTP 503");
    await expect(ckan.getDataset("gsa")).rejects.toThrow("Not found");
    expect(ckan.cacheSize).toBe(0);
    expect((await ckan.getDataset("gsa")).name).toBe("gsa");
    expect(urls).toHaveLength(3);
  });

  it("can be disabled with cacheTtlMs: 0 and cleared on demand", async () => {
    const { impl, urls } = recordingFetch(() => ok(pkg));
    const disabled = new CkanClient({ fetch: impl, cacheTtlMs: 0 });
    expect(disabled.cacheEnabled).toBe(false);
    await disabled.getDataset("gsa");
    await disabled.getDataset("gsa");
    expect(urls).toHaveLength(2);

    const cached = new CkanClient({ fetch: impl });
    await cached.getDataset("gsa");
    cached.clearCache();
    expect(cached.cacheSize).toBe(0);
    await cached.getDataset("gsa");
    expect(urls).toHaveLength(4);
  });

  it("reuses one organization_list response for every list_organizations filter", async () => {
    const { impl, urls } = recordingFetch(() =>
      ok([
        { name: "ministry_of_transport", title: "משרד התחבורה", package_count: 40 },
        { name: "ministry_of_education", title: "משרד החינוך", package_count: 30 },
      ]),
    );
    const ckan = new CkanClient({ fetch: impl });
    expect((await ckan.listOrganizations({ q: "תחבורה" })).total).toBe(1);
    expect((await ckan.listOrganizations({ q: "education" })).organizations[0]?.name).toBe("ministry_of_education");
    expect((await ckan.listOrganizations()).total).toBe(2);
    expect(urls).toHaveLength(1);
  });

  it("defaults to a 5 minute TTL and a versioned User-Agent", () => {
    expect(DEFAULT_CACHE_TTL_MS).toBe(300_000);
    const pkgJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkgJson.version);
    expect(DEFAULT_USER_AGENT).toContain(`il-opendata-mcp/${VERSION}`);
  });
});
