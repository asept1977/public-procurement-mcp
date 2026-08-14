import test from "node:test";
import assert from "node:assert/strict";
import { searchNotices } from "../src/service.js";

function upstreamFetch({ tedStatus = 200, doeStatus = 504 } = {}) {
  return async (url) => {
    if (String(url).includes("api.ted.europa.eu")) {
      return new Response(JSON.stringify(tedStatus === 200
        ? { totalNoticeCount: 1, notices: [{ "publication-number": "1-2026", "notice-title": "Example" }] }
        : { message: "TED failed" }), {
        status: tedStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("DÖE failed", { status: doeStatus });
  };
}

test("returns TED results when DÖE fails in a combined search", async () => {
  const originalRetries = process.env.DOE_MAX_RETRIES;
  process.env.DOE_MAX_RETRIES = "0";
  try {
    const result = await searchNotices({
      source: "all",
      keywords: ["example"],
      published_from: "2026-08-13",
      published_to: "2026-08-13",
    }, { fetchImpl: upstreamFetch() });

    assert.equal(result.ok, true);
    assert.equal(result.partial, true);
    assert.equal(result.total, 1);
    assert.equal(result.notices[0].source, "ted");
    assert.equal(result.source_results.find((item) => item.source === "ted").ok, true);
    assert.equal(result.source_results.find((item) => item.source === "doe").ok, false);
    assert.match(result.warnings[0].error, /DÖE export API returned 504/);
  } finally {
    if (originalRetries == null) delete process.env.DOE_MAX_RETRIES;
    else process.env.DOE_MAX_RETRIES = originalRetries;
  }
});

test("reports every source error when all selected sources fail", async () => {
  const originalRetries = process.env.DOE_MAX_RETRIES;
  process.env.DOE_MAX_RETRIES = "0";
  try {
    await assert.rejects(searchNotices({
      source: "all",
      published_from: "2026-08-13",
      published_to: "2026-08-13",
    }, { fetchImpl: upstreamFetch({ tedStatus: 400, doeStatus: 504 }) }), (error) => {
      assert.match(error.message, /ted: TED Search API returned 400/);
      assert.match(error.message, /doe: DÖE export API returned 504/);
      return true;
    });
  } finally {
    if (originalRetries == null) delete process.env.DOE_MAX_RETRIES;
    else process.env.DOE_MAX_RETRIES = originalRetries;
  }
});
