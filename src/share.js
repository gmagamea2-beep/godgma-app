// 공유 모드: 실존 인물 이름을 가린다.
// 규칙(가릴 이름)은 앱 코드가 아니라 비공개 데이터 저장소의 share_rules.json 에 있다.
// 앱 코드는 공개될 수 있으므로 여기에 이름을 적지 않는다.
//
// share_rules.json 형식:
// {
//   "replace": [["찾을 문자열", "바꿀 문자열"], ...],              // 위에서부터 순서대로 적용
//   "regex":   [{"pattern": "...", "flags": "gi", "replace": "..."}],
//   "check":   ["가린 뒤 남아 있으면 안 되는 문자열", ...]
// }

/**
 * @returns {{ mask: (s: string) => string, leftovers: (s: string) => string[] } | null}
 */
export function createMasker(rulesText) {
  if (!rulesText) return null;
  let rules;
  try {
    rules = JSON.parse(rulesText);
  } catch (e) {
    console.warn('[share] share_rules.json 형식이 잘못되었다', e);
    return null;
  }
  const replace = (Array.isArray(rules.replace) ? rules.replace : []).filter(
    (r) => Array.isArray(r) && typeof r[0] === 'string' && r[0] && typeof r[1] === 'string',
  );
  const regex = [];
  for (const r of Array.isArray(rules.regex) ? rules.regex : []) {
    try {
      const flags = String(r.flags || 'g');
      regex.push([new RegExp(r.pattern, flags.includes('g') ? flags : flags + 'g'), String(r.replace ?? '')]);
    } catch (e) {
      console.warn('[share] 잘못된 정규식 규칙을 건너뛴다', r, e);
    }
  }
  const check = (Array.isArray(rules.check) ? rules.check : []).filter((c) => typeof c === 'string' && c);
  if (!replace.length && !regex.length) return null;

  const mask = (s) => {
    let t = s;
    for (const [from, to] of replace) t = t.split(from).join(to);
    for (const [re, to] of regex) t = t.replace(re, to);
    return t;
  };
  const leftovers = (s) => {
    const lower = s.toLowerCase();
    return check.filter((c) => lower.includes(c.toLowerCase()));
  };
  return { mask, leftovers };
}
