export interface NumberedItem {
  number: number;
  body: string;
}

// Match item starts only. Multiline `$` matches every physical line ending,
// so using it as the body terminator would discard continuation claims.
export function parseNumberedItems(text: string): NumberedItem[] {
  const starts = [...text.matchAll(/^[\t ]*(\d+)[.)](?:[\t ]+|(?=\r?$))/gm)];
  return starts.map((match, index) => {
    const start = match.index! + match[0].length;
    const end = starts[index + 1]?.index ?? text.length;
    const body = text.slice(start, end).trim().replace(
      /^\*\*(?:Page title|Meta description|Three SEO keywords|Breaking[- ]news banner|Headline|Subhead|Primary call[- ]to[- ]action label):?\*\*[\t ]*[:—–-]?[\t ]*/i,
      ""
    ).trim();
    return { number: Number(match[1]), body };
  });
}

export function getItem(items: NumberedItem[], number: number): string | undefined {
  return items.find((item) => item.number === number)?.body;
}
