import test from "node:test";
import assert from "node:assert/strict";
import { downloadDoeExport, normalizeDoeTables } from "../src/providers/doe.js";

test("normalizes relational DÖE export tables", () => {
  const notices = normalizeDoeTables({
    notice: [{ noticeId: "N-1", publicationDate: "2026-01-10", noticeUrl: "https://example.test/N-1" }],
    procedure: [{ noticeId: "N-1", title: "Neutral development tender" }],
    purpose: [{ noticeId: "N-1", description: "Build a system" }],
    classification: [{ noticeId: "N-1", cpvCode: "72000000" }],
    organisation: [{ noticeId: "N-1", officialName: "Public buyer" }],
    placeOfPerformance: [{ noticeId: "N-1", countryCode: "DE" }],
    submissionTerms: [{ noticeId: "N-1", tenderDeadline: "2026-02-01T12:00:00Z" }],
    tender: [{ noticeId: "N-1", documentsUrl: "https://example.test/docs" }],
  }, "2026-01-10");

  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, "Neutral development tender");
  assert.deepEqual(notices[0].buyers, ["Public buyer"]);
  assert.deepEqual(notices[0].cpv_codes, ["72000000"]);
  assert.deepEqual(notices[0].document_links, ["https://example.test/docs"]);
});

test("retries a transient DÖE response and then returns the export", async () => {
  const originalRetries = process.env.DOE_MAX_RETRIES;
  process.env.DOE_MAX_RETRIES = "1";
  let calls = 0;
  const delays = [];
  try {
    const result = await downloadDoeExport("2026-08-13", {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
        return new Response(Buffer.from("zip-data"), { status: 200, headers: { "content-length": "8" } });
      },
      sleepImpl: async (milliseconds) => { delays.push(milliseconds); },
    });
    assert.equal(calls, 2);
    assert.deepEqual(delays, [0]);
    assert.equal(result.buffer.toString(), "zip-data");
  } finally {
    if (originalRetries == null) delete process.env.DOE_MAX_RETRIES;
    else process.env.DOE_MAX_RETRIES = originalRetries;
  }
});

test("does not retry a permanent DÖE client error", async () => {
  const originalRetries = process.env.DOE_MAX_RETRIES;
  process.env.DOE_MAX_RETRIES = "2";
  let calls = 0;
  try {
    await assert.rejects(
      downloadDoeExport("2026-08-13", {
        fetchImpl: async () => {
          calls += 1;
          return new Response("bad request", { status: 400 });
        },
        sleepImpl: async () => {},
      }),
      /DÖE export API returned 400/,
    );
    assert.equal(calls, 1);
  } finally {
    if (originalRetries == null) delete process.env.DOE_MAX_RETRIES;
    else process.env.DOE_MAX_RETRIES = originalRetries;
  }
});
