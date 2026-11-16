// AI (Gemini) — 작가·주인만 쓴다.
// 키는 주인이 앱에서 넣고 Firestore(secrets/app)에 저장된다. 코드·저장소에는 넣지 않는다.
// 설정집 내용은 항상 이름을 가린 상태로만 보낸다 (실명은 Google 로 보내지 않는다).
import { HEADING_LINE, plainText } from './model.js';

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (싸고 빠름)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (더 똑똑함, 더 비쌈)' },
];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const CONTEXT_BUDGET = 60000; // 한 번에 보내는 설정집 글자 수 상한 (비용 조절)
const ALWAYS_TABS = ['world', 'chars']; // 질문과 상관없이 늘 넣는 탭 (작아서)

export const MODES = {
  ask: {
    label: '설정집 질문',
    placeholder: '예: 서민찬의 시간과 정신의 방 설정이 뭐였지?',
    system: `너는 웹소설 「그마 세계관」 설정집의 사서다. 아래 [설정집 발췌]만 근거로 한국어로 답한다.
- 발췌에 없는 내용은 지어내지 말고 "설정집에서 찾지 못했어요"라고 말한다.
- 근거가 된 곳(탭 › 문서 › 제목)을 답 끝에 짧게 적는다.
- ███ 로 가려진 이름은 그대로 ███ 로 쓴다. 가려진 이름을 추측하지 않는다.`,
  },
  write: {
    label: '집필 보조',
    placeholder: '예: 1부 105화 「알현」 초안을 써 줘 / 이 문단을 다듬어 줘 / 설정 충돌을 찾아 줘',
    system: `너는 웹소설 「그마 세계관」의 집필 보조다. 아래 [설정집 발췌]와 기존 문체에 맞춰 한국어로 돕는다.
- 짧은 문장, 행갈이가 잦은 기존 문체를 따른다. 기술명은 「」로 감싼다.
- 설정과 어긋나는 부분이 있으면 먼저 짚는다.
- 성적인 묘사·성적인 농담은 쓰지 않는다. 미성년 시점 인물의 연애는 마음·말·질투 수준까지만 쓴다.
- 작가가 정하지 않은 내용을 새로 지어냈다면 그 부분에 (제안 초안)이라고 표시한다.
- ███ 로 가려진 이름은 그대로 ███ 로 쓴다.`,
  },
  add: {
    label: '설정 추가',
    placeholder: '예: 서민찬 문서에 "좋아하는 음식: 국수" 추가해 줘 / 요람 문서의 미정 항목을 채워 줘',
    json: true,
    system: `너는 웹소설 「그마 세계관」 설정집의 편집자다. 작가가 말한 내용을 설정집 Markdown 문서에 넣을 수정안으로 만든다.
반드시 아래 JSON 하나로만 답한다. 다른 글은 쓰지 않는다.
{"summary": "무엇을 어디에 넣는지 한두 문장", "changes": [{"page": 문서 번호(정수), "heading": "넣을 자리의 제목(## 또는 ### 뒤 글자 그대로, 문서 끝이면 빈 문자열)", "replaceTodo": "채울 미정 줄 원문(- [ ] 로 시작하는 줄 그대로, 없으면 빈 문자열)", "content": "넣을 Markdown"}], "changelog": "CHANGELOG 한 줄 요약(날짜 빼고)"}
규칙:
- page 는 [문서 목록]의 번호만 쓴다. 없는 문서는 만들지 않는다.
- 기존 문체를 따른다: 표는 | **항목** | 내용 | 형식, 기술명은 「」, 미정은 - [ ] 또는 ☐.
- 작가가 직접 말하지 않은 내용을 지어 넣었다면 그 줄 끝에 (제안 초안)을 붙인다.
- ███ 로 가려진 이름은 그대로 ███ 로 쓴다. 추측하지 않는다.
- 성적인 묘사·성적인 농담은 넣지 않는다.
- 넣을 게 없거나 요청이 불분명하면 changes 를 빈 배열로 두고 summary 에 무엇을 더 알려 줘야 하는지 쓴다.`,
  },
};

/** 설정 추가용: 문서 목록 (번호 = globalIdx) */
export function pageCatalog(model) {
  const lines = [];
  for (const tab of model.tabs) for (const p of tab.pages) lines.push(`${p.globalIdx}. ${tab.title} › ${p.title}`);
  return lines.join('\n');
}

/** 모델(가린 상태)에서 제목 단위 덩어리를 만든다 */
function chunksOf(model) {
  const out = [];
  for (const tab of model.tabs) {
    for (const page of tab.pages) {
      let cur = { tab, page, head: '', text: '' };
      out.push(cur);
      for (const line of page.body.split(/\r?\n/)) {
        const h = HEADING_LINE.exec(line);
        if (h) {
          cur = { tab, page, head: plainText(h[2]), text: '' };
          out.push(cur);
        }
        cur.text += line + '\n';
      }
    }
  }
  return out.filter((c) => c.text.trim());
}

// 질문에서 검색어를 뽑는다. 한국어 조사를 떼기 어려워서 앞 2~3글자도 함께 쓴다.
function termsOf(q) {
  const words = q
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const set = new Set();
  for (const w of words) {
    set.add(w.toLowerCase());
    if (w.length > 3) set.add(w.slice(0, 3).toLowerCase());
    if (w.length > 2) set.add(w.slice(0, 2).toLowerCase());
  }
  return [...set];
}

/** 질문과 관련 있는 설정집 부분을 글자 수 상한 안에서 고른다 */
export function buildContext(model, question, { extra = '' } = {}) {
  const chunks = chunksOf(model);
  const label = (c) => `### ${c.tab.title} › ${c.page.title}${c.head && c.head !== c.page.title ? ` › ${c.head}` : ''}`;
  const picked = [];
  let used = 0;
  const take = (c) => {
    const block = `${label(c)}\n${c.text.trim()}\n`;
    if (used + block.length > CONTEXT_BUDGET) return false;
    picked.push(block);
    used += block.length;
    return true;
  };
  for (const c of chunks) if (ALWAYS_TABS.includes(c.tab.id)) take(c);

  const terms = termsOf(question + ' ' + extra.slice(0, 200));
  const scored = chunks
    .filter((c) => !ALWAYS_TABS.includes(c.tab.id))
    .map((c) => {
      const hay = `${c.page.title} ${c.head} ${c.text}`.toLowerCase();
      // 서로 다른 검색어가 많이 들어 있을수록, 긴 검색어일수록 점수가 높다
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += t.length * t.length;
      if (score && (c.head + c.page.title).toLowerCase().includes(terms[0] || '\u0000')) score *= 2;
      if (c.tab.id === 'story') score *= 1.5; // 스토리 표를 본문보다 먼저
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { c } of scored) if (!take(c)) break;
  return picked.join('\n');
}

/**
 * history: [{ role: 'user' | 'model', text }] (이전 대화, 짧게). 마지막 질문에만 설정집 발췌를 붙인다.
 */
export async function askGemini({ key, model, mode, question, context, catalog = '', history = [] }) {
  if (!key) throw new Error('Gemini 키가 설정되지 않았습니다. 주인이 더보기 → 계정에서 넣어야 합니다.');
  const m = MODES[mode] || MODES.ask;
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: m.system }] },
      contents: [
        ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        {
          role: 'user',
          parts: [{ text: `${catalog ? `[문서 목록]\n${catalog}\n\n` : ''}[설정집 발췌]\n${context}\n\n[요청]\n${question}` }],
        },
      ],
      generationConfig: {
        temperature: mode === 'write' ? 0.9 : 0.2,
        ...(m.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문이 JSON 이 아님 */
  }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Gemini 키가 올바르지 않습니다.');
    if (res.status === 429) throw new Error('Gemini 사용 한도를 넘었습니다. 잠시 뒤 다시 해 보세요.');
    if (res.status === 404) throw new Error(`모델을 찾지 못했습니다(${model}). 더보기 → 계정에서 모델을 바꿔 보세요.`);
    throw new Error(`Gemini 오류: ${msg}`);
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    const why = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(`답을 받지 못했습니다${why ? ` (${why})` : ''}.`);
  }
  return text;
}
