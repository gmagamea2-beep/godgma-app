# 설정집 뷰어 PWA (Claude Code용)

비공개 GitHub 저장소(`godgma-data`)의 Markdown 설정 데이터를 읽어 폰에서 보여 주는 PWA.
이 폴더는 **공개될 수 있는 앱 코드만** 담는다. 데이터·실명은 절대 넣지 않는다.

## 환경

| 항목 | 값 |
|---|---|
| 빌드 | Vite 8.3.5 + 바닐라 JS (ES 모듈) |
| PWA | vite-plugin-pwa 2.0.0 (generateSW, autoUpdate) |
| 의존성 | marked 18.1.1 (Markdown), dompurify 3.4.17 (HTML 정화) |
| Node | 24 (npm 11) |
| 명령 | `npm install` / `npm run dev` / `npm run build` → `dist/` / `npm run preview` |
| 아이콘 | `python tools/make_icons.py` → `public/icons/` (표준 라이브러리만 사용) |

## 구조

```
index.html
vite.config.js      개발 서버 전용 로컬 데이터 미들웨어(/__local-data) + PWA 설정
src/main.js         화면·라우팅·이벤트·동기화 흐름
src/sync.js         GitHub API(커밋 sha → 트리 → 바뀐 blob 만) / 개발용 로컬 폴더
src/db.js           IndexedDB 스냅샷 (오프라인 표시)
src/settings.js     기기별 설정(localStorage, 토큰 포함)
src/model.js        스냅샷 → 화면 모델, frontmatter, 공유 모드 적용
src/share.js        공유 모드 가리기 (규칙은 데이터 저장소의 share_rules.json)
src/markdown.js     marked + DOMPurify, 한국어 굵게/기울임 보정, 물결표 취소선 방지
src/search.js       전체 검색, "정할 것" 모으기
src/style.css       다크/라이트 테마, 인쇄용 CSS
```

## 지킬 것

- **실명을 코드에 쓰지 않는다.** 가릴 이름 목록은 비공개 데이터 저장소의 `share_rules.json` 에만 둔다.
  빌드 후 `dist/` 에 이름이 없는지 확인한다.
- 토큰은 기기의 localStorage 에만 저장한다. 코드·저장소·URL 에 넣지 않는다.
- 해시 경로에는 탭 id 와 순번만 쓴다 (페이지 id·파일 이름에 실명이 들어 있을 수 있다).
- GitHub API 응답은 서비스 워커로 캐시하지 않는다 (데이터는 IndexedDB 에만).
- 데이터 형식(frontmatter, `- [ ]`, `☐`, `> ※`)은 `godgma-data/CLAUDE.md` 와 맞춘다.

## 개발 중 로컬 데이터로 보기

`npm run dev` 후 더보기 → 저장소 연결 → 데이터 출처를 "로컬 godgma-data 폴더"로 바꾼다.
기본 경로는 `../../godgma-data`, 다른 곳이면 환경 변수 `GODGMA_DATA_DIR`. 빌드 결과물에는 이 기능이 없다.
