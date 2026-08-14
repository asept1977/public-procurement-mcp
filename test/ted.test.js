import test from "node:test";
import assert from "node:assert/strict";
import { buildTedQuery, normalizeTedNotice, searchTed } from "../src/providers/ted.js";

test("buildTedQuery preserves an explicit expert query", () => {
  assert.equal(buildTedQuery({ expert_query: "classification-cpv = 72000000" }), "classification-cpv = 72000000");
});

test("buildTedQuery creates neutral filters", () => {
  const query = buildTedQuery({
    keywords: ["platform"],
    published_from: "2026-01-01",
    countries: ["de"],
    cpv_codes: ["72000000"],
  });
  assert.match(query, /FT=\("platform"\)/);
  assert.match(query, /publication-date >= 20260101/);
  assert.match(query, /place-of-performance-country-lot IN \(DE\)/);
});

test("normalizeTedNotice keeps the original record", () => {
  const raw = {
    "publication-number": "123456-2026",
    "notice-title": {
      hun: "Magyar cím",
      eng: "A neutral tender",
      deu: "Eine neutrale Ausschreibung",
    },
    "buyer-name": ["Example buyer"],
    "classification-cpv": ["72000000"],
  };
  const notice = normalizeTedNotice(raw);
  assert.equal(notice.source_notice_id, "123456-2026");
  assert.equal(notice.title, "Eine neutrale Ausschreibung");
  assert.deepEqual(notice.cpv_codes, ["72000000"]);
  assert.equal(notice.raw, raw);
});

test("searchTed sends a v3 request and normalizes results", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      totalNoticeCount: 1,
      notices: [{ "publication-number": "1-2026", "notice-title": "Example" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await searchTed({ keywords: ["example"], page: 2, page_size: 10 }, { fetchImpl });
  assert.equal(request.url, "https://api.ted.europa.eu/v3/notices/search");
  assert.equal(request.body.query, 'FT=("example")');
  assert.equal(request.body.page, 2);
  assert.equal(request.body.limit, 10);
  assert.equal(request.body.paginationMode, "PAGE_NUMBER");
  assert.equal("q" in request.body, false);
  assert.equal("pageNum" in request.body, false);
  assert.equal("pageSize" in request.body, false);
  assert.equal(result.total, 1);
  assert.equal(result.notices[0].source, "ted");
});
