import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

export interface HtmlSlot {
  name: string;
  placeholder: string;
  kind: string;
  injectionHtml: string;
  required: boolean;
  role?: "body" | "document_title" | "meta_description" | "meta_keywords";
}

export interface SlotValidationResult {
  ok: boolean;
  missing: string[];
  duplicate: string[];
  invalid: string[];
  unknown: string[];
  errors: string[];
  presentCount: number;
  expectedCount: number;
}

const TOKEN = /\{\{([^{}]+)\}\}/g;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const NON_BODY_CONTENT = new Set(["head", "title", "script", "style", "template", "textarea", "xmp", "plaintext", "datalist", "iframe", "noembed", "noframes", "noscript", "select", "option", "canvas", "object", "audio", "video"]);
const BLOCK_HOSTS = new Set(["body", "div", "section", "article", "main", "aside", "header", "footer", "nav", "li", "blockquote", "td", "dd"]);

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function attr(node: Element, name: string): string | undefined {
  return node.attrs.find((attribute) => attribute.name === name)?.value;
}

function elementsAbove(node: Node): Element[] {
  const result: Element[] = [];
  let current: Node | null = node;
  while (current) {
    if (isElement(current)) result.push(current);
    current = "parentNode" in current ? current.parentNode : null;
  }
  return result;
}

function hiddenDeclarations(css: string): boolean {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?(?![\d.])|font-size\s*:\s*0(?:px|rem|em|%)?(?![\w.])|clip\s*:\s*rect\(\s*0|clip-path\s*:\s*inset\(\s*(?:50|100)%)/i.test(cleaned);
}

// Recognize ordinary local hiding rules as well as inline declarations. This
// is a structural gate, not a browser layout/CSS cascade or script evaluation.
function simpleSelectorMatches(element: Element, selector: string): boolean {
  if (!/^(?:[a-z][\w-]*|\*)?(?:[.#][\w-]+)*$/i.test(selector) || !selector) return false;
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && element.tagName !== tag.toLowerCase()) return false;
  const classes = new Set((attr(element, "class") ?? "").split(/\s+/));
  for (const part of selector.matchAll(/([.#])([\w-]+)/g)) {
    if (part[1] === "." ? !classes.has(part[2]) : attr(element, "id") !== part[2]) return false;
  }
  return true;
}

interface Occurrence {
  slot: HtmlSlot;
  node: TextNode | Element;
  attribute?: string;
  metadata: boolean;
}

function inspect(html: string, slots: readonly HtmlSlot[]) {
  const document = parse(html);
  const byName = new Map(slots.map((slot) => [slot.name, slot]));
  const allNodes: Node[] = [];
  const visit = (node: Node) => {
    allNodes.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
    if (isElement(node) && node.tagName === "template") visit((node as DefaultTreeAdapterMap["template"]).content);
  };
  visit(document);
  const hiddenSelectors: string[] = [];
  for (const node of allNodes) {
    if (!isElement(node) || node.tagName !== "style") continue;
    const css = node.childNodes.filter((child): child is TextNode => child.nodeName === "#text").map((child) => child.value).join("").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (hiddenDeclarations(rule[2])) hiddenSelectors.push(...rule[1].split(",").map((selector) => selector.trim()));
    }
  }

  const occurrences: Occurrence[] = [];
  const counts = new Map<string, number>();
  const bodyCounts = new Map<string, number>();
  const invalid = new Set<string>();
  const unknown = new Set<string>();
  const errors: string[] = [];

  function check(value: string, node: Node, attribute?: string) {
    for (const match of value.matchAll(TOKEN)) {
      const name = match[1];
      const slot = byName.get(name);
      if (!slot) {
        unknown.add(name);
        errors.push(`Unknown placeholder: ${name}`);
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const ancestors = elementsAbove(node);
      const host = ancestors[0];
      const role = slot.role ?? "body";
      const text = node.nodeName === "#text";
      const inHead = ancestors.some((ancestor) => ancestor.tagName === "head");
      const title = text && host?.tagName === "title" && inHead;
      const metaName = host && (attr(host, "name") ?? attr(host, "property"))?.toLowerCase();
      const metadata = (role === "document_title" && title) ||
        (role === "meta_description" && inHead && host?.tagName === "meta" && attribute === "content" && metaName === "description") ||
        (role === "meta_keywords" && inHead && host?.tagName === "meta" && attribute === "content" && metaName === "keywords") ||
        // Legacy designs may repeat the name in the document title or site-name
        // metadata. Those repetitions never satisfy its required body slot.
        (name === "PROJECT_NAME" && (title || (inHead && host?.tagName === "meta" && attribute === "content" && metaName === "og:site_name")));
      const hidden = ancestors.some((ancestor) =>
        ancestor.namespaceURI !== HTML_NAMESPACE || NON_BODY_CONTENT.has(ancestor.tagName) ||
        attr(ancestor, "hidden") !== undefined || attr(ancestor, "inert") !== undefined ||
        attr(ancestor, "aria-hidden")?.toLowerCase() === "true" ||
        (ancestor.tagName === "dialog" && attr(ancestor, "open") === undefined) ||
        (ancestor.tagName === "details" && attr(ancestor, "open") === undefined &&
          !ancestors.includes(ancestor.childNodes.find((child): child is Element => isElement(child) && child.tagName === "summary")!)) ||
        hiddenDeclarations(attr(ancestor, "style") ?? "") ||
        (attr(ancestor, "class") ?? "").split(/\s+/).some((name) => /^(?:hidden|invisible|collapse|sr-only|opacity-0|text-\[0(?:px)?\])$/.test(name)) ||
        hiddenSelectors.some((selector) => simpleSelectorMatches(ancestor, selector))
      );
      const body = role === "body" && text && !attribute && !hidden && ancestors.some((ancestor) => ancestor.tagName === "body");
      const block = slot.kind === "body_paragraph" || slot.kind === "html_block";
      const incompatibleBlock = block && (!host || !BLOCK_HOSTS.has(host.tagName) || value.trim() !== slot.placeholder);
      const nestedLink = slot.injectionHtml.includes("<a ") && ancestors.some((ancestor) => ancestor.tagName === "a" || ancestor.tagName === "button");
      if (!metadata && (!body || incompatibleBlock || nestedLink)) {
        invalid.add(name);
        errors.push(`${name}: requires ${role === "body" ? block ? "an entire visible block container" : "visible body text" : "its declared metadata element"}; found ${attribute ? `${host?.tagName}.${attribute}` : host?.tagName ?? node.nodeName}`);
        continue;
      }
      if (role !== "body" || !metadata) bodyCounts.set(name, (bodyCounts.get(name) ?? 0) + 1);
      occurrences.push({ slot, node: node as TextNode | Element, attribute, metadata });
    }
  }

  for (const node of allNodes) {
    if (node.nodeName === "#text") check((node as TextNode).value, node);
    else if (node.nodeName === "#comment") check((node as DefaultTreeAdapterMap["commentNode"]).data, node);
    if (isElement(node)) {
      for (const attribute of node.attrs) {
        check(attribute.value, node, attribute.name);
        if (attribute.name.includes("{{")) check(attribute.name, node, attribute.name);
      }
    }
  }

  const required = slots.filter((slot) => slot.required);
  const missing = required.filter((slot) => !(bodyCounts.get(slot.name) ?? 0)).map((slot) => slot.name);
  const duplicate = slots.filter((slot) => slot.name !== "PROJECT_NAME" && (counts.get(slot.name) ?? 0) > 1).map((slot) => slot.name);
  errors.push(...missing.map((name) => `${name}: required slot missing`), ...duplicate.map((name) => `${name}: duplicate slot`));
  // Placeholders consumed by HTML parsing (for example in tag names) cannot
  // disappear silently. DOM-decoded occurrences cover ordinary attributes/text.
  const rawNames = [...html.matchAll(TOKEN)].map((match) => match[1]);
  for (const name of new Set(rawNames)) {
    if (rawNames.filter((rawName) => rawName === name).length > (counts.get(name) ?? 0) && !unknown.has(name)) {
      invalid.add(name);
      errors.push(`${name}: placeholder is outside a supported DOM slot`);
    }
  }
  const result: SlotValidationResult = {
    ok: errors.length === 0,
    missing, duplicate, invalid: [...invalid], unknown: [...unknown], errors,
    presentCount: required.length - missing.length,
    expectedCount: required.length,
  };
  return { document, occurrences, result };
}

export function validateSlots(html: string, slots: readonly HtmlSlot[]): SlotValidationResult {
  return inspect(html, slots).result;
}

function plainText(html: string): string {
  const fragment = parseFragment(html);
  const text = (node: Node): string => node.nodeName === "#text" ? (node as TextNode).value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
  return text(fragment);
}

export function injectSlots(html: string, slots: readonly HtmlSlot[]): string {
  const { document, occurrences, result } = inspect(html, slots);
  if (!result.ok) throw new Error(`Template slot validation failed: ${result.errors.join("; ")}`);

  // Group original nodes so injected campaign text is never scanned again as
  // template syntax, even if it contains another placeholder literally.
  const textNodes = new Map<TextNode, Occurrence[]>();
  const attributes = new Map<Element, Map<string, Occurrence[]>>();
  for (const occurrence of occurrences) {
    if (occurrence.attribute) {
      const element = occurrence.node as Element;
      const groups = attributes.get(element) ?? new Map<string, Occurrence[]>();
      const group = groups.get(occurrence.attribute) ?? [];
      group.push(occurrence);
      groups.set(occurrence.attribute, group);
      attributes.set(element, groups);
    } else {
      const node = occurrence.node as TextNode;
      const group = textNodes.get(node) ?? [];
      group.push(occurrence);
      textNodes.set(node, group);
    }
  }
  for (const [element, groups] of attributes) {
    for (const [name, group] of groups) {
      const attribute = element.attrs.find((item) => item.name === name)!;
      attribute.value = attribute.value.replace(TOKEN, (placeholder) => plainText(group.find((item) => item.slot.placeholder === placeholder)!.slot.injectionHtml));
    }
  }
  for (const [node, group] of textNodes) {
    const parent = node.parentNode!;
    if (group.every((item) => item.metadata)) {
      node.value = node.value.replace(TOKEN, (placeholder) => plainText(group.find((item) => item.slot.placeholder === placeholder)!.slot.injectionHtml));
      continue;
    }
    const escaped = node.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const replacement = escaped.replace(TOKEN, (placeholder) => group.find((item) => item.slot.placeholder === placeholder)!.slot.injectionHtml);
    const fragment = parseFragment(parent as Element, replacement, {});
    const index = parent.childNodes.indexOf(node);
    for (const child of fragment.childNodes) child.parentNode = parent;
    parent.childNodes.splice(index, 1, ...fragment.childNodes);
  }
  return serialize(document);
}
