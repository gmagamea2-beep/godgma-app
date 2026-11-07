// 스냅샷(원본 파일들) → 화면에 쓰는 모델. 공유 모드면 모든 문자열을 먼저 가린다.
import { createMasker } from './share.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text) {
  const m = FRONTMATTER.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

/**
 * @returns {{ title, subtitle, tabs, changelog, shareAvailable, shareActive, shareLeftovers, missing }}
 */
export function buildModel(snapshot, { shareMode }) {
  const files = snapshot?.files || {};
  const masker = createMasker(files['share_rules.json']?.text);
  const active = Boolean(shareMode && masker);
  const t = active ? masker.mask : (s) => s;

  // index.json 은 가리지 않은 채로 읽는다. 파일 경로에도 이름이 들어 있어서, 먼저 가리면 파일을 못 찾는다.
  // 화면에 보이는 문자열만 t() 로 가린다.
  let index;
  try {
    index = JSON.parse(files['index.json']?.text || '{}');
  } catch {
    index = {};
  }

  let globalIdx = 0;
  const tabs = (Array.isArray(index.tabs) ? index.tabs : []).map((tab) => ({
    id: String(tab.id),
    title: t(String(tab.title ?? tab.id)),
    // 세계관은 원본처럼 한 화면에 이어서 보여 주고, 나머지는 하위 탭 하나씩 보여 준다.
    stacked: tab.stacked ?? tab.id === 'world',
    pages: (tab.pages || []).map((page) => {
      const file = files[page.file];
      const { meta, body } = parseFrontmatter(t(file?.text ?? ''));
      return {
        id: t(String(page.id)),
        title: t(String(meta.title ?? page.title ?? page.id)),
        file: t(String(page.file)),
        body,
        missing: !file,
        globalIdx: globalIdx++,
      };
    }),
  }));

  const leftovers = new Set();
  if (active) {
    for (const tab of tabs) {
      for (const p of tab.pages) masker.leftovers(p.title + '\n' + p.body).forEach((x) => leftovers.add(x));
    }
  }

  return {
    title: t(String(index.title || '그마 설정집')),
    subtitle: t(String(index.subtitle || '')),
    tabs,
    changelog: t(files['CHANGELOG.md']?.text || ''),
    shareAvailable: Boolean(masker),
    shareActive: active,
    shareLeftovers: [...leftovers],
    missing: snapshot?.missing || [],
  };
}

/** 본문에서 h2~h4 줄을 찾는다. 렌더링된 제목 순서와 같아야 검색·정할 것에서 위치로 이동할 수 있다. */
export const HEADING_LINE = /^(#{2,4})\s+(.*)$/;

/** Markdown 한 줄 → 검색·목록용 평문 */
export function plainText(line) {
  return line
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\|?\s*-{3,}.*$/, '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/(\*\*|__|\*|`)/g, '')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
