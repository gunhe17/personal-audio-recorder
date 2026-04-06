# Recorder UI Design System

## 1. 목적

이 문서는 `personal-audio-recorder`의 UI 디자인 시스템을 정의한다.

목표는 아래 세 가지다.

1. 라이브 오디오 레코딩 도메인에 맞는 명확한 시각 언어를 만든다.
2. 이후 실제 앱 구현에서 재사용할 수 있는 컴포넌트 계약을 고정한다.
3. `web/playground.html`에서 모든 핵심 컴포넌트와 상태를 한 번에 검토할 수 있게 한다.

## 2. 디자인 방향

키워드:

- graphite transport bar
- compact arrange lanes
- dense utility surfaces
- restrained digital telemetry
- blue audio regions

피해야 할 방향:

- generic SaaS dashboard
- 밝은 카드가 화면 대부분을 차지하는 구성
- 과한 글래스모피즘
- 게임 UI 같은 과도한 네온

시각 원칙:

- 기본 배경은 어두운 graphite 계열로 둔다.
- 주요 작업면은 비슷한 명도의 패널을 얇은 경계선으로만 구분한다.
- 상단 transport/control bar와 중앙 작업면이 시선의 우선순위를 가져야 한다.
- 좌우 보조 정보는 필요할 때만 열리는 inspector/mixer 성격으로 읽혀야 한다.
- 포인트 컬러는 green 하나만 사용하고, 선택, 활성, 준비 상태를 모두 green 계열로 통일한다.
- arrange 영역의 region block은 blue 계열을 기본으로 사용하고, mixer/meter는 green 계열을 사용한다.
- 신호 상태는 색으로만 전달하지 않고 라벨과 shape를 함께 사용한다.
- meter, badge, strip 같은 실시간 정보는 즉시 스캔 가능해야 한다.
- form과 리스트는 장식보다 정밀한 정렬과 빠른 판독성을 우선한다.
- 버튼, 입력, pills는 웹앱보다 데스크톱 오디오 툴에 가깝게 더 낮고 더 촘촘해야 한다.

## 3. 토큰

## 3.1 색상

### Base

- `--bg-canvas`: 전체 배경
- `--bg-panel`: 기본 작업 패널
- `--bg-panel-strong`: 어두운 제어 패널
- `--bg-elevated`: 위로 떠 있는 보조 카드
- `--border-soft`: 약한 경계선
- `--border-strong`: 강한 경계선
- `--text-strong`: 본문 강조
- `--text-muted`: 보조 텍스트

### Signal

- `--signal-red`: stop, drop, critical
- `--signal-amber`: warning, retention, pending
- `--signal-green`: selected, active, healthy, ready
- `--signal-cyan`: legacy compatibility alias, 시각적으로는 green과 동일하게 처리

### Meter

- `--meter-safe`
- `--meter-mid`
- `--meter-hot`
- `--meter-clip`

### Arrange

- clip blue family: audio region 기본색
- clip cyan family: selected or brighter vocal region
- chrome gray family: toolbar, strip, inspector background

## 3.2 타이포그래피

- Display: `"SF Pro Display", "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif`
- UI text: `"SF Pro Text", "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif`
- Mono: `"SFMono-Regular", "Cascadia Mono", "Menlo", "Monaco", monospace`

규칙:

- 섹션 제목은 system-like sans display를 사용한다.
- 데이터, 상태, 채널 번호, dB 값은 mono를 사용한다.
- 버튼과 form label은 UI text를 사용한다.
- title hierarchy는 웹 랜딩보다 작게, 앱 크롬과 작업면의 정보량을 우선한다.
- 라벨은 11px~12px, 일반 UI 텍스트는 13px~14px, 상태 pill은 11px~12px 범위를 기본으로 둔다.

## 3.3 반경

- `--radius-xs`: 4px
- `--radius-sm`: 8px
- `--radius-md`: 12px
- `--radius-lg`: 16px
- `--radius-pill`: 999px

## 3.4 간격

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 24px
- `--space-6`: 32px
- `--space-7`: 48px
- `--space-8`: 72px

밀도 규칙:

- control height는 `36px ~ 40px` 범위를 기본으로 둔다.
- header/control bar는 `52px ~ 60px` 범위를 기본으로 둔다.
- 카드 내부 패딩은 기본적으로 `12px ~ 16px`를 넘기지 않는다.

## 3.5 그림자

- `--shadow-soft`: 얕은 카드
- `--shadow-panel`: 제어 패널
- `--shadow-focus`: 포커스 링 성격의 외곽 glow

## 4. 레이아웃 시스템

## 4.1 Shell

- `app-shell`: 전체 페이지 래퍼
- `app-grid`: 메인 2열 또는 3열 레이아웃
- `panel`: 모든 카드와 제어면의 기본 단위

## 4.2 반응형 규칙

- 데스크톱: 12-column 느낌의 넓은 panel grid
- 태블릿: 2열
- 모바일: 1열

중요:

- meter bank는 좁아지면 스크롤 가능한 strip로 바뀐다.
- track row는 모바일에서 2줄 카드 형태로 축약된다.

## 5. 상태 언어

상태는 아래 컴포넌트 조합으로 표현한다.

- `status-pill`
- `signal-dot`
- `alert-banner`
- `state-strip`

상태 매핑:

- `prepared` -> green
- `recording` -> red
- `stopping` -> amber
- `completed` -> green
- `failed` -> red
- `pending export` -> amber
- `ready export` -> green

호환 규칙:

- 기존 class 이름에 `is-cyan`이 남아 있어도 실제 accent는 green으로 렌더링한다.

## 6. 핵심 컴포넌트

## 6.1 Surface 계층

### `panel`

가장 기본 카드. 제목, 내용, 액션 영역을 가질 수 있다.

변형:

- `panel--paper`
- `panel--console`
- `panel--ghost`

### `section-head`

섹션 제목과 보조 설명, 우측 액션 묶음.

## 6.2 액션 컴포넌트

### `button`

변형:

- `button--primary`
- `button--secondary`
- `button--ghost`
- `button--danger`
- `button--quiet`

상태:

- default
- hover
- active
- disabled

### `icon-button`

작은 원형 또는 squircle 버튼.

용도:

- refresh
- download
- more
- close

## 6.3 입력 컴포넌트

### `field`

텍스트 입력용 wrapper.

하위:

- `field__label`
- `field__hint`
- `field__control`

### `text-input`

용도:

- session title
- channel label filter

### `dropdown-select`

네이티브 `select`가 아니라 커스텀 trigger + listbox 조합이다.

용도:

- device select
- profile select
- sample-rate select

구성:

- `dropdown-select`
- `dropdown-select__trigger`
- `dropdown-select__value`
- `dropdown-select__chevron`
- `dropdown-select__menu`
- `dropdown-select__option`

상태:

- closed
- open
- selected
- hover
- disabled

### `segmented`

용도:

- storage target
- recorder mode

### `toggle`

용도:

- armed on/off
- auto-export on/off

## 6.4 상태 및 피드백

### `status-pill`

짧은 상태 라벨.

예:

- `Recording`
- `Ready`
- `Driver mismatch`

### `alert-banner`

페이지 폭 경고/오류.

변형:

- info
- warning
- critical
- success

### `toast`

짧은 작업 완료 또는 실패 알림.

## 6.5 정보 카드

### `stat-card`

한 가지 수치만 강하게 보여주는 카드.

예:

- free disk
- armed tracks
- sample rate
- drop count

### `device-card`

오디오 장치 한 개를 나타내는 카드.

필드:

- name
- backend
- inputChannels
- sampleRates
- selected state

### `profile-card`

장비 프로파일 한 개를 나타내는 카드.

필드:

- family
- expected channels
- preferred rate

## 6.6 레코딩 전용 컴포넌트

### `state-strip`

상단 전역 상태 표시줄.

표시:

- recorder state
- selected device
- active session id
- duration

### `meter-bank`

여러 meter tile의 grid/strip wrapper.

### `meter-tile`

채널 하나의 peak meter.

필드:

- usb channel
- label
- current peak
- peak hold
- armed state

### `track-row`

채널 설정과 상태를 동시에 보여주는 행.

필드:

- channel number
- editable label
- armed toggle
- last peak
- status mini pill

### `segment-table`

세션 상세에서 segment 목록을 보여주는 표.

컬럼:

- index
- file
- frame range
- size
- action

## 6.7 세션 히스토리

### `session-card`

저장된 세션 요약 카드.

필드:

- title
- session id
- storage target
- export state
- start/stop timestamps
- actions

### `empty-state`

빈 세션 목록이나 장치 미검출 상태에 사용.

## 6.8 오버레이

### `modal`

용도:

- stop confirmation
- export expired 안내
- destructive action 확인

### `drawer`

용도:

- session detail
- track detail

v1에서 실제 구현은 `modal` 우선, `drawer`는 시각적 정의만 제공한다.

## 7. 컴포넌트 우선순위

## 7.1 v1 필수

- `panel`
- `section-head`
- `button`
- `field`
- `text-input`
- `dropdown-select`
- `segmented`
- `toggle`
- `status-pill`
- `alert-banner`
- `stat-card`
- `device-card`
- `profile-card`
- `state-strip`
- `meter-bank`
- `meter-tile`
- `track-row`
- `session-card`
- `empty-state`
- `modal`

## 7.2 v1.1 이후

- `toast`
- `drawer`
- `segment-table`

## 8. 플레이그라운드 요구사항

`web/playground.html`은 아래를 포함해야 한다.

1. 토큰 미리보기
2. 타이포그래피 샘플
3. 버튼과 입력 컴포넌트 전 상태
4. device/profile 선택 카드
5. storage target segmented control
6. recorder state strip
7. meter bank mock
8. track row 리스트
9. session history card
10. modal / empty state 샘플
11. 전체 조합 예시 화면

## 9. 구현 규칙

- 컴포넌트 class는 의미 기반 이름을 사용한다.
- JS 없이도 기본 상태가 보여야 한다.
- JS는 meter animation, tab interaction, demo state 전환 정도만 담당한다.
- 디자인 토큰은 CSS custom property로 선언한다.
- 실제 앱 구현 시 playground CSS를 그대로 shared stylesheet로 재사용한다.
- 리스트형 컴포넌트는 내부 간격과 열 폭을 고정해 숫자, 토글, meter가 서로 밀리지 않게 한다.
- 좁은 rail 영역에서는 meter tile 수를 억지로 늘리지 말고 column 수를 줄여 readability를 우선한다.

## 10. 산출물

이 디자인 시스템 단계의 산출물은 아래 네 가지다.

- `design-system.md`
- `web/design-system.css`
- `web/playground.html`
- `web/playground.js`
