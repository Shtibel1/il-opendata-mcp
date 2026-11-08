import { describe, expect, it } from "vitest";
import { FEATURED_DATASETS, listFeaturedDatasets } from "../src/lib/catalog.js";

const VERIFIED_NAMES = [
  "ica_companies",
  "ica_partnerships",
  "ica-changes",
  "gsa",
  "pinkashakablanim",
  "private-and-commercial-vehicles",
  "shinui_mivne",
  "mosdot_edu",
  "mosdot",
  "fuelstationbynumber",
  "gas-stations-br7",
];

describe("featured catalog", () => {
  it("lists every verified dataset once when category is all", () => {
    const all = listFeaturedDatasets("all");
    expect(all.map((entry) => entry.name).sort()).toEqual([...VERIFIED_NAMES].sort());
    expect(new Set(all.map((entry) => entry.name)).size).toBe(all.length);
  });

  it("filters companies and includes gsa there", () => {
    const companies = listFeaturedDatasets("companies");
    expect(companies.map((entry) => entry.name)).toEqual([
      "ica_companies",
      "ica_partnerships",
      "ica-changes",
      "gsa",
      "pinkashakablanim",
    ]);
  });

  it("filters vehicles, education and fuel", () => {
    expect(listFeaturedDatasets("vehicles").map((entry) => entry.name)).toEqual([
      "private-and-commercial-vehicles",
      "shinui_mivne",
    ]);
    expect(listFeaturedDatasets("education").map((entry) => entry.name)).toEqual(["mosdot_edu", "mosdot"]);
    expect(listFeaturedDatasets("fuel").map((entry) => entry.name)).toEqual([
      "fuelstationbynumber",
      "gas-stations-br7",
    ]);
  });

  it("also lists gsa under government", () => {
    const government = listFeaturedDatasets("government");
    expect(government).toHaveLength(1);
    expect(government[0]).toMatchObject({
      name: "gsa",
      titleHe: "רשימת חברות ממשלתיות ודירקטורים מכהנים",
      category: "government",
    });
  });

  it("throws on an unknown category", () => {
    expect(() => listFeaturedDatasets("agriculture")).toThrow(/Unknown category: agriculture/);
  });

  it("gives every entry a name, Hebrew title, category and why", () => {
    expect(FEATURED_DATASETS.length).toBeGreaterThanOrEqual(12);
    for (const entry of FEATURED_DATASETS) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.titleHe.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(0);
      expect(["companies", "vehicles", "education", "fuel", "government"]).toContain(entry.category);
    }
  });

  it("defaults to all when no category is given", () => {
    expect(listFeaturedDatasets().map((entry) => entry.name)).toEqual(
      listFeaturedDatasets("all").map((entry) => entry.name),
    );
  });
});
