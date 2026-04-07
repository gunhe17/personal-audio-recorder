# Recorder UI Design System

## 1. 목적

이 문서는 `personal-audio-recorder`의 현재 UI 디자인 시스템 기준을 정의한다.

현재 기준 화면은 [web/session.html](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/session.html) 이다.
즉, 디자인 시스템은 더 이상 별도 playground나 랜딩 페이지를 기준으로 하지 않고, 실제 세션 작업 화면을 기준으로 관리한다.

목표는 아래 세 가지다.

1. 레코더 UI를 일관된 시각 언어로 고정한다.
2. 공통 토큰과 재사용 컴포넌트를 [web/design-system.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/design-system.css) 에서 관리한다.
3. 세션 페이지 특화 레이아웃과 오버라이드는 [web/app.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/app.css) 에서 확장한다.

## 2. 현재 방향

키워드:

- VS Code dark workbench
- compact editor chrome
- muted slate surfaces
- white-on-dark text hierarchy
- restrained blue accent
- dense audio workspace

피해야 할 방향:

- graphite transport bar 중심의 오디오 콘솔 복제
- green accent를 전역 포인트로 쓰는 구성
- generic SaaS dashboard
- 밝은 카드가 화면 대부분을 차지하는 레이아웃
- 과한 glow, glassmorphism, neon

시각 원칙:

- 바깥 배경은 VS Code workbench처럼 어두운 중성색으로 둔다.
- 실제 작업면은 같은 dark 계열의 surface를 layer만 달리해 구분한다.
- 좌측 채널 정보 패널과 우측 트랙 캔버스는 톤 차이로만 분리하고, 강한 카드화는 피한다.
- 파란색은 선택, 포커스, playhead, region, active interaction에만 사용한다.
- 빨간색은 destructive 또는 critical 상태에서만 사용한다.
- 기본 컴포넌트는 둥글기보다 각진 데스크톱 앱 톤을 따른다.
- 텍스트는 `#cccccc` 수준의 low-contrast bright gray를 기본으로 한다.
- 상태 전달은 색 하나보다 border, fill, text contrast까지 함께 사용한다.

## 3. 토큰

## 3.1 색상

### Workbench

- `--bg-canvas`: `#1b1b1c`
- `--bg-canvas-deep`: `#181818`
- `--bg-panel`: `#1e1e1e`
- `--bg-panel-strong`: `#252526`
- `--bg-elevated`: `#2d2d30`
- `--bg-muted`: `rgba(255, 255, 255, 0.03)`

### Border

- `--border-soft`: `rgba(255, 255, 255, 0.08)`
- `--border-strong`: `rgba(255, 255, 255, 0.14)`

### Text

- `--text-strong`: `#cccccc`
- `--text-muted`: `#9da1a6`
- `--text-inverse`: `#ffffff`

### Accent

- `--signal-blue`: `#3794ff`
- `--signal-blue-strong`: `#0e639c`
- `--signal-red`: `#f14c4c`
- `--signal-amber`: `#cca700`
- `--signal-green`: `#89d185`
- `--signal-cyan`: compatibility alias, 현재는 blue 계열로 취급

### Meter

- `--meter-safe`: `#89d185`
- `--meter-mid`: `#d7ba7d`
- `--meter-hot`: `#d19a66`
- `--meter-clip`: `#f14c4c`

### Region

- region 기본 tone은 `blue-700 ~ blue-600`
- waveform highlight는 `rgba(220, 235, 255, ...)`
- empty audio display는 더 낮은 대비의 blue wash를 사용한다

## 3.2 타이포그래피

- Display: `"SF Pro Text", "Segoe UI", "Helvetica Neue", sans-serif`
- UI text: `"SF Pro Text", "Segoe UI", "Helvetica Neue", sans-serif`
- Mono: `"SFMono-Regular", "Cascadia Mono", "Menlo", "Monaco", monospace`

규칙:

- 현재 기준 화면은 display용 장식 서체를 사용하지 않는다.
- 대부분의 UI 텍스트는 UI text 폰트 한 계열로 통일한다.
- ruler 값, time 값, channel number 같은 숫자는 mono를 사용해도 된다.
- 제목보다 작업면 라벨과 값의 정렬 우선순위가 높다.
- 라벨은 `11px ~ 12px`, 입력 값은 `12px ~ 13px`, 상태 pill은 `11px ~ 12px` 범위를 기본으로 둔다.

## 3.3 반경

- `--radius-xs`: `1px`
- `--radius-sm`: `2px`
- `--radius-md`: `4px`
- `--radius-lg`: `6px`
- `--radius-pill`: `999px`

규칙:

- 입력, 버튼, dropdown, divider는 가능한 한 작은 반경을 사용한다.
- 원형 버튼이나 pill만 예외적으로 큰 반경을 허용한다.

## 3.4 간격

- `--space-1`: `4px`
- `--space-2`: `8px`
- `--space-3`: `12px`
- `--space-4`: `16px`
- `--space-5`: `24px`
- `--space-6`: `32px`

밀도 규칙:

- control height는 `30px ~ 34px`를 기본으로 둔다.
- header / chrome bar는 `28px`, `52px` 계열을 기준으로 둔다.
- row 내부 패딩은 `7px ~ 10px` 수준을 기본으로 둔다.

## 3.5 그림자

- `--shadow-soft`: 얕은 surface separation
- `--shadow-panel`: dark workbench 위 panel 분리
- `--shadow-focus`: blue accent focus ring

현재 기준:

- glow보다 1px border와 작은 inset shadow가 우선이다.

## 4. 레이아웃 시스템

## 4.1 Workbench Shell

- `session-page`: 브라우저 viewport를 고정하는 최상위 page
- `logic-screen--session`: 세션 작업면 루트
- `logic-windowbar`: 상단 transport 포함 chrome bar
- `logic-main--session`: 세션 본문

## 4.2 Arrange Workspace

- `logic-arrange`: 트랙 작업면 wrapper
- `logic-arrange__top`: corner + splitter + ruler
- `logic-arrange__body`: track headers + splitter + lanes
- `logic-arrange__corner`: 좌측 상단 빈 chrome 영역
- `logic-ruler`: 시간 눈금
- `logic-track-headers`: 채널 정보 영역
- `logic-track-lanes`: region 캔버스

## 4.3 Split Layout

- 좌측: editable channel metadata
- 중앙 splitter: draggable vertical divider
- 우측: recorded region / empty audio display

규칙:

- splitter는 항상 같은 폭 변수로 top/body를 동시에 움직인다.
- 브라우저 전체 스크롤은 없애고, 세션 화면은 viewport 안에 고정한다.

## 5. 상태 언어

현재 세션 화면 기준 주요 상태는 아래 두 계층으로 나뉜다.

1. Interaction accent
- focus
- selected dropdown option
- active resize divider
- playhead
- audio region

2. Semantic state
- recording
- warning
- error
- success

상태 색 규칙:

- interaction accent는 blue
- error는 red
- warning은 amber
- success는 green을 쓸 수 있지만, 현재 세션 화면의 기본 accent는 blue다

호환 규칙:

- 기존 class 이름 `is-cyan`은 blue accent로 렌더링한다.
- green은 더 이상 기본 accent가 아니다.

## 6. 핵심 컴포넌트

## 6.1 Transport

### `logic-transport`

세션 상단 중앙 transport 그룹.

구성:

- `logic-transport__buttons`
- `logic-transport-btn`
- `logic-shape--record`
- `logic-shape--stop`

규칙:

- record는 blue filled button
- stop은 neutral dark button
- transport cluster 자체는 panel 안의 작은 묶음처럼 보여야 한다

## 6.2 Resize Divider

### `logic-sidebar-resizer`

채널 정보 패널과 트랙 캔버스 사이 세로 divider.

구성:

- base bar
- center guide
- grip dots

규칙:

- 기본 상태에서 파란 가이드선은 드러나지 않는다
- hover / focus / drag에서 bar tone만 살짝 밝아진다
- top/body divider는 시각적으로 같은 컴포넌트여야 한다

## 6.3 Input Components

### `dropdown-select`

현재 세션 화면에서는 input index selector로 사용한다.

구성:

- `dropdown-select`
- `dropdown-select__trigger`
- `dropdown-select__value`
- `dropdown-select__chevron`
- `dropdown-select__menu`
- `dropdown-select__option`

규칙:

- trigger는 dark input surface
- menu는 workbench보다 한 단계 높은 surface
- selected option은 blue wash
- 현재는 mock option을 사용하지만, 실제 구현에서는 device input list를 바인딩한다

### `inline-edit`

현재 세션 화면에서는 channel name editor로 사용한다.

구성:

- display mode button
- text input edit mode

규칙:

- 기본은 value display
- value click 시 edit mode로 전환
- blur 또는 `Enter`에서 commit
- `Escape`에서 cancel

## 6.4 Track Header Row

### `logic-track-header--session`

좌측 채널 정보 패널 한 행.

필드:

- input index selector
- channel name editor

규칙:

- key-value 라벨보다 editable value 중심 구조를 쓴다
- row 높이는 lane 높이와 맞춘다
- panel tone은 lane보다 한 단계 밝아야 한다

## 6.5 Track Lane

### `logic-track-lane--session`

우측 오디오 작업면의 한 행.

구성:

- lane grid
- region block 또는 empty audio display

### `logic-region--display`

기록된 오디오 segment 표시.

규칙:

- blue 계열 fill
- waveform은 밝은 저대비 패턴
- 텍스트보다 shape가 먼저 읽혀야 한다

### `logic-audio-display`

아직 녹음 데이터가 없는 lane의 placeholder.

규칙:

- region보다 낮은 대비
- empty 상태여도 작업면 톤을 깨지 않아야 한다

## 6.6 Secondary Components

### `button`

공통 액션 버튼.

변형:

- `button--primary`
- `button--secondary`
- `button--ghost`
- `button--danger`
- `button--quiet`

현재 기준:

- primary는 blue
- secondary / quiet는 dark neutral

### `status-pill`

짧은 상태 라벨.

현재 기준:

- neutral, blue, amber, red, green variation을 허용한다
- pill은 보조 컴포넌트이며 화면 전역 포인트를 가져가면 안 된다

### `alert-banner`

경고/오류/안내용 배너.

현재 기준:

- dark surface 위에서만 사용
- blue info, amber warning, red critical, green success를 허용한다

## 7. 상호작용 규칙

- 세션 페이지는 브라우저 스크롤 없이 viewport 안에서 동작한다.
- splitter drag는 top/body divider를 동시에 이동시킨다.
- splitter width는 저장해도 되지만, UI는 저장 여부와 무관하게 즉시 반응해야 한다.
- dropdown은 keyboard `Escape`로 닫혀야 한다.
- name inline edit는 click-to-edit 패턴을 따른다.
- 포커스 표현은 blue border + small ring으로 통일한다.
- hover는 강한 glow보다 톤 변화 위주로 표현한다.

## 8. 구현 규칙

- 공통 토큰과 범용 컴포넌트는 [web/design-system.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/design-system.css) 에 둔다.
- 세션 페이지 전용 레이아웃과 특수 오버라이드는 [web/app.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/app.css) 에 둔다.
- 새로운 페이지를 추가하더라도 기본 surface / border / accent는 이 문서의 workbench palette를 따른다.
- green-first, bright-dashboard, serif-display 방향으로 되돌아가지 않는다.

## 9. 현재 산출물

- [design-system.md](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/design-system.md)
- [web/design-system.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/design-system.css)
- [web/session.html](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/session.html)
- [web/app.css](/Users/gunhee/workspace/codespace/project/personal-audio-recorder/web/app.css)
