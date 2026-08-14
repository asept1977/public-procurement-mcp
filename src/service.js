import { getDoeDay, getDoeNotice, searchDoe } from "./providers/doe.js";
import { getTedNotice, searchTed } from "./providers/ted.js";

const SOURCE_INFO = [
  {
    id: "ted",
    name: "TED – Tenders Electronic Daily",
    coverage: "EU public procurement notices",
    access: "Live Search API without API key",
    constraints: "Uses TED expert-query syntax; upstream availability and terms apply",
    url: "https://api.ted.europa.eu/v3/notices/search",
  },
  {
    id: "doe",
    name: "Datenservice Öffentlicher Einkauf (DÖE)",
    coverage: "German public procurement open-data notices",
    access: "Daily CSV ZIP exports without API key",
    constraints: "Date-based bulk export; searches are capped per request",
    url: "https://oeffentlichevergabe.de/api/notice-exports",
  },
];

const DEMO_NOTICES = [
  {
    source: "demo",
    source_notice_id: "DEMO-001",
    title: "Demonstration: Lieferung technischer Komponenten",
    descriptions: ["Neutraler synthetischer Datensatz für Offline-Demos."],
    buyers: ["Beispiel-Vergabestelle"],
    publication_date: "2026-01-15",
    submission_deadlines: ["2026-02-20T12:00:00Z"],
    countries: ["DE"],
    cpv_codes: ["31000000"],
    document_links: ["https://example.com/demo-tender.pdf"],
    source_url: "https://example.com/demo-notice",
    synthetic: true,
  },
];

function deduplicate(notices) {
  const seen = new Map();
  const output = [];
  for (const notice of notices) {
    const crossId = notice.cross_source_ids?.ted_publication_number;
    const key = crossId
      ? `ted:${crossId}`
      : notice.source_notice_id
        ? `${notice.source}:${notice.source_notice_id}`
        : `${notice.title}|${notice.publication_date}|${notice.buyers?.[0] ?? ""}`.toLowerCase();
    if (seen.has(key)) {
      const existing = seen.get(key);
      existing.alternate_sources ??= [];
      existing.alternate_sources.push({ source: notice.source, source_notice_id: notice.source_notice_id });
      continue;
    }
    seen.set(key, notice);
    output.push(notice);
  }
  return output;
}

export function listSources() {
  return {
    ok: true,
    neutral: true,
    sources: SOURCE_INFO,
    guidance: "Industry, company and scoring preferences belong in the calling agent or skill, not in this MCP.",
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function searchNotices(input, dependencies = {}) {
  if (process.env.DEMO_MODE === "true") {
    return { ok: true, mode: "demo", total: DEMO_NOTICES.length, notices: DEMO_NOTICES };
  }
  const source = input.source ?? "ted";
  const searches = [];
  if (source === "ted" || source === "all") searches.push({ source: "ted", promise: searchTed(input, dependencies) });
  if (source === "doe" || source === "all") searches.push({ source: "doe", promise: searchDoe(input, dependencies) });

  const settled = await Promise.allSettled(searches.map((item) => item.promise));
  const results = [];
  const sourceResults = settled.map((item, index) => {
    const sourceId = searches[index].source;
    if (item.status === "rejected") {
      return { source: sourceId, ok: false, error: errorMessage(item.reason) };
    }
    results.push(item.value);
    const { notices: ignored, ...metadata } = item.value;
    return { ok: true, ...metadata };
  });

  const failures = sourceResults.filter((item) => !item.ok);
  if (failures.length === sourceResults.length) {
    throw new Error(`All selected sources failed: ${failures.map((item) => `${item.source}: ${item.error}`).join("; ")}`);
  }

  const notices = deduplicate(results.flatMap((item) => item.notices));
  return {
    ok: true,
    source,
    partial: failures.length > 0,
    total: notices.length,
    notices,
    source_results: sourceResults,
    warnings: failures.map((item) => ({ source: item.source, error: item.error })),
    deduplication: "TED publication numbers are preferred as cross-source keys; otherwise source IDs are retained.",
  };
}

export async function getNotice(input, dependencies = {}) {
  if (process.env.DEMO_MODE === "true") {
    const notice = DEMO_NOTICES.find((item) => item.source_notice_id === input.source_notice_id) ?? DEMO_NOTICES[0];
    return { ok: true, mode: "demo", found: Boolean(notice), notice };
  }
  const result = input.source === "ted"
    ? await getTedNotice(input.source_notice_id, dependencies)
    : await getDoeNotice(input.source_notice_id, input.publication_date, dependencies);
  return { ok: true, ...result };
}

export async function getDocumentLinks(input, dependencies = {}) {
  const result = await getNotice(input, dependencies);
  return {
    ok: true,
    source: input.source,
    source_notice_id: input.source_notice_id,
    found: result.found,
    document_links: result.notice?.document_links ?? [],
    source_url: result.notice?.source_url ?? null,
  };
}

export async function inspectGermanExport(input, dependencies = {}) {
  if (process.env.DEMO_MODE === "true") {
    return { ok: true, mode: "demo", publication_date: input.publication_date, table_counts: { notice: 1 }, total: 1, notices: DEMO_NOTICES };
  }
  const result = await getDoeDay(input.publication_date, dependencies);
  const page = input.page ?? 1;
  const pageSize = input.page_size ?? 20;
  return {
    ok: true,
    source: result.source,
    publication_date: result.publication_date,
    export_url: result.export_url,
    table_counts: result.table_counts,
    total: result.notices.length,
    page,
    page_size: pageSize,
    notices: result.notices.slice((page - 1) * pageSize, page * pageSize),
  };
}
