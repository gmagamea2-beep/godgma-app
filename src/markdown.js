import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const md = new Marked({ gfm: true, breaks: false });

// CommonMark 의 강조 규칙은 `는**"왕"**이다` 처럼 한글 바로 옆에 붙은 ** 를 굵게로 보지 않는다.
// 설정 데이터는 ** 를 굵게 표시로만 쓰므로, 앞뒤 글자와 상관없이 짝이 맞는 ** 는 굵게 처리한다.
md.use({
  extensions: [
    {
      name: 'cjkStrong',
      level: 'inline',
      start(src) {
        const i = src.indexOf('**');
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^\*\*(?!\s)([^*]+?)(?<!\s)\*\*/.exec(src);
        if (!m) return undefined;
        return { type: 'strong', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
    },
    {
      // 부제 문단 `*설명 … **굵게** … (제안 초안)*` 도 같은 이유로 기울임 처리가 깨져서 함께 처리한다.
      name: 'cjkEm',
      level: 'inline',
      start(src) {
        const i = src.search(/\*(?![\s*])/);
        return i < 0 ? undefined : i;
      },
      tokenizer(src) {
        const m = /^\*(?![\s*])((?:\*\*[^*]+?\*\*|[^*])+?)(?<!\s)\*(?!\*)/.exec(src);
        if (!m) return undefined;
        return { type: 'em', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
    },
  ],
});

/** Markdown → 정화된 HTML 문자열 */
export function renderMarkdown(body) {
  // 화수 범위("101~120화 / 총 301~320화")의 물결표가 GFM 취소선(~글자~)으로 해석되지 않도록 모두 글자로 취급한다.
  const html = md.parse(body.replace(/~/g, '\\~'));
  // 문장·표 안의 미정 표시(☐)를 강조할 수 있게 감싼다.
  const marked = html.replace(/☐/g, '<span class="todo-mark">☐</span>');
  return DOMPurify.sanitize(marked);
}

/**
 * 렌더링한 페이지를 손본다: 제목에 위치 id, 표 가로 스크롤, 빈 머리글 제거, 주석·부제·미정 스타일.
 * @param {HTMLElement} root
 * @param {number} pageIdx 전체 페이지 번호 (제목 id 를 겹치지 않게)
 */
export function enhance(root, pageIdx) {
  root.querySelectorAll('h2, h3, h4').forEach((h, n) => {
    h.id = `p${pageIdx}-h${n}`;
  });

  root.querySelectorAll('table').forEach((table) => {
    const thead = table.querySelector('thead');
    if (thead && !thead.textContent.trim()) {
      thead.remove();
      table.classList.add('kv');
    }
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });

  root.querySelectorAll('blockquote').forEach((q) => {
    if (q.textContent.trim().startsWith('※')) q.classList.add('note');
  });

  root.querySelectorAll('p').forEach((p) => {
    const only = p.children.length === 1 ? p.firstElementChild : null;
    if (only && only.tagName === 'EM' && only.textContent.trim() === p.textContent.trim()) p.classList.add('sub');
  });

  root.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector(':scope > input[type="checkbox"]');
    if (box && !box.checked) li.classList.add('todo-item');
  });
  root.querySelectorAll('ul').forEach((ul) => {
    if (ul.querySelector(':scope > li.todo-item')) ul.classList.add('todo-list');
  });
}
