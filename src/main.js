import './style.css';
import pkg from '../package.json';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './db.js';
import { enhance, renderMarkdown } from './markdown.js';
import { buildModel, plainText } from './model.js';
import { buildSearchIndex, collectTodos, search } from './search.js';
import { DEFAULTS, FONT_SCALES, loadSettings, saveSettings, sourceKey } from './settings.js';
import { SyncError, sync } from './sync.js';

const isSite = () => state.settings.source === 'public' || state.settings.source === 'full';

const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TOAST_MS = 3200;
const SEARCH_DEBOUNCE_MS = 120;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9_.\/-]+$/;

const app = document.getElementById('app');
const printRoot = document.getElementById('print-root');

const state = {
  settings: loadSettings(),
  snapshot: null,
  model: buildModel(null, { shareMode: false }),
  searchIndex: [],
  todos: [],
  htmlCache: new Map(),
  syncing: false,
  lastError: '',
  searchQuery: '',
  codeError: '',
};

// ---------- 공통 유틸 ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function formatTime(ms) {
  if (!ms) return '없음';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer = 0;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
}

const ICONS = {
  world: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9m0-18C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9M3.5 9h17M3.5 15h17"/>',
  story: '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Zm0 12a4 4 0 0 1 4-4h10"/>',
  chars: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 9a6 6 0 0 1 12 0m1-9a3.5 3.5 0 1 0 0-7m2 16a5 5 0 0 0-3-4.6"/>',
  todo: '<path d="M9 6h11M9 12h11M9 18h11M4 5.5h1.5V7H4zM4 11.5h1.5V13H4zM4 17.5h1.5V19H4z"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  search: '<path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6a14 14 0 0 1-3 3.6M6.5 7.6A14 14 0 0 0 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1M9.9 10a3 3 0 0 0 4.1 4.1"/>',
  page: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>',
  text: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0V5.5ZM12 5.5V19"/>',
  lock: '<path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/>',
  rail: '<path d="M4 5h16v14H4zM9 5v14"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  unlock: '<path d="M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.page}</svg>`;

// ---------- 모델·표시 설정 ----------

function rebuild() {
  state.model = buildModel(state.snapshot, { shareMode: state.settings.shareMode });
  state.searchIndex = buildSearchIndex(state.model);
  state.todos = collectTodos(state.model);
  state.htmlCache.clear();
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyDisplay() {
  const { theme, fontScale } = state.settings;
  const resolved = theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.fontSize = `${fontScale * 100}%`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0e0e14' : '#f6f5fb');
}
darkQuery.addEventListener('change', () => state.settings.theme === 'system' && applyDisplay());

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (!saveSettings(state.settings)) toast('이 기기에 설정을 저장하지 못했습니다 (브라우저 저장소 차단).');
}

// ---------- 라우팅 ----------
// #/t/<탭 id>/<페이지 번호(1부터)>/<제목 번호>  ·  #/todo  ·  #/search  ·  #/more
// 경로에는 순번만 쓴다 (페이지 id 에 이름이 들어 있을 수 있어서).

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [kind] = parts;
  if (kind === 'todo' || kind === 'search' || kind === 'more' || kind === 'unlock') return { kind };
  const tabs = state.model.tabs;
  const tab = (kind === 't' && tabs.find((t) => t.id === parts[1])) || tabs[0];
  if (!tab) return { kind: 'empty' };
  const pageNo = Math.min(Math.max(parseInt(parts[2], 10) || 1, 1), Math.max(tab.pages.length, 1)) - 1;
  const heading = parts[3] !== undefined && /^\d+$/.test(parts[3]) ? Number(parts[3]) : null;
  return { kind: 'tab', tab, pageNo, heading };
}

const tabHref = (tabId, pageNo, heading) =>
  `#/t/${encodeURIComponent(tabId)}/${pageNo + 1}${heading !== null && heading !== undefined && heading >= 0 ? `/${heading}` : ''}`;

// ---------- 화면 조각 ----------

function statusText() {
  if (state.syncing) return '동기화 중…';
  if (state.lastError && !state.snapshot) return '데이터 없음';
  if (!state.snapshot) return '아직 동기화 안 함';
  return `${formatTime(state.snapshot.syncedAt)} 기준${state.lastError ? ' · 오프라인' : ''}`;
}

function topBar() {
  const m = state.model;
  const shareOn = m.shareActive;
  return `
  <header class="topbar">
    ${railAvailable() ? `<button class="icon-btn rail-toggle ${state.settings.railOpen ? 'on-soft' : ''}" id="rail-toggle" aria-pressed="${state.settings.railOpen}" aria-label="목차 열고 닫기">${icon('rail')}</button>` : ''}
    <div class="brand">
      <div class="brand-title">${esc(m.title)}</div>
      <div class="brand-status" id="status">${esc(statusText())}</div>
    </div>
    <a class="icon-btn" href="#/search" aria-label="검색">${icon('search')}</a>
    ${isSite() ? `<a class="icon-btn ${state.settings.source === 'full' ? 'on' : ''}" href="#/unlock" aria-label="실명 보기">${icon(state.settings.source === 'full' ? 'unlock' : 'lock')}</a>` : ''}
    ${state.settings.source === 'public' ? '' : `<button class="icon-btn ${shareOn ? 'on' : ''}" id="share-toggle" aria-pressed="${shareOn}" aria-label="공유 모드">
      ${icon('eyeOff')}<span class="icon-label">공유</span>
    </button>`}
    <button class="icon-btn ${state.syncing ? 'spin' : ''}" id="sync-btn" aria-label="지금 동기화">${icon('sync')}</button>
  </header>
  ${shareOn ? `<div class="share-banner">공유 모드 · 실명을 가린 화면입니다${m.shareLeftovers.length ? ` · <b>가려지지 않은 이름 ${m.shareLeftovers.length}종이 있습니다. share_rules.json 을 확인하세요.</b>` : ''}</div>` : ''}
  ${state.settings.shareMode && !shareOn && state.snapshot ? '<div class="share-banner warn"><b>공유 모드가 켜져 있지만 share_rules.json 이 없어 이름을 가리지 못했습니다.</b></div>' : ''}`;
}

function bottomNav(route) {
  const items = mainNavItems(route);
  return `<nav class="bottomnav">${items
    .map(
      (i) => `<a href="${i.href}" class="${i.active ? 'active' : ''}" ${i.active ? 'aria-current="page"' : ''}>
        ${icon(i.icon)}<span>${esc(i.label)}</span>${i.badge ? `<em class="badge">${i.badge}</em>` : ''}</a>`,
    )
    .join('')}</nav>`;
}

// ---------- 왼쪽 세로 탭 (목차) ----------

const currentRoute = { value: null };
function railAvailable() {
  const r = currentRoute.value;
  return Boolean(r && r.kind === 'tab' && state.snapshot && r.tab.pages.length);
}

/** 본문의 ## 제목 목록. 번호는 enhance() 가 붙이는 h2·h3·h4 순번과 같다. */
function pageHeadings(page) {
  const out = [];
  let n = 0;
  for (const m of page.body.matchAll(/^(#{2,4})\s+(.*)$/gm)) {
    if (m[1].length === 2) out.push({ n, text: plainText(m[2]) });
    n++;
  }
  return out;
}

// 세로 탭에는 짧게: "에피소드:" 와 끝의 (화수) 를 뗀다. 전체 제목은 title 속성으로.
const shortLabel = (t) => t.replace(/^에피소드:\s*/, '').replace(/\s*\([^()]*\)\s*$/, '') || t;

function mainNavItems(route) {
  const items = state.model.tabs.map((t) => ({
    href: tabHref(t.id, 0),
    label: t.title,
    icon: ICONS[t.id] ? t.id : 'page',
    active: route.kind === 'tab' && route.tab === t,
  }));
  items.push({ href: '#/todo', label: '정할 것', icon: 'todo', active: route.kind === 'todo', badge: state.todos.length });
  items.push({ href: '#/more', label: '더보기', icon: 'more', active: route.kind === 'more' });
  return items;
}

function rail(route) {
  // 넓은 화면: 큰 탭(세계관·스토리·등장인물…)도 여기에. 좁은 화면에서는 아래 탭 바가 맡는다.
  const nav = `<nav class="rail-main">${mainNavItems(route)
    .map(
      (i) => `<a href="${i.href}" class="${i.active ? 'active' : ''}">${icon(i.icon)}<span>${esc(i.label)}</span>${i.badge ? `<em class="badge">${i.badge}</em>` : ''}</a>`,
    )
    .join('')}</nav>`;
  if (route.kind !== 'tab' || !state.snapshot || !route.tab.pages.length) {
    return `<aside class="rail rail-wide-only" id="rail">${nav}</aside>`;
  }
  const { tab, pageNo } = route;
  const items = tab.pages
    .map((p, i) => {
      const active = i === pageNo;
      let sub = '';
      if (active && !tab.stacked) {
        const hs = pageHeadings(p).filter((h, k) => !(k === 0 && h.text === p.title.replace(/\s*·\s*/, ' — ')) && !(k === 0 && h.text === p.title));
        if (hs.length > 1) {
          sub = `<ol class="rail-sub">${hs
            .map(
              (h) => `<li><a href="${tabHref(tab.id, i, h.n)}" data-spy="p${p.globalIdx}-h${h.n}" title="${esc(h.text)}">${esc(shortLabel(h.text))}</a></li>`,
            )
            .join('')}</ol>`;
        }
      }
      return `<li><a href="${tabHref(tab.id, i)}" class="rail-item ${active ? 'active' : ''}" ${tab.stacked ? `data-spy="page-${p.globalIdx}"` : ''} title="${esc(p.title)}">${esc(p.title)}</a>${sub}</li>`;
    })
    .join('');
  return `<aside class="rail ${state.settings.railOpen ? '' : 'closed'}" id="rail">${nav}
    <div class="rail-head">${esc(tab.title)} <small>${tab.pages.length}</small></div>
    <ol class="rail-list">${items}</ol></aside>`;
}

/** 하위 탭 하나씩 보는 탭에서: 페이지 끝의 이전·다음 버튼 */
function pagerHtml(route) {
  const { tab, pageNo } = route;
  if (tab.stacked || tab.pages.length <= 1) return '';
  const prev = tab.pages[pageNo - 1];
  const next = tab.pages[pageNo + 1];
  return `<nav class="pager">
    ${prev ? `<a class="pager-btn" href="${tabHref(tab.id, pageNo - 1)}">${icon('prev')}<span><small>이전</small>${esc(prev.title)}</span></a>` : '<span></span>'}
    ${next ? `<a class="pager-btn next" href="${tabHref(tab.id, pageNo + 1)}"><span><small>다음</small>${esc(next.title)}</span>${icon('next')}</a>` : '<span></span>'}
  </nav>`;
}

function pageHtml(page) {
  if (page.missing) return `<p class="empty">파일을 찾을 수 없습니다: ${esc(page.file)}</p>`;
  let html = state.htmlCache.get(page.globalIdx);
  if (html === undefined) {
    html = renderMarkdown(page.body);
    state.htmlCache.set(page.globalIdx, html);
  }
  return html;
}

function pageArticle(page) {
  // 본문 첫 제목이 페이지 제목과 같으면 머리글을 따로 달지 않는다.
  const first = /^#{2,4}\s+(.*)$/m.exec(page.body);
  const showTitle = !first || plainText(first[1]) !== page.title;
  return `<article class="page" id="page-${page.globalIdx}" data-g="${page.globalIdx}">
    ${showTitle ? `<h1 class="page-title">${esc(page.title)}</h1>` : ''}
    <div class="md">${pageHtml(page)}</div>
  </article>`;
}

function onboarding() {
  if (isSite()) {
    return `<section class="card">
      <h2>${state.lastError ? '설정집을 불러오지 못했습니다' : '설정집을 불러오는 중…'}</h2>
      ${state.lastError ? `<p class="error">${esc(state.lastError)}</p><button class="btn primary" id="sync-now">다시 시도</button>` : ''}
    </section>`;
  }
  return `<section class="card onboarding">
    <h2>작가용: 원본 저장소 연결</h2>
    <ol>
      <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
      <li>Repository access: <b>Only select repositories</b> → <code>${esc(state.settings.repo)}</code> 하나만</li>
      <li>Permissions → Repository permissions → <b>Contents: Read-only</b></li>
      <li>만든 토큰을 <a href="#/more">더보기 → 저장소 연결</a>에 붙여 넣고 저장</li>
    </ol>
    <p class="hint">토큰은 이 기기에만 저장되고, 저장소 읽기만 할 수 있습니다.</p>
    <button class="btn" id="use-site">토큰 없이 사이트 공개본 보기</button>
  </section>`;
}

function unlockView() {
  if (state.settings.source === 'full') {
    return `<h1 class="view-title">실명 보기</h1>
    <section class="card">
      <h2>실명 보기가 켜져 있습니다</h2>
      <p class="hint">이 기기는 코드를 기억합니다. 다른 사람에게 폰을 보여 줄 때는 다시 가리세요.</p>
      <button class="btn primary" id="lock-again">다시 가리기</button>
    </section>`;
  }
  return `<h1 class="view-title">실명 보기</h1>
  <section class="card">
    <h2>코드를 입력하세요</h2>
    <p class="hint">코드를 넣으면 가려진 이름(███)이 보입니다.</p>
    <form id="code-form" class="row" autocomplete="off">
      <input class="code-input" name="code" type="password" placeholder="코드" aria-label="코드" required>
      <button class="btn primary" type="submit">열기</button>
    </form>
    ${state.codeError ? `<p class="error">${esc(state.codeError)}</p>` : ''}
  </section>`;
}

function tabView(route) {
  const { tab, pageNo } = route;
  if (!state.snapshot) return onboarding();
  if (!tab.pages.length) return '<p class="empty">이 탭에는 아직 내용이 없습니다.</p>';
  const pages = tab.stacked ? tab.pages : [tab.pages[pageNo]];
  return pages.map(pageArticle).join('') + pagerHtml(route);
}

function todoView() {
  if (!state.snapshot) return onboarding();
  if (!state.todos.length) return '<p class="empty">정할 것이 없습니다.</p>';
  let html = `<h1 class="view-title">정할 것 <small>${state.todos.length}개</small></h1>`;
  let lastTab = null;
  let lastPage = null;
  for (const t of state.todos) {
    if (t.tabId !== lastTab) {
      if (lastPage) html += '</ul></section>';
      html += `<h2 class="group-title">${esc(t.tabTitle)}</h2>`;
      lastTab = t.tabId;
      lastPage = null;
    }
    if (t.page !== lastPage) {
      if (lastPage) html += '</ul></section>';
      html += `<section class="card todo-group"><h3>${esc(t.page.title)}</h3><ul class="link-list">`;
      lastPage = t.page;
    }
    html += `<li><a href="${tabHref(t.tabId, t.pageNo, t.heading)}">
      ${t.headingText ? `<span class="ctx">${esc(t.headingText)}</span>` : ''}<span>${esc(t.text)}</span></a></li>`;
  }
  if (lastPage) html += '</ul></section>';
  return html;
}

function searchView() {
  return `<div class="search-box">
      ${icon('search')}
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="인물·기술·화수 검색" value="${esc(state.searchQuery)}">
    </div>
    <div id="results"></div>`;
}

function highlight(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(re)
    .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join('');
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  const q = state.searchQuery.trim();
  if (!state.snapshot) {
    box.innerHTML = onboarding();
    return;
  }
  if (!q) {
    box.innerHTML = '<p class="empty">검색어를 입력하세요. 여러 단어는 모두 들어간 곳을 찾습니다.</p>';
    return;
  }
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = search(state.searchIndex, q);
  box.innerHTML = results.length
    ? `<p class="hint">${results.length}${results.length >= 120 ? '+' : ''}곳</p><ul class="link-list results">${results
        .map(
          (r) => `<li><a href="${tabHref(r.tabId, r.pageNo, r.heading)}">
            <span class="ctx">${esc(r.tabTitle)} › ${highlight(r.page.title, terms)}${r.headingText ? ` › ${highlight(r.headingText, terms)}` : ''}</span>
            <span>${highlight(r.snippet, terms)}</span></a></li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">찾는 내용이 없습니다.</p>';
}

function changelogHtml() {
  const lines = state.model.changelog
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, ''))
    .reverse();
  if (!lines.length) return '<p class="empty">기록이 없습니다.</p>';
  return `<ul class="changelog">${lines.map((l) => `<li>${esc(plainText(l))}</li>`).join('')}</ul>`;
}

function moreView() {
  const s = state.settings;
  const snap = state.snapshot;
  const opt = (value, current, label) => `<option value="${value}" ${String(value) === String(current) ? 'selected' : ''}>${label}</option>`;
  return `
  <h1 class="view-title">더보기</h1>

  <section class="card">
    <h2>동기화</h2>
    <dl class="kv-list">
      <dt>마지막 갱신</dt><dd>${esc(formatTime(snap?.syncedAt))}</dd>
      <dt>마지막 확인</dt><dd>${esc(formatTime(snap?.checkedAt))}</dd>
      <dt>커밋</dt><dd><code>${esc(snap?.commitSha?.slice(0, 7) || '-')}</code></dd>
      <dt>출처</dt><dd><code>${esc(s.source === 'public' ? '사이트 공개본 (두 이름 가림)' : s.source === 'full' ? '사이트 실명본 (코드)' : s.source === 'local' ? '로컬 폴더 (개발)' : `${s.owner}/${s.repo}@${s.branch}`)}</code></dd>
    </dl>
    ${state.lastError ? `<p class="error">${esc(state.lastError)}</p>` : ''}
    ${snap?.missing?.length ? `<p class="error">index.json 에 있지만 저장소에 없는 파일: ${snap.missing.map(esc).join(', ')}</p>` : ''}
    <button class="btn primary" id="sync-now" ${state.syncing ? 'disabled' : ''}>${state.syncing ? '동기화 중…' : '지금 동기화'}</button>
  </section>

  <section class="card">
    <h2>최근 변경</h2>
    ${changelogHtml()}
  </section>

  <section class="card">
    <h2>보기</h2>
    <label class="field">테마
      <select id="theme">${opt('dark', s.theme, '다크')}${opt('light', s.theme, '라이트')}${opt('system', s.theme, '기기 설정 따르기')}</select>
    </label>
    <label class="field">글자 크기
      <select id="font-scale">${FONT_SCALES.map((f) => opt(f.value, s.fontScale, f.label)).join('')}</select>
    </label>
    <label class="field check"><input type="checkbox" id="share-check" ${s.shareMode ? 'checked' : ''} ${state.model.shareAvailable || s.shareMode ? '' : 'disabled'}>
      공유 모드 (실명 가리기)${state.model.shareAvailable ? '' : ' — 저장소에 share_rules.json 이 없어 쓸 수 없음'}</label>
    <button class="btn" id="print-all" ${snap ? '' : 'disabled'}>전체 인쇄 / PDF 저장</button>
    <p class="hint">인쇄도 공유 모드 설정을 따릅니다. 다른 사람에게 보낼 PDF는 공유 모드를 켜고 만드세요.</p>
  </section>

  ${isSite() ? `<section class="card">
    <h2>작가용</h2>
    <p class="hint">사이트에 올린 설정집을 보고 있습니다. 원본 저장소를 바로 보려면 읽기 전용 토큰으로 연결하세요.</p>
    <button class="btn" id="use-github">원본 저장소 연결</button>
  </section>` : `<section class="card">
    <h2>저장소 연결</h2>
    <form id="repo-form" autocomplete="off">
      ${
        import.meta.env.DEV
          ? `<label class="field">데이터 출처 (개발 서버 전용)
              <select name="source">${opt('github', s.source, 'GitHub 저장소')}${opt('local', s.source, '로컬 godgma-data 폴더')}</select></label>`
          : ''
      }
      <label class="field">소유자 <input name="owner" value="${esc(s.owner)}" required></label>
      <label class="field">저장소 <input name="repo" value="${esc(s.repo)}" required></label>
      <label class="field">브랜치 <input name="branch" value="${esc(s.branch)}" required></label>
      <label class="field">GitHub 토큰 (읽기 전용)
        <input name="token" type="password" placeholder="${s.token ? '저장됨 — 바꾸려면 새로 입력' : 'github_pat_…'}" autocomplete="off" spellcheck="false">
      </label>
      <div class="row">
        <button class="btn primary" type="submit">저장하고 동기화</button>
        <button class="btn" type="button" id="clear-token" ${s.token ? '' : 'disabled'}>토큰 지우기</button>
        <button class="btn" type="button" id="use-site">사이트 공개본으로</button>
      </div>
    </form>
    <p class="hint">토큰은 이 기기 브라우저에만 저장됩니다. <b>Contents: Read-only</b> 권한으로 이 저장소 하나만 허용한 fine-grained 토큰을 쓰세요.</p>
  </section>`}

  <section class="card">
    <h2>기기 데이터</h2>
    <button class="btn danger" id="clear-cache" ${snap ? '' : 'disabled'}>받은 설정 데이터 지우기</button>
    <p class="hint">이 기기에 저장된 사본만 지웁니다. 저장소는 그대로이며, 다시 동기화하면 받아집니다.</p>
    <p class="hint">앱 버전 ${esc(pkg.version)}</p>
  </section>`;
}

// ---------- 렌더링 ----------

function render({ keepScroll = false } = {}) {
  const route = parseRoute();
  const scrollY = window.scrollY;
  let main;
  switch (route.kind) {
    case 'todo':
      main = todoView();
      break;
    case 'search':
      main = searchView();
      break;
    case 'more':
      main = moreView();
      break;
    case 'unlock':
      main = unlockView();
      break;
    case 'tab':
      main = tabView(route);
      break;
    default:
      main = state.snapshot ? '<p class="empty">index.json 에 탭이 없습니다.</p>' : onboarding();
  }
  currentRoute.value = route;
  app.innerHTML = `${topBar()}
    <div class="shell ${railAvailable() && state.settings.railOpen ? 'with-rail' : ''}">${rail(route)}
      <main class="main view-${route.kind}">${main}</main>
    </div>${bottomNav(route)}
    <button class="to-top" id="to-top" aria-label="맨 위로">${icon('up')}</button>`;

  app.querySelectorAll('article.page').forEach((a) => enhance(a, Number(a.dataset.g)));
  bindView(route);
  setupSpy();

  if (route.kind === 'search') {
    renderResults();
    const q = document.getElementById('q');
    if (q && !keepScroll) q.focus();
  }
  if (keepScroll) {
    window.scrollTo(0, scrollY);
    return;
  }
  scrollToRoute(route);
}

function scrollToRoute(route) {
  // 세로 탭은 따로 스크롤되므로 그 안에서만 활성 항목이 보이게 한다.
  revealInRail(document.querySelector('#rail .rail-item.active'));
  if (route.kind !== 'tab') {
    window.scrollTo(0, 0);
    return;
  }
  const page = route.tab.pages[route.pageNo];
  let target = null;
  if (page && route.heading !== null) target = document.getElementById(`p${page.globalIdx}-h${route.heading}`);
  else if (page && route.tab.stacked && route.pageNo > 0) target = document.getElementById(`page-${page.globalIdx}`);
  if (target) {
    target.scrollIntoView({ block: 'start' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1600);
  } else {
    window.scrollTo(0, 0);
  }
}

function revealInRail(el) {
  const box = document.getElementById('rail');
  if (!box || !el) return;
  const top = el.offsetTop - box.offsetTop;
  if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 60) box.scrollTop = top - box.clientHeight / 3;
}

// 스크롤 위치에 맞춰 세로 탭의 '지금 보는 곳'을 표시한다 (주소는 바꾸지 않는다).
let spyObserver = null;
function setupSpy() {
  spyObserver?.disconnect();
  const links = [...document.querySelectorAll('#rail [data-spy]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const byId = new Map(links.map((a) => [a.dataset.spy, a]));
  const visible = new Set();
  spyObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
      const targets = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
      // 화면 위쪽에 가장 가까운(이미 지나온 것 중 마지막) 대상
      let current = null;
      for (const t of targets) if (t.getBoundingClientRect().top <= 140) current = t;
      if (!current) current = targets.find((t) => visible.has(t)) || targets[0];
      links.forEach((a) => a.classList.toggle('current', a.dataset.spy === current?.id));
      revealInRail(byId.get(current?.id));
    },
    { rootMargin: '-120px 0px -55% 0px' },
  );
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) spyObserver.observe(el);
  }
}

window.addEventListener(
  'scroll',
  () => document.getElementById('to-top')?.classList.toggle('show', window.scrollY > 700),
  { passive: true },
);

function refreshStatus() {
  const el = document.getElementById('status');
  if (el) el.textContent = statusText();
  document.getElementById('sync-btn')?.classList.toggle('spin', state.syncing);
}

// ---------- 이벤트 ----------

let searchTimer = 0;

function bindView(route) {
  document.getElementById('code-form')?.addEventListener('submit', openWithCode);
  document.getElementById('lock-again')?.addEventListener('click', () => switchSource({ source: 'public', shareCode: '' }));
  document.getElementById('use-site')?.addEventListener('click', () => switchSource({ source: 'public', shareCode: '' }));
  document.getElementById('use-github')?.addEventListener('click', () => switchSource({ source: 'github', shareCode: '' }, '#/more'));
  if (route.kind !== 'more') document.getElementById('sync-now')?.addEventListener('click', () => doSync({ manual: true }));
  document.getElementById('share-toggle')?.addEventListener('click', toggleShare);
  document.getElementById('sync-btn')?.addEventListener('click', () => doSync({ manual: true }));
  document.getElementById('rail-toggle')?.addEventListener('click', () => {
    updateSettings({ railOpen: !state.settings.railOpen });
    render({ keepScroll: true });
  });
  document.getElementById('to-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  if (route.kind === 'search') {
    document.getElementById('q')?.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderResults, SEARCH_DEBOUNCE_MS);
    });
  }

  if (route.kind === 'more') {
    document.getElementById('sync-now')?.addEventListener('click', () => doSync({ manual: true }));
    document.getElementById('theme')?.addEventListener('change', (e) => {
      updateSettings({ theme: e.target.value });
      applyDisplay();
    });
    document.getElementById('font-scale')?.addEventListener('change', (e) => {
      updateSettings({ fontScale: Number(e.target.value) });
      applyDisplay();
    });
    document.getElementById('share-check')?.addEventListener('change', toggleShare);
    document.getElementById('print-all')?.addEventListener('click', printAll);
    document.getElementById('clear-token')?.addEventListener('click', () => {
      updateSettings({ token: '' });
      toast('토큰을 지웠습니다.');
      render({ keepScroll: true });
    });
    document.getElementById('clear-cache')?.addEventListener('click', clearCache);
    document.getElementById('repo-form')?.addEventListener('submit', saveRepoForm);
  }
}

async function openWithCode(e) {
  e.preventDefault();
  const code = String(new FormData(e.target).get('code') || '').trim();
  if (!code) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = '여는 중…';
  // 코드가 맞는지 먼저 확인하고, 맞을 때만 이 기기에 저장한다.
  try {
    const trial = { ...state.settings, source: 'full', shareCode: code };
    const { snapshot } = await sync(trial, null);
    updateSettings({ source: 'full', shareCode: code, shareMode: false });
    state.codeError = '';
    state.snapshot = snapshot;
    state.lastError = '';
    try {
      await saveSnapshot(snapshot);
    } catch (err) {
      console.warn('[share] 기기에 저장하지 못했다', err);
    }
    rebuild();
    location.hash = '#/';
    render();
  } catch (err) {
    state.codeError = err instanceof SyncError ? err.message : `열지 못했습니다: ${err.message}`;
    if (!(err instanceof SyncError)) console.error('[unlock] 실명본 열기 실패', err);
    render({ keepScroll: true });
  }
}

/** 데이터 출처를 바꾼다. 이전 출처의 사본(특히 실명본)은 기기에서 지운다. */
async function switchSource(patch, hash = '#/') {
  updateSettings(patch);
  try {
    await clearSnapshot();
  } catch (err) {
    console.warn('[cache] 지우지 못했다', err);
  }
  state.snapshot = null;
  state.lastError = '';
  rebuild();
  if (location.hash === hash) render();
  else location.hash = hash;
  if (canSync()) doSync();
}

function toggleShare() {
  if (!state.settings.shareMode && !state.model.shareAvailable) {
    toast(state.snapshot ? '저장소에 share_rules.json 이 없어 공유 모드를 쓸 수 없습니다.' : '먼저 데이터를 동기화하세요.');
    render({ keepScroll: true });
    return;
  }
  updateSettings({ shareMode: !state.settings.shareMode });
  rebuild();
  render({ keepScroll: true });
  if (parseRoute().kind === 'search') renderResults();
  toast(state.settings.shareMode ? '공유 모드: 실명을 가렸습니다.' : '공유 모드를 껐습니다.');
}

function saveRepoForm(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const owner = String(form.get('owner') || '').trim();
  const repo = String(form.get('repo') || '').trim();
  const branch = String(form.get('branch') || '').trim() || DEFAULTS.branch;
  const token = String(form.get('token') || '').trim();
  const source = import.meta.env.DEV ? String(form.get('source') || 'github') : 'github';
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) {
    toast('소유자·저장소 이름에는 영문, 숫자, - _ . 만 쓸 수 있습니다.');
    return;
  }
  if (!BRANCH_PATTERN.test(branch)) {
    toast('브랜치 이름이 올바르지 않습니다.');
    return;
  }
  if (token && /\s/.test(token)) {
    toast('토큰에 공백이 들어 있습니다.');
    return;
  }
  updateSettings({ owner, repo, branch, source, ...(token ? { token } : {}) });
  state.lastError = '';
  render({ keepScroll: true });
  doSync({ manual: true });
}

async function clearCache() {
  if (!confirm('이 기기에 받아 둔 설정 데이터를 지울까요? 저장소의 원본은 그대로입니다.')) return;
  try {
    await clearSnapshot();
  } catch (err) {
    console.warn('[cache] 지우지 못했다', err);
  }
  state.snapshot = null;
  rebuild();
  render();
  toast('기기의 데이터를 지웠습니다.');
}

function printAll() {
  const m = state.model;
  printRoot.innerHTML = `<h1 class="print-doc-title">${esc(m.title)}</h1>${m.tabs
    .map(
      (tab) => `<section class="print-tab"><h1 class="print-tab-title">${esc(tab.title)}</h1>
        ${tab.pages.map((p) => `<article class="page" data-g="${p.globalIdx}"><h1 class="page-title">${esc(p.title)}</h1><div class="md">${pageHtml(p)}</div></article>`).join('')}
      </section>`,
    )
    .join('')}`;
  printRoot.querySelectorAll('article.page').forEach((a) => enhance(a, `x${a.dataset.g}`));
  document.body.classList.add('printing');
  window.print();
}
window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing');
  printRoot.innerHTML = '';
});

// ---------- 동기화 ----------

async function doSync({ manual = false } = {}) {
  if (state.syncing) return;
  state.syncing = true;
  refreshStatus();
  const hadData = Boolean(state.snapshot);
  try {
    const { snapshot, changed } = await sync(state.settings, state.snapshot);
    state.snapshot = snapshot;
    state.lastError = '';
    try {
      await saveSnapshot(snapshot);
    } catch (err) {
      console.warn('[sync] 기기에 저장하지 못했다 (다음 실행 때 다시 받는다)', err);
    }
    if (changed) {
      rebuild();
      state.syncing = false;
      const route = parseRoute();
      if (route.kind === 'search') {
        refreshStatus();
        renderResults();
      } else {
        render({ keepScroll: hadData });
      }
      if (hadData || manual) toast('최신 내용으로 갱신했습니다.');
    } else if (manual) {
      toast('이미 최신입니다.');
    }
  } catch (err) {
    state.lastError = err instanceof SyncError ? err.message : `동기화 실패: ${err.message}`;
    if (!(err instanceof SyncError)) console.error('[sync] 예상하지 못한 오류', err);
    if (manual || !hadData) toast(state.lastError);
    if (!hadData || parseRoute().kind === 'more') {
      state.syncing = false;
      render({ keepScroll: true });
    }
  } finally {
    state.syncing = false;
    refreshStatus();
  }
}

function canSync() {
  const s = state.settings;
  return (
    s.source === 'local' || s.source === 'public' || (s.source === 'full' && Boolean(s.shareCode)) || (s.source === 'github' && Boolean(s.token))
  );
}

function maybeAutoSync() {
  if (!navigator.onLine) return;
  if (!canSync()) return;
  const last = state.snapshot?.checkedAt || 0;
  if (Date.now() - last >= AUTO_CHECK_INTERVAL_MS || state.snapshot?.sourceKey !== sourceKey(state.settings)) {
    doSync();
  }
}

// ---------- 시작 ----------

async function start() {
  applyDisplay();
  render();
  state.snapshot = await loadSnapshot();
  rebuild();
  render();
  window.addEventListener('hashchange', () => render());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && maybeAutoSync());
  window.addEventListener('online', maybeAutoSync);
  // 앱을 열 때는 최신 커밋을 항상 확인한다 (바뀌지 않았으면 sha 하나만 받는다).
  if (navigator.onLine && canSync()) doSync();

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    import('virtual:pwa-register')
      .then(({ registerSW }) => registerSW({ immediate: true }))
      .catch((err) => console.warn('[pwa] 서비스 워커 등록 실패', err));
  }
}

start().catch((err) => {
  console.error('[app] 시작 실패', err);
  app.innerHTML = `<p class="error">앱을 시작하지 못했습니다: ${esc(err.message)}</p>`;
});
