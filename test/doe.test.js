import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDoeTables } from "../src/providers/doe.js";

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
