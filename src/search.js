// 전체 검색과 "정할 것" 모으기. 둘 다 본문을 제목 단위로 나눠 위치(페이지·제목 번호)를 기억한다.
import { HEADING_LINE, plainText } from './model.js';

const MAX_RESULTS = 120;
const SNIPPET_RADIUS = 40;

function* walkPages(model) {
  for (const tab of model.tabs) {
    for (const [pageNo, page] of tab.pages.entries()) {
      let heading = -1;
      let headingText = '';
      for (const line of page.body.split(/\r?\n/)) {
        const h = HEADING_LINE.exec(line);
        if (h) {
          heading += 1;
          headingText = plainText(h[2]);
        }
        // 대부분의 페이지는 첫 줄이 페이지 제목과 같은 ## 제목이라 경로에서 겹치지 않게 뺀다.
        const context = headingText && headingText !== page.title ? headingText : '';
        yield { tab, page, pageNo, heading, headingText: context, line, isHeading: Boolean(h) };
      }
    }
  }
}

/** 검색용 덩어리: 제목 하나와 그 아래 본문 */
export function buildSearchIndex(model) {
  const chunks = [];
  let cur = null;
  for (const row of walkPages(model)) {
    if (!cur || cur.page !== row.page || row.isHeading) {
      cur = {
        tabId: row.tab.id,
        tabTitle: row.tab.title,
        page: row.page,
        pageNo: row.pageNo,
        heading: row.heading,
        headingText: row.headingText,
        text: '',
      };
      chunks.push(cur);
    }
    const plain = plainText(row.line);
    if (plain) cur.text += (cur.text ? ' ' : '') + plain;
  }
  for (const c of chunks) c.haystack = `${c.page.title} ${c.headingText} ${c.text}`.toLowerCase();
  return chunks;
}

export function search(index, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const c of index) {
    if (!terms.every((t) => c.haystack.includes(t))) continue;
    results.push({ ...c, snippet: snippet(c.text, terms[0]) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function snippet(text, term) {
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, i - SNIPPET_RADIUS);
  const end = Math.min(text.length, i + term.length + SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** "- [ ] 미정" 줄과 문장·표 안의 ☐ 를 모은다. */
export function collectTodos(model) {
  const todos = [];
  for (const row of walkPages(model)) {
    const task = /^\s*[-*+]\s+\[ \]\s+(.*)$/.exec(row.line);
    if (task) {
      todos.push({ ...pick(row), text: plainText(task[1]) });
      continue;
    }
    if (!row.line.includes('☐')) continue;
    if (row.line.trim().startsWith('|')) {
      // 표 행: 첫 칸(항목 이름)을 붙여서 무엇이 미정인지 알 수 있게 한다.
      const cells = row.line.split('|').slice(1, -1).map((c) => plainText(c));
      const label = cells[0] && !cells[0].includes('☐') ? cells[0] : '';
      for (const cell of cells) {
        if (cell.includes('☐')) todos.push({ ...pick(row), text: (label ? `${label}: ` : '') + cell.replace(/☐\s*/g, '') });
      }
    } else {
      const plain = plainText(row.line);
      todos.push({ ...pick(row), text: plain.replace(/☐\s*/g, '') });
    }
  }
  return todos;
}

function pick(row) {
  return {
    tabId: row.tab.id,
    tabTitle: row.tab.title,
    page: row.page,
    pageNo: row.pageNo,
    heading: row.heading,
    headingText: row.headingText,
  };
}
