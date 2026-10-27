# 스타터 모드 (템플릿)

외부 모드의 최소 예제. 복사해서 시작한다. 자세한 규칙은 저장소의 `MODES.md`, 타입은 `types/ctx.d.ts`·`types/state.d.ts`·`types/trace.d.ts`.

1. 이 폴더를 복사하고 **폴더 이름 = `mode.json`의 `id`**로 바꾼다 (예: `my-mode`). `mode.js`의 `registerMode({ id })`도 같게.
2. 사용자 모드 폴더(기본 `~/.claude/waiting-room/modes/`, 서버 환경변수 `WAITING_ROOM_MODES`)에 넣는다.
3. 설정(쉼표 키 또는 전환기의 ⚙️ 설정…) → 모드 → [다시 찾기] → 권한을 확인하고 켠다.
4. 개발 중에는 `bun tools/dev.ts`로 열면 저장할 때마다 자동으로 새로고침된다.

이 모드는 샌드박스에서 돈다: `fetch`·외부 이미지·`window.open`·부모 문서·`localStorage`는 막혀 있다. 저장은 `ctx.store`, 메모는 `ctx.memo`(needs `memo`), 흐름 기록은 `ctx.api.trace`(needs `trace`).
