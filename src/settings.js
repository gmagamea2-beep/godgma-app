// 기기별 설정. GitHub 토큰도 여기(이 기기의 localStorage)에만 저장한다. 코드·저장소에는 넣지 않는다.
const KEY = 'godgma.settings.v1';

export const DEFAULTS = Object.freeze({
  owner: 'gmagamea2-beep',
  repo: 'godgma-data',
  branch: 'main',
  token: '',
  // 'public'(사이트 공개본, 두 이름 가림) | 'full'(코드로 연 실명본) | 'github'(작가용 원본 저장소) | 'local'(개발 서버 전용)
  source: 'public',
  shareCode: '',
  theme: 'dark', // 'dark' | 'light' | 'system'
  fontScale: 1, // 1 | 1.125 | 1.25
  shareMode: false,
  railOpen: true, // 왼쪽 세로 탭(목차) 펼침
});

export const FONT_SCALES = [
  { value: 1, label: '보통' },
  { value: 1.125, label: '크게' },
  { value: 1.25, label: '아주 크게' },
];

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s = { ...DEFAULTS, ...saved };
    if (!FONT_SCALES.some((f) => f.value === s.fontScale)) s.fontScale = DEFAULTS.fontScale;
    if (!['dark', 'light', 'system'].includes(s.theme)) s.theme = DEFAULTS.theme;
    if (s.source === 'local' && !import.meta.env.DEV) s.source = 'github';
    if (!['public', 'full', 'github', 'local'].includes(s.source)) s.source = 'public';
    if (s.source === 'full' && !s.shareCode) s.source = 'public';
    return s;
  } catch (e) {
    console.warn('[settings] 저장된 설정을 읽지 못해 기본값을 쓴다', e);
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.warn('[settings] 설정을 저장하지 못했다', e);
    return false;
  }
}

/** 캐시가 어느 저장소의 것인지 구분하는 키. 저장소를 바꾸면 캐시를 새로 받는다. */
export function sourceKey(s) {
  if (s.source === 'public' || s.source === 'full') return s.source;
  return s.source === 'local' ? 'local' : `github:${s.owner}/${s.repo}@${s.branch}`;
}
