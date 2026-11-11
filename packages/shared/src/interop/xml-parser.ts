export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeEntities = (raw: string): string =>
  raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });

const ATTR_RE = /([a-zA-Z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let rest = xml
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const tagRe = /<(\/?)([a-zA-Z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let lastTextEnd = 0;
  let m: RegExpExecArray | null;

  const appendText = (chunk: string) => {
    if (!chunk.trim()) return;
    const parent = stack[stack.length - 1];
    parent.text += (parent.text ? ' ' : '') + decodeEntities(chunk).trim();
  };

  while ((m = tagRe.exec(rest))) {
    const full = m[0];
    if (full.startsWith('<![CDATA[')) {
      appendText(rest.slice(lastTextEnd, m.index));
      appendText(m[5] ?? '');
      lastTextEnd = m.index + full.length;
      continue;
    }
    appendText(rest.slice(lastTextEnd, m.index));
    lastTextEnd = m.index + full.length;
    const [, closing, rawTag, rawAttrs, selfClosing, ] = m;
    if (closing) {
      const idx = stack.map((n) => n.tag).lastIndexOf(rawTag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const attrs: Record<string, string> = {};
    if (rawAttrs) {
      let am: RegExpExecArray | null;
      ATTR_RE.lastIndex = 0;
      while ((am = ATTR_RE.exec(rawAttrs))) attrs[am[1]] = decodeEntities(am[3] ?? am[4] ?? '');
    }
    const node: XmlNode = { tag: rawTag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  appendText(rest.slice(lastTextEnd));
  return root;
}

const tagMatches = (nodeTag: string, targetTag: string): boolean => {
  if (nodeTag === targetTag || nodeTag.toLowerCase() === targetTag.toLowerCase()) return true;
  const idx = nodeTag.indexOf(':');
  if (idx !== -1) {
    const local = nodeTag.slice(idx + 1);
    if (local === targetTag || local.toLowerCase() === targetTag.toLowerCase()) return true;
  }
  return false;
};

export const findChildren = (node: XmlNode, tag: string): XmlNode[] =>
  node.children.filter((c) => tagMatches(c.tag, tag));

export const findChild = (node: XmlNode, tag: string): XmlNode | undefined => findChildren(node, tag)[0];

export const walkTags = (node: XmlNode, tag: string): XmlNode[] => {
  const out: XmlNode[] = [];
  const visit = (n: XmlNode) => {
    for (const c of n.children) {
      if (tagMatches(c.tag, tag)) out.push(c);
      visit(c);
    }
  };
  visit(node);
  return out;
};

export const escXml = (unsafe: unknown): string =>
  String(unsafe ?? '').replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  );
