const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";

export const TED_DEFAULT_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-title",
  "description-lot",
  "buyer-name",
  "classification-cpv",
  "place-of-performance-country-lot",
  "deadline-receipt-tender-date-lot",
  "links",
];

function escapeExpertTerm(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildTedQuery({
  expert_query,
  keywords = [],
  published_from,
  published_to,
  countries = [],
  cpv_codes = [],
}) {
  if (expert_query?.trim()) return expert_query.trim();

  const clauses = [];
  const cleanKeywords = keywords.map(String).map((v) => v.trim()).filter(Boolean);
  if (cleanKeywords.length) {
    clauses.push(`FT=(${cleanKeywords.map((v) => `"${escapeExpertTerm(v)}"`).join(" OR ")})`);
  }
  if (published_from) clauses.push(`publication-date >= ${published_from.replaceAll("-", "")}`);
  if (published_to) clauses.push(`publication-date <= ${published_to.replaceAll("-", "")}`);
  if (countries.length) {
    clauses.push(`place-of-performance-country-lot IN (${countries.map((v) => String(v).toUpperCase()).join(",")})`);
  }
  if (cpv_codes.length) {
    clauses.push(`classification-cpv IN (${cpv_codes.map(String).join(",")})`);
  }
  return clauses.length ? clauses.join(" AND ") : "*";
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function strings(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(strings).filter(Boolean);
  if (typeof value === "object") return Object.values(value).flatMap(strings).filter(Boolean);
  return [String(value)];
}

function pick(record, ...keys) {
  for (const key of keys) {
    if (record?.[key] != null) return record[key];
  }
  return undefined;
}

export function normalizeTedNotice(record) {
  const publicationNumber = first(pick(record, "publication-number", "publicationNumber"));
  const titles = strings(pick(record, "notice-title", "title"));
  const descriptions = strings(pick(record, "description-lot", "description"));
  const buyers = strings(pick(record, "buyer-name", "buyerName"));
  const countries = strings(pick(record, "place-of-performance-country-lot", "country"));
  const cpvCodes = strings(pick(record, "classification-cpv", "cpv"));
  const deadlines = strings(pick(record, "deadline-receipt-tender-date-lot", "deadline"));
  const links = strings(pick(record, "links", "link"));

  return {
    source: "ted",
    source_notice_id: publicationNumber ? String(publicationNumber) : null,
    title: titles[0] ?? null,
    descriptions,
    buyers,
    publication_date: first(pick(record, "publication-date", "publicationDate")) ?? null,
    submission_deadlines: deadlines,
    countries,
    cpv_codes: cpvCodes,
    document_links: links,
    source_url: publicationNumber
      ? `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`
      : null,
    raw: record,
  };
}

export async function searchTed(options, { fetchImpl = fetch } = {}) {
  const query = buildTedQuery(options);
  const page = options.page ?? 1;
  const pageSize = Math.min(options.page_size ?? 20, 100);
  const response = await fetchImpl(TED_SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query,
      fields: options.fields?.length ? options.fields : TED_DEFAULT_FIELDS,
      page,
      limit: pageSize,
      scope: options.scope ?? "ALL",
      checkQuerySyntax: false,
      paginationMode: "PAGE_NUMBER",
    }),
    signal: AbortSignal.timeout(Number(process.env.UPSTREAM_TIMEOUT_MS ?? 30000)),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`TED Search API returned ${response.status}: ${detail}`);
  }
  const payload = await response.json();
  const records = payload.results ?? payload.notices ?? [];
  return {
    source: "ted",
    query,
    page,
    page_size: pageSize,
    total: payload.totalNoticeCount ?? payload.total ?? records.length,
    notices: records.map(normalizeTedNotice),
  };
}

export async function getTedNotice(publicationNumber, options = {}) {
  const result = await searchTed({
    expert_query: `publication-number = "${escapeExpertTerm(publicationNumber)}"`,
    page: 1,
    page_size: 5,
  }, options);
  const notice = result.notices.find((item) => item.source_notice_id === publicationNumber)
    ?? result.notices[0]
    ?? null;
  return { source: "ted", source_notice_id: publicationNumber, found: Boolean(notice), notice };
}
