export const FEATURED_CATEGORIES = [
  "companies",
  "vehicles",
  "education",
  "fuel",
  "government",
  "all",
] as const;

export type FeaturedCategory = (typeof FEATURED_CATEGORIES)[number];

export interface FeaturedDataset {
  name: string;
  titleHe: string;
  category: Exclude<FeaturedCategory, "all">;
  why: string;
}

/**
 * Curated starting point verified against data.gov.il on 2026-11-08.
 * Not a complete index — use search_datasets for everything else.
 */
export const FEATURED_DATASETS: FeaturedDataset[] = [
  {
    name: "ica_companies",
    titleHe: "מאגר חברות - רשם החברות",
    category: "companies",
    why: "Company registrar search by name or company number (ח.פ).",
  },
  {
    name: "ica_partnerships",
    titleHe: "מאגר שותפויות - רשם החברות",
    category: "companies",
    why: "Partnership registrar search.",
  },
  {
    name: "ica-changes",
    titleHe: "פרטי שינויים בחברות ושותפויות",
    category: "companies",
    why: "Recorded changes to companies and partnerships.",
  },
  {
    name: "gsa",
    titleHe: "רשימת חברות ממשלתיות ודירקטורים מכהנים",
    category: "companies",
    why: "Government companies and currently serving directors.",
  },
  {
    name: "pinkashakablanim",
    titleHe: "פנקס הקבלנים הרשומים",
    category: "companies",
    why: "Registry of licensed contractors.",
  },
  {
    name: "private-and-commercial-vehicles",
    titleHe: "מספרי רישוי של כלי רכב פרטיים ומסחריים",
    category: "vehicles",
    why: "Active private and commercial vehicle licence plates.",
  },
  {
    name: "shinui_mivne",
    titleHe: "היסטוריית כלי רכב פרטיים",
    category: "vehicles",
    why: "Structural-change history for private vehicles.",
  },
  {
    name: "mosdot_edu",
    titleHe: "מוסדות חינוך",
    category: "education",
    why: "Education institutions registry.",
  },
  {
    name: "mosdot",
    titleHe: "מאפייני מוסדות חינוך בפיקוח משרד החינוך",
    category: "education",
    why: "Characteristics of Ministry of Education-supervised institutions.",
  },
  {
    name: "fuelstationbynumber",
    titleHe: "מאגר תחנות הדלק",
    category: "fuel",
    why: "Fuel stations indexed by station number.",
  },
  {
    name: "gas-stations-br7",
    titleHe: "תחנות דלק",
    category: "fuel",
    why: "Fuel station locations and details.",
  },
  {
    name: "gsa",
    titleHe: "רשימת חברות ממשלתיות ודירקטורים מכהנים",
    category: "government",
    why: "Government companies and currently serving directors.",
  },
];

export function listFeaturedDatasets(category: string = "all"): FeaturedDataset[] {
  if (!FEATURED_CATEGORIES.includes(category as FeaturedCategory)) {
    throw new Error(`Unknown category: ${category}. Use one of: ${FEATURED_CATEGORIES.join(", ")}`);
  }
  if (category === "all") {
    const seen = new Set<string>();
    return FEATURED_DATASETS.filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    });
  }
  return FEATURED_DATASETS.filter((entry) => entry.category === category);
}
