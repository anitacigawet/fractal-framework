import assert from "node:assert/strict";
import test from "node:test";
import { findBestSourceMatch, type NotebookSource } from "../server/_core/citationMatch";

const exact: NotebookSource = { id: "source-current", title: "County Water Report 2026", url: "https://example.test/current" };
const withdrawn: NotebookSource = { id: "source-withdrawn", title: "County Water Report 2026 draft withdrawn", url: "https://example.test/withdrawn" };

test("exact IDs and titles beat longer fuzzy overlaps in either source order", () => {
  for (const sources of [[withdrawn, exact], [exact, withdrawn]]) {
    assert.equal(findBestSourceMatch(exact.id, sources), exact);
    assert.equal(findBestSourceMatch(exact.title, sources), exact);
    assert.equal(findBestSourceMatch(" county  WATER report 2026 ", sources), exact);
  }
});

test("ambiguous fuzzy descriptions and duplicate titles remain unresolved", () => {
  assert.equal(findBestSourceMatch("county water", [exact, withdrawn]), null);
  assert.equal(findBestSourceMatch("county water", [withdrawn, exact]), null);
  assert.equal(findBestSourceMatch(exact.title, [exact, { ...exact, id: "another", url: "https://example.test/another" }]), null);
  assert.equal(findBestSourceMatch("unmatched", [exact]), null);
  assert.equal(findBestSourceMatch("county water", [{ ...exact, url: "" }]), null);
  assert.equal(findBestSourceMatch(exact.title, [{ ...exact, url: "" }, withdrawn]), null);
  assert.equal(findBestSourceMatch(exact.id, [{ ...exact, url: "" }, withdrawn]), null);
  assert.equal(findBestSourceMatch("draft withdrawn", [exact, withdrawn]), withdrawn);
});
