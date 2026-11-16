// AI "설정 추가" 수정안을 원본 저장소(godgma-data)에 커밋한다.
// 쓰기 토큰은 이 기기의 localStorage(settings.writeToken)에만 있다. 코드·저장소·Firestore 에 넣지 않는다.

const API = 'https://api.github.com';

const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function headers(token) {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
}

function filePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function ghError(res, what) {
  let msg = '';
  try {
    msg = (await res.json()).message || '';
  } catch {
    /* 무시 */
  }
  if (res.status === 401) return new Error('쓰기 토큰이 올바르지 않거나 만료되었습니다.');
  if (res.status === 403 || res.status === 404) return new Error(`${what}: 권한이 없습니다. 토큰에 godgma-data 의 Contents 읽기·쓰기 권한이 있는지 확인하세요.`);
  if (res.status === 409) return new Error(`${what}: 그사이 파일이 바뀌었습니다. 다시 시도하세요.`);
  return new Error(`${what}: ${msg || `HTTP ${res.status}`}`);
}

export async function readFile(s, token, path) {
  const res = await fetch(`${API}/repos/${s.owner}/${s.repo}/contents/${filePath(path)}?ref=${encodeURIComponent(s.branch)}`, {
    headers: headers(token),
    cache: 'no-store',
  });
  if (!res.ok) throw await ghError(res, `${path} 읽기`);
  const data = await res.json();
  return { text: b64decode(data.content || ''), sha: data.sha };
}

export async function writeFile(s, token, path, text, sha, message) {
  const res = await fetch(`${API}/repos/${s.owner}/${s.repo}/contents/${filePath(path)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64encode(text), sha, branch: s.branch }),
  });
  if (!res.ok) throw await ghError(res, `${path} 저장`);
  return (await res.json()).commit?.sha || '';
}

const HEADING = /^(#{2,4})\s+(.*?)\s*$/;
const norm = (t) => t.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * 원본 문서에 수정 하나를 넣는다.
 * AI 는 이름을 가린 글을 보고 답하므로, 원본 줄도 mask() 로 가린 뒤 비교한다.
 * @returns {{ text: string, where: string }}
 */
export function applyChange(original, change, mask = (t) => t) {
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const content = String(change.content || '').replace(/\r\n/g, '\n').trim();
  if (!content) throw new Error('넣을 내용이 비어 있습니다.');

  const todo = norm(String(change.replaceTodo || ''));
  if (todo) {
    const i = lines.findIndex((l) => norm(mask(l)) === todo || norm(l) === todo);
    if (i >= 0) {
      lines.splice(i, 1, ...content.split('\n'));
      return { text: lines.join('\n'), where: '미정 줄을 채움' };
    }
  }

  const head = norm(String(change.heading || '').replace(/^#+\s*/, ''));
  if (head) {
    const i = lines.findIndex((l) => {
      const m = HEADING.exec(l);
      return m && (norm(mask(m[2])) === head || norm(m[2]) === head);
    });
    if (i >= 0) {
      const level = HEADING.exec(lines[i])[1].length;
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const m = HEADING.exec(lines[j]);
        if (m && m[1].length <= level) {
          end = j;
          break;
        }
      }
      while (end > i + 1 && !lines[end - 1].trim()) end--;
      lines.splice(end, 0, '', ...content.split('\n'));
      return { text: lines.join('\n'), where: `「${change.heading}」 아래` };
    }
  }

  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push('', ...content.split('\n'), '');
  return { text: lines.join('\n'), where: head || todo ? '문서 끝 (제목·미정 줄을 찾지 못함)' : '문서 끝' };
}
