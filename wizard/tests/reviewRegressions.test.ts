import test from "node:test";
import assert from "node:assert/strict";
import { validateSlots, injectSlots, type HtmlSlot } from "../server/_core/htmlSlots";
import { findBestSourceMatch } from "../server/_core/citationMatch";

test("browser-intrinsic hidden and raw-text containers cannot satisfy body slots", () => {
  const slots: HtmlSlot[] = [{name:"FACT",placeholder:"{{FACT}}",kind:"body_short",required:true,injectionHtml:'claim <a href="https://example.invalid">[SOURCE]</a>'}];
  for (const body of [
    "<dialog><div>{{FACT}}</div></dialog>",
    "<datalist><div>{{FACT}}</div></datalist>",
    "<details><summary>first</summary><summary>{{FACT}}</summary></details>",
    "<details><summary>outer</summary><details open><summary>{{FACT}}</summary></details></details>",
    "<plaintext>{{FACT}}",
  ]) {
    assert.equal(validateSlots(body,slots).ok,false,body);
    assert.throws(()=>injectSlots(body,slots),/validation failed/);
  }
  for (const body of ["<dialog open><div>{{FACT}}</div></dialog>","<details><summary>{{FACT}}</summary></details>","<div>{{FACT}}</div>"]) {
    assert.equal(validateSlots(body,slots).ok,true,body);
    assert.match(injectSlots(body,slots),/\[SOURCE\]/);
  }
});

test("null, missing and empty URLs remain unresolved without displacing exact identities", () => {
  for(const url of [null,undefined,""]) {
    const sources=[{id:"upload",title:"Official file report",url},{id:"other",title:"Official file report annex",url:"https://example.invalid/annex"}];
    assert.equal(findBestSourceMatch("upload",sources),null);
    assert.equal(findBestSourceMatch("Official file report",sources),null);
    assert.equal(findBestSourceMatch("other",sources)?.id,"other");
    assert.equal(findBestSourceMatch("no matching words",sources),null);
  }
});
