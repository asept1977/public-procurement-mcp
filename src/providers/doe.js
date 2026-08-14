import path from "node:path";
import { parse } from "csv-parse/sync";
import unzipper from "unzipper";

const DOE_EXPORT_URL = "https://oeffentlichevergabe.de/api/notice-exports";
const cache = new Map();
const pending = new Map();

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response, attempt) {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 10000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 10000));
  }
  return Math.min(500 * (2 ** attempt), 5000);
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function normalizedKey(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function pick(row, candidates) {
  if (!row) return undefined;
  const index = new Map(Object.keys(row).map((key) => [normalizedKey(key), key]));
  for (const candidate of candidates) {
    const actual = index.get(normalizedKey(candidate));
    if (actual && row[actual] !== "") return row[actual];
  }
  return undefined;
}

function parseCsv(buffer) {
  const sample = buffer.subarray(0, 4096).toString("utf8");
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";
  return parse(buffer, {
    columns: true,
    bom: true,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

export async function parseDoeExport(buffer) {
  const archive = await unzipper.Open.buffer(buffer);
  const tables = {};
  for (const entry of archive.files) {
    if (entry.type !== "File" || !entry.path.toLowerCase().endsWith(".csv")) continue;
    const name = normalizedKey(path.basename(entry.path, path.extname(entry.path)));
    tables[name] = parseCsv(await entry.buffer());
  }
  return tables;
}

function table(tables, name) {
  return tables[normalizedKey(name)] ?? [];
}

function related(rows, noticeId) {
  return rows.filter((row) => String(pick(row, ["noticeId", "notice-id", "notice_id"]) ?? "") === String(noticeId));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function normalizeDoeTables(tables, publicationDate) {
  const notices = table(tables, "notice");
  const procedures = table(tables, "procedure");
  const purposes = table(tables, "purpose");
  const classifications = table(tables, "classification");
  const organisations = table(tables, "organisation");
  const places = table(tables, "placeOfPerformance");
  const terms = table(tables, "submissionTerms");
  const tenders = table(tables, "tender");
  const lots = table(tables, "lot");

  return notices.map((notice) => {
    const id = pick(notice, ["noticeId", "notice-id", "id", "noticeIdentifier"]);
    const procedureRows = related(procedures, id);
    const purposeRows = related(purposes, id);
    const classificationRows = related(classifications, id);
    const organisationRows = related(organisations, id);
    const placeRows = related(places, id);
    const termRows = related(terms, id);
    const tenderRows = related(tenders, id);
    const lotRows = related(lots, id);
    const allRows = [notice, ...procedureRows, ...purposeRows, ...lotRows];
    const title = allRows.map((row) => pick(row, ["title", "name", "procedureTitle", "description"])).find(Boolean) ?? null;
    const tedId = pick(notice, ["tedPublicationNumber", "tedNoticeId", "publicationNumber"]);

    return {
      source: "doe",
      source_notice_id: id ? String(id) : null,
      title,
      descriptions: unique(purposeRows.map((row) => pick(row, ["description", "mainNature", "additionalNature"]))),
      buyers: unique(organisationRows.map((row) => pick(row, ["officialName", "name", "organisationName"]))),
      publication_date: pick(notice, ["publicationDate", "publication-date", "publishedAt"]) ?? publicationDate,
      submission_deadlines: unique(termRows.map((row) => pick(row, ["tenderDeadline", "deadline", "dateTime"]))),
      countries: unique(placeRows.map((row) => pick(row, ["countryCode", "country", "nutsCode"]))),
      cpv_codes: unique(classificationRows.map((row) => pick(row, ["classificationCode", "cpvCode", "code"]))),
      document_links: unique(tenderRows.flatMap((row) => [
        pick(row, ["documentsUrl", "documentUrl", "url"]),
        pick(row, ["submissionUrl", "electronicSubmissionUrl"]),
      ])),
      source_url: pick(notice, ["noticeUrl", "url"]) ?? null,
      cross_source_ids: tedId ? { ted_publication_number: String(tedId) } : {},
      raw: {
        notice,
        procedure: procedureRows,
        purpose: purposeRows,
        lots: lotRows,
      },
    };
  });
}

export async function downloadDoeExport(publicationDate, { fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const url = new URL(DOE_EXPORT_URL);
  url.searchParams.set("pubDay", publicationDate);
  url.searchParams.set("format", "csv.zip");
  const timeout = Number(process.env.DOE_UPSTREAM_TIMEOUT_MS ?? 90000);
  const maxRetries = Math.max(0, Number(process.env.DOE_MAX_RETRIES ?? 2));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/zip, application/octet-stream" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (attempt < maxRetries) {
        await sleepImpl(Math.min(500 * (2 ** attempt), 5000));
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`DÖE export API request failed after ${attempt + 1} attempt(s): ${detail}`);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      if (attempt < maxRetries && retryableStatus(response.status)) {
        await sleepImpl(retryAfterMilliseconds(response, attempt));
        continue;
      }
      throw new Error(`DÖE export API returned ${response.status}: ${detail}`);
    }

    const maxBytes = Number(process.env.MAX_DOE_EXPORT_BYTES ?? 50 * 1024 * 1024);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maxBytes) throw new Error(`DÖE export exceeds ${maxBytes} bytes`);
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error(`DÖE export exceeds ${maxBytes} bytes`);
      return { url: url.toString(), buffer };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("DÖE export exceeds")) throw error;
      if (attempt < maxRetries) {
        await sleepImpl(Math.min(500 * (2 ** attempt), 5000));
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`DÖE export download failed after ${attempt + 1} attempt(s): ${detail}`);
    }
  }

  throw new Error("DÖE export download failed");
}

export async function getDoeDay(publicationDate, options = {}) {
  if (cache.has(publicationDate)) return cache.get(publicationDate);
  if (pending.has(publicationDate)) return pending.get(publicationDate);

  const request = (async () => {
    const { url, buffer } = await downloadDoeExport(publicationDate, options);
    const tables = await parseDoeExport(buffer);
    const value = {
      source: "doe",
      publication_date: publicationDate,
      export_url: url,
      table_counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      notices: normalizeDoeTables(tables, publicationDate),
    };
    cache.set(publicationDate, value);
    while (cache.size > Number(process.env.MAX_DOE_CACHE_DAYS ?? 1)) cache.delete(cache.keys().next().value);
    return value;
  })();

  pending.set(publicationDate, request);
  try {
    return await request;
  } finally {
    pending.delete(publicationDate);
  }
}

function isoDays(from, to, maxDays = 7) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start > end) {
    throw new Error("Invalid DÖE publication date range");
  }
  const days = [];
  for (let date = start; date <= end; date = new Date(date.valueOf() + 86400000)) {
    if (days.length >= maxDays) throw new Error(`DÖE searches are limited to ${maxDays} publication days per call`);
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

export async function searchDoe(options, dependencies = {}) {
  const from = options.published_from ?? options.published_to;
  const to = options.published_to ?? options.published_from;
  if (!from || !to) throw new Error("DÖE search requires published_from and/or published_to");
  const days = isoDays(from, to, Number(process.env.MAX_DOE_DAYS ?? 3));
  const terms = (options.keywords ?? []).map((value) => String(value).toLocaleLowerCase("de"));
  const cpvs = (options.cpv_codes ?? []).map(String);
  const countries = (options.countries ?? []).map((value) => String(value).toUpperCase());
  const notices = [];
  const exportTableCounts = [];
  for (const day of days) {
    const item = await getDoeDay(day, dependencies);
    exportTableCounts.push({ publication_date: item.publication_date, tables: item.table_counts });
    for (const notice of item.notices) {
      if (terms.length && !terms.some((term) => JSON.stringify(notice).toLocaleLowerCase("de").includes(term))) continue;
      if (cpvs.length && !notice.cpv_codes.some((code) => cpvs.some((cpv) => code.startsWith(cpv)))) continue;
      if (countries.length && !notice.countries.some((country) => countries.includes(country.toUpperCase()))) continue;
      notices.push(notice);
    }
  }
  const page = options.page ?? 1;
  const pageSize = Math.min(options.page_size ?? 20, 100);
  return {
    source: "doe",
    publication_days: days,
    page,
    page_size: pageSize,
    total: notices.length,
    notices: notices.slice((page - 1) * pageSize, page * pageSize),
    export_table_counts: exportTableCounts,
  };
}

export async function getDoeNotice(sourceNoticeId, publicationDate, dependencies = {}) {
  const day = await getDoeDay(publicationDate, dependencies);
  const notice = day.notices.find((item) => item.source_notice_id === sourceNoticeId) ?? null;
  return { source: "doe", source_notice_id: sourceNoticeId, found: Boolean(notice), notice };
}
