# Personal Audio Recorder Design

## 1. 목적

이 프로젝트는 `Behringer X32`, `Yamaha TF Series` 같은 디지털 오디오 믹서가 USB로 노출하는 다중 입력 채널을 받아서, 각 채널을 개별 오디오 파일로 녹음하고 홈서버의 로컬 저장소에 보관하는 레코더다.

중요한 점은 이 프로젝트가 일반 웹 마이크 녹음기가 아니라는 것이다.

- 입력 소스는 브라우저 기본 마이크가 아니라 `USB multi-channel audio device`다.
- 녹음 대상은 1채널이 아니라 `32ch`, `34ch` 같은 대규모 입력이다.
- 결과물은 단일 믹스 파일보다 `채널별 mono track` 세트가 더 중요하다.
- 저장소는 RAM이 아니라 `영속적인 로컬 디스크`여야 한다.

이번 문서는 이 도메인에 맞게 바로 구현 가능한 수준의 구조를 정의한다.

## 2. 문제 정의

목표는 아래 6가지다.

1. 믹서가 USB로 노출하는 멀티채널 입력을 안정적으로 캡처한다.
2. 각 USB 입력 채널을 독립된 mono 파일로 기록한다.
3. 녹음 중 산출물을 홈 PC의 로컬 디스크에 세션 단위로 기록한다.
4. 이후 다른 저장소로 확장할 수 있도록 저장 계층을 분리한다.
5. 웹 UI로 장비 선택, 세션 시작/정지, 상태 확인, 파일 조회가 가능해야 한다.
6. 페이지에 접속한 사용자가 `서버에 저장` 또는 `내 PC로 저장`을 선택할 수 있어야 한다.

## 3. 도메인 전제

### 3.1 지원하려는 장비군

초기 타깃은 아래 두 계열이다.

- `Behringer X32` 계열
- `Yamaha TF Series` 계열

이 장비들은 USB 오디오 인터페이스 역할을 하며, 콘솔 내부 라우팅 결과를 컴퓨터 입력 채널로 전달한다.

### 3.2 장비별 도메인 특성

#### X32 계열

- USB 오디오 인터페이스는 보통 `32x32` 채널 구성을 사용한다.
- 샘플레이트는 운영상 `48kHz`를 기본값으로 둔다.
- 실제 USB 송출 채널의 소스는 콘솔 라우팅 설정에 따라 달라질 수 있다.
- 이 설계의 `x32-32` 프로파일은 X32 + X-USB 계열 운용을 가정한 운영 프로파일이다.
- 앱이 콘솔의 라우팅 상태를 자동으로 읽는 것은 이번 버전 범위에 넣지 않는다.

#### TF Series 계열

- USB 오디오는 `34 input / 34 output` 구성을 기준으로 본다.
- 운영상 `48kHz`, `24-bit PCM` 기준으로 설계한다.
- 기본 프로파일은 `1-32 mono source + ST L/R`의 34채널로 취급한다.
- 역시 실제 소스 매핑은 콘솔 설정에 따라 달라질 수 있다.

### 3.3 가장 중요한 현실 제약

이 장비 도메인에서는 `브라우저만으로 직접 안정적으로 녹음`하는 구조를 기본 설계로 잡으면 안 된다.

이유:

- 브라우저는 `오디오 장치`는 보여주지만 `콘솔의 각 USB 채널 이름`은 알지 못한다.
- 브라우저에서 멀티채널 입력이 보이는지 여부는 `OS + 드라이버 + 브라우저` 조합에 강하게 의존한다.
- Windows에서는 이런 장비가 `ASIO` 기반으로 가장 안정적으로 동작하는 경우가 많고, 브라우저는 ASIO를 직접 사용하지 않는다.
- 장시간 멀티채널 라이브 녹음은 웹 메모리 기반 업로드 방식으로 처리하면 안 된다.

따라서 아키텍처는 `네이티브 캡처 서버 + 내장 Web UI`로 간다.

## 4. 제품 형태

이 프로젝트는 `하나의 리포지토리`와 `하나의 서버 애플리케이션`으로 구성한다.

구성 요소는 논리적으로는 아래 두 부분이지만, 배포 단위는 하나다.

1. `Recorder Server`
2. `Embedded Web UI`

### 4.1 Recorder Server

홈 PC에서 실행되는 단일 네이티브 프로세스다.

책임:

- 오디오 디바이스 탐색
- 지정한 장치의 다중 채널 입력 캡처
- 채널 분리
- mono WAV 파일 기록
- 세션 메타데이터 기록
- HTTP/WebSocket API 제공
- 정적 Web UI 파일 서빙

### 4.2 Embedded Web UI

브라우저에서 접근하는 제어 화면이다.

책임:

- 장비 목록 표시
- 장비 프로파일 선택
- 채널 이름 수정
- 세션 시작/정지
- 실시간 상태/미터 표시
- 저장된 세션 목록 조회

중요:

- 브라우저가 직접 오디오를 녹음하지 않는다.
- 브라우저는 `제어 plane`만 담당한다.
- 실제 캡처와 로컬 파일 저장은 `Recorder Server`가 담당한다.
- UI asset은 같은 서버 프로세스가 `/` 경로로 직접 제공한다.

### 4.3 단일 배포 원칙

v1은 아래 세 가지로 고정한다.

1. 하나의 Git repository에서 전체를 관리한다.
2. 하나의 서버 프로세스가 캡처, API, UI 서빙을 모두 담당한다.
3. 캡처는 홈 PC에서 수행하고, 모든 세션은 먼저 로컬 디스크에 spool된 뒤 `server_local` 또는 `client_download`로 마무리한다.

## 5. 배포 토폴로지

### 5.1 v1 고정 토폴로지

`USB 믹서가 연결된 동일한 홈 PC`에서 Recorder Server를 실행한다.

```text
Mixer (X32 / TF)
  -> USB
Home PC
  -> Recorder Server
  -> Local Disk Storage
  -> Web UI served over HTTP
Browser on same LAN
  -> controls Recorder Server
```

이 구성이 구현 기준이다.

## 6. 기술 결정

## 6.1 구현 언어

Recorder Server는 `Rust`로 구현한다.

이유:

- 장시간 스트리밍 I/O를 안정적으로 처리하기 쉽다.
- 오디오 백엔드 추상화에 적합하다.
- 메모리 사용량과 오류 범위를 통제하기 쉽다.
- HTTP 서버와 파일 I/O를 하나의 프로세스로 묶기 쉽다.

## 6.2 런타임 구성

- 단일 Rust 서버 프로세스
- 내장 HTTP/WebSocket 서버
- 같은 서버가 정적 Web UI를 제공
- 저장소: 로컬 파일 시스템
- 포맷: 채널별 mono WAV

## 6.3 오디오 백엔드 전략

오디오 장치 접근은 OS별 backend로 분리한다.

- macOS: `CoreAudioBackend`
- Windows: `AsioBackend` 우선, `WasapiBackend`는 테스트용 fallback
- Linux: `AlsaBackend`는 generic device 지원용, X32/TF 1차 목표는 아님

중요:

- Windows에서 X32/TF를 실제 운용 대상으로 삼으려면 `ASIO backend`를 우선 구현해야 한다.
- WASAPI만으로도 일부 환경은 될 수 있지만, 이를 정식 운용 기준으로 두지 않는다.

## 6.4 직접 브라우저 캡처를 채택하지 않는 이유

이번 프로젝트는 브라우저 `getUserMedia()` 경로를 오디오 캡처 핵심으로 사용하지 않는다.

이유:

- 브라우저는 `device selection`에는 적합하지만 `32ch/34ch live capture recorder`의 안정된 구현 기반이 아니다.
- 장비 드라이버 노출 방식에 따라 실제 채널 수가 달라질 수 있다.
- 장시간 녹음에서 메모리 압박 없이 바로 파일로 쓰는 구조가 더 중요하다.

## 7. 범위

### 포함

- 단일 USB 오디오 디바이스 선택
- 최대 34채널 입력 캡처
- 채널별 mono WAV 저장
- 세션 메타데이터 저장
- 저장 타깃 선택 UI
- `server_local` 보존
- `client_download` export
- 실시간 상태 표시
- 실시간 peak meter
- 세션 목록/상세 조회
- 저장소 adapter 추상화
- local filesystem storage 구현

### 제외

- 콘솔 원격 제어
- 콘솔 라우팅 자동 읽기
- 플러그인 이펙트
- 소프트웨어 모니터 믹스
- 펀치인/펀치아웃
- 멀티 디바이스 동기화
- 네트워크 스트리밍 전송 녹음
- 사용자 인증
- 동시 다중 세션
- 브라우저가 사용자 파일 시스템 임의 경로에 무권한 직접 쓰기
- 녹음 중 서버 무저장 패스스루 전송

## 8. 운영 전제

1. 한 번에 하나의 오디오 디바이스만 사용한다.
2. 한 번에 하나의 녹음 세션만 활성화한다.
3. 녹음 중 오디오는 항상 서버 로컬 디스크에 먼저 기록한다.
4. 입력 채널의 의미는 `device profile` 또는 사용자 설정으로 표현한다.
5. 실제 콘솔 송출 라우팅은 사용자가 콘솔에서 맞춘다.

## 9. 용어

| 용어 | 의미 |
| --- | --- |
| `Device` | OS가 노출한 오디오 입력 장치 |
| `Device Profile` | 장비군별 채널 수, 기본 이름, 샘플레이트 정책 |
| `Session` | 한 번의 녹음 작업 전체 |
| `Track` | USB 입력 채널 하나에 대응하는 결과 파일 |
| `Segment` | 긴 녹음을 나누어 저장하는 파일 단위 |
| `Armed Track` | 실제로 기록할 대상으로 활성화된 채널 |
| `Storage Target` | 세션 완료 후 결과물을 어디에 보존/전달할지에 대한 정책 |

## 10. 상위 아키텍처

```text
Web Browser
  -> HTTP API
  -> WebSocket status stream

Recorder Server
  -> Device Manager
  -> Capture Engine
  -> Meter Engine
  -> Session Manager
  -> Storage Driver

Storage Driver
  -> LocalFsStore (v1, default)
  -> Future drivers: NFS, S3, object storage, remote uploader
```

## 11. 핵심 설계 원칙

1. 녹음 중 전체 오디오를 메모리에 쌓지 않는다.
2. 캡처와 디스크 기록은 분리한다.
3. 채널별 파일을 직접 기록한다.
4. 세션 메타데이터는 오디오 파일과 함께 같은 세션 디렉터리에 둔다.
5. 장치 채널 의미는 하드웨어 자동 탐지보다 프로파일과 사용자 편집을 우선한다.

## 12. 디렉터리 구조

```text
/
  design.md
  Cargo.toml
  .gitignore
  recorderd/
    src/
      main.rs
      config.rs
      app_state.rs
      http/
        mod.rs
        routes/
          health.rs
          devices.rs
          recorder.rs
          sessions.rs
        ws.rs
      audio/
        mod.rs
        backend.rs
        device_manager.rs
        device_profile.rs
        capture_engine.rs
        meter.rs
        pcm.rs
        backends/
          coreaudio.rs
          asio.rs
          wasapi.rs
      session/
        mod.rs
        manager.rs
        manifest.rs
        wav.rs
        segment_writer.rs
      storage/
        mod.rs
        store.rs
        local_fs.rs
      util/
        ids.rs
        time.rs
  web/
    index.html
    app.js
    styles.css
  data/
    sessions/
```

## 13. 디바이스 프로파일 설계

앱은 `오디오 장치 이름`과 `장비군 프로파일`을 분리한다.

이유:

- OS에 노출되는 장치명은 드라이버와 버전에 따라 달라질 수 있다.
- 장치명만으로 실제 채널 의미를 확정할 수 없다.
- X32, TF 모두 콘솔 내부 라우팅에 따라 USB 채널 의미가 달라질 수 있다.

### 13.1 DeviceProfile 모델

```json
{
  "id": "x32-32",
  "family": "x32",
  "displayName": "X32 32ch",
  "expectedInputChannels": 32,
  "preferredSampleRates": [48000, 44100],
  "preferredBitDepth": 24,
  "defaultTracks": [
    { "usbChannel": 1, "defaultLabel": "USB 01" },
    { "usbChannel": 2, "defaultLabel": "USB 02" }
  ]
}
```

### 13.2 기본 프로파일

#### `x32-32`

- `expectedInputChannels = 32`
- `preferredSampleRates = [48000, 44100]`
- `preferredBitDepth = 24`
- 기본 track label은 `USB 01` ~ `USB 32`

#### `tf-34`

- `expectedInputChannels = 34`
- `preferredSampleRates = [48000]`
- `preferredBitDepth = 24`
- 기본 track label:
  - `CH 01` ~ `CH 32`
  - `ST L`
  - `ST R`

### 13.3 프로파일 적용 규칙

1. 사용자가 오디오 디바이스를 선택한다.
2. 사용자가 device profile을 선택한다.
3. 앱은 실제 입력 채널 수와 프로파일 기대 채널 수를 비교한다.
4. 둘이 다르면 경고를 띄우고 시작을 막는다.

예:

- X32 프로파일인데 장치가 2채널만 노출되면 `ASIO/driver mismatch`로 판단한다.

## 14. 장치 탐색

## 14.1 DeviceInfo 모델

```json
{
  "id": "device_01",
  "backend": "asio",
  "name": "X-USB ASIO Driver",
  "inputChannels": 32,
  "sampleRates": [44100, 48000],
  "defaultSampleRate": 48000,
  "isDefault": false
}
```

## 14.2 탐색 규칙

- 앱 시작 시 오디오 입력 장치를 enumerate 한다.
- 입력 채널 수 8 이상 장치를 우선 노출한다.
- 장치명 기준 힌트:
  - `X-USB`
  - `X32`
  - `TF`
  - `Yamaha Steinberg`

주의:

- 힌트는 표시용일 뿐, 프로파일 자동 확정 근거로 쓰지 않는다.

## 15. 세션 모델

## 15.1 SessionManifest

`data/sessions/{sessionId}/manifest.json`

```json
{
  "id": "sess_20260406_150501_ab12cd",
  "title": "Sunday Service AM",
  "status": "recording",
  "device": {
    "id": "device_01",
    "backend": "asio",
    "name": "X-USB ASIO Driver"
  },
  "profile": {
    "id": "x32-32",
    "family": "x32"
  },
  "storageTarget": "server_local",
  "export": {
    "status": "not_requested",
    "archiveFile": null,
    "downloadUrl": null
  },
  "format": {
    "sampleRate": 48000,
    "bitDepth": 24,
    "channelCount": 32
  },
  "startedAt": "2026-04-06T06:05:01.000Z",
  "stoppedAt": null,
  "durationFrames": 0,
  "dropEvents": [],
  "tracks": [
    {
      "usbChannel": 1,
      "label": "Kick",
      "armed": true,
      "segments": [
        {
          "index": 1,
          "file": "tracks/ch01/000001.wav",
          "startFrame": 0,
          "endFrame": 43199999,
          "sizeBytes": 129600044
        }
      ]
    }
  ]
}
```

선택 필드:

```json
{
  "recovery": {
    "recoveredPartial": true,
    "detectedAt": "2026-04-06T08:00:00.000Z"
  }
}
```

## 15.2 Session 상태

Session status는 아래 5개만 둔다.

- `prepared`
- `recording`
- `stopping`
- `completed`
- `failed`

하나의 active session만 허용한다.

참고:

- `/api/v1/recorder/state`의 recorder global state는 별도로 `idle` 값을 사용할 수 있다.

## 15.3 세션 생성 흐름

1. 사용자가 장치와 프로파일을 고른다.
2. 사용자가 저장 타깃을 `server_local` 또는 `client_download` 중에서 선택한다.
3. 트랙 이름과 armed 상태를 조정한다.
4. 서버는 `prepared` 세션 디렉터리를 만든다.
5. 녹음 시작 시 각 armed track의 첫 segment 파일을 생성한다.

## 15.4 Storage Target 모델

v1은 아래 두 가지 target만 지원한다.

### `server_local`

- 녹음 결과를 홈 PC 로컬 디스크에 보존한다.
- 세션 완료 후 `data/sessions/{id}`를 그대로 유지한다.
- UI에서는 해당 세션의 파일 목록과 segment 다운로드 링크를 제공한다.

### `client_download`

- 녹음 중에는 여전히 홈 PC 로컬 디스크에 segment를 기록한다.
- 세션 완료 후 서버가 ZIP export를 생성한다.
- 사용자는 브라우저에서 ZIP을 다운로드해 자신의 PC에 저장한다.
- 브라우저는 다운로드 대화상자를 통해 저장 위치를 결정한다.
- export와 원본 track artifact는 `CLIENT_DOWNLOAD_RETENTION_HOURS` 동안 임시 보관한다.
- 보관 시간이 지나면 background cleanup이 `tracks/`와 `exports/` 내용을 삭제할 수 있다.
- 세션 요약과 `manifest.json`은 유지해서 과거 기록 목록은 계속 조회 가능하게 한다.

## 15.5 Export 상태

`storageTarget = client_download`인 세션은 별도의 export 상태를 가진다.

- `not_requested`
- `pending`
- `ready`
- `downloaded`
- `failed`

`client_download` 세션에서 media artifact retention이 끝난 뒤에도:

- 세션 summary
- `manifest.json`
- export 상태 기록

은 유지된다.

## 16. 저장 형식

## 16.1 track file 정책

각 USB 입력 채널은 `mono WAV` 파일로 저장한다.

이유:

- 후처리가 쉽다.
- 파일 단위 의미가 명확하다.
- 32ch/34ch 장비에서도 DAW import가 단순하다.
- multichannel interleaved WAV보다 운영이 편하다.

## 16.2 세션 디렉터리 구조

```text
data/
  sessions/
    sess_20260406_150501_ab12cd/
      manifest.json
      device-profile.json
      tracks/
        ch01/
          000001.wav
          000002.wav
        ch02/
          000001.wav
      exports/
        session.zip
```

## 16.3 segment 사용 이유

긴 세션은 단일 WAV 파일보다 segment 단위가 낫다.

이유:

- 파일 크기 제한을 피할 수 있다.
- 비정상 종료 시 손실 범위를 줄일 수 있다.
- 업로드/동기화 확장에도 유리하다.

## 16.4 segment 정책

기본값:

- `SEGMENT_SECONDS = 900` (15분)

즉:

- 각 track은 15분마다 새 WAV를 생성한다.
- manifest는 track별 segment 목록을 관리한다.

## 16.5 오디오 포맷

디스크 저장 형식:

- `PCM WAV`
- `24-bit little-endian`
- `mono`
- sample rate는 실제 장치 negotiated 값 사용

내부 처리 형식:

- callback에서 받은 샘플은 내부적으로 `f32` 또는 `i32`로 정규화
- 파일 기록 시 24-bit PCM으로 양자화

## 17. 저장소 추상화

멀티채널 라이브 녹음은 단일 `save(buffer)` 인터페이스로 처리하면 안 된다.

이번 도메인에서는 `세션 단위 streaming writer`가 필요하다.

## 17.1 Store 인터페이스

파일: `recorderd/src/storage/store.rs`

```rust
pub trait SessionStore: Send + Sync {
    fn prepare_session(&self, req: PrepareSessionRequest) -> anyhow::Result<PreparedSession>;
    fn open_track_segment(
        &self,
        session_id: &str,
        usb_channel: u16,
        segment_index: u32,
        format: PcmFormat,
    ) -> anyhow::Result<Box<dyn TrackSegmentWriter>>;
    fn update_manifest(&self, session_id: &str, manifest: &SessionManifest) -> anyhow::Result<()>;
    fn finalize_session(&self, session_id: &str, manifest: &SessionManifest) -> anyhow::Result<()>;
    fn fail_session(&self, session_id: &str, manifest: &SessionManifest) -> anyhow::Result<()>;
    fn create_export_archive(&self, session_id: &str) -> anyhow::Result<ExportArtifact>;
    fn list_sessions(&self) -> anyhow::Result<Vec<SessionSummary>>;
    fn get_session(&self, session_id: &str) -> anyhow::Result<SessionManifest>;
}
```

`ExportArtifact`는 최소 아래 필드를 가진다.

```rust
pub struct ExportArtifact {
    pub archive_file: String,
    pub download_url: String,
    pub size_bytes: u64,
}
```

## 17.2 TrackSegmentWriter 인터페이스

```rust
pub trait TrackSegmentWriter: Send {
    fn write_frames_i32(&mut self, pcm24_in_i32_container: &[i32]) -> anyhow::Result<()>;
    fn finalize(&mut self) -> anyhow::Result<TrackSegmentInfo>;
    fn abort(&mut self) -> anyhow::Result<()>;
}
```

주의:

- `write_frames_i32()` 입력은 `mono channel frames`만 받는다.
- deinterleave는 store가 아니라 session/capture 계층이 담당한다.

## 17.3 v1 LocalFsStore

책임:

- 세션 디렉터리 생성
- manifest 저장
- track segment WAV 파일 생성
- finalize 시 header patch
- ZIP export 생성
- list/get 제공

## 17.4 향후 store 확장

이 인터페이스를 유지하면 이후 아래 저장소로 확장 가능하다.

- `MountedNasStore`
- `ObjectMirrorStore`
- `UploadAfterStopStore`

하지만 v1에서는 `LocalFsStore`만 구현한다.

## 18. 오디오 캡처 파이프라인

## 18.1 흐름

```text
Audio Backend Callback
  -> interleaved input block
  -> bounded queue
  -> session writer worker
  -> deinterleave by channel
  -> peak meter update
  -> segment writers append mono PCM
```

## 18.2 queue 정책

- 캡처 callback 안에서 디스크 쓰기를 하지 않는다.
- callback은 빠르게 queue enqueue만 수행한다.
- writer worker가 디스크 쓰기를 담당한다.

queue 기본값:

- block 단위 bounded queue
- 권장 capacity: `256 blocks`

## 18.3 block 처리 규칙

입력 block은 아래 정보를 가진다.

```rust
struct InputBlock {
    frame_count: usize,
    channel_count: usize,
    interleaved_samples: Vec<f32>,
    capture_instant: u64
}
```

writer worker는:

1. armed track 기준으로 필요한 채널만 분리
2. 각 채널을 `i32 container for 24-bit PCM`으로 변환
3. 현재 segment writer에 append
4. peak meter 계산
5. 누적 frame 수 갱신

## 18.4 overrun 처리

queue overflow가 발생하면 녹음을 조용히 망치면 안 된다.

정책:

1. `drop event`를 manifest에 기록
2. 상태 스트림으로 UI에 경고 전송
3. 가능한 경우 누락 구간 길이만큼 silence 삽입
4. 삽입이 불가능하면 세션을 `failed`로 전환하고 partial 파일을 남긴다

## 19. 미터 처리

UI 표시용으로 track별 peak meter를 제공한다.

정책:

- meter update 주기: `100ms`
- 계산값: `peak dBFS`
- 보관 값:
  - current peak
  - peak hold

meter는 녹음 품질 판단용이고 저장 포맷에는 영향을 주지 않는다.

## 20. 오디오 백엔드 추상화

파일: `recorderd/src/audio/backend.rs`

```rust
pub trait AudioBackend: Send + Sync {
    fn kind(&self) -> AudioBackendKind;
    fn list_input_devices(&self) -> anyhow::Result<Vec<AudioDeviceInfo>>;
    fn open_input_stream(
        &self,
        request: OpenStreamRequest,
        callback: AudioInputCallback,
    ) -> anyhow::Result<Box<dyn ActiveInputStream>>;
}
```

### 20.1 OpenStreamRequest

```rust
pub struct OpenStreamRequest {
    pub device_id: String,
    pub sample_rate: u32,
    pub expected_channels: u16,
    pub frames_per_buffer_hint: Option<u32>,
}
```

### 20.2 backend 우선순위

#### Windows

1. `AsioBackend`
2. `WasapiBackend`

#### macOS

1. `CoreAudioBackend`

#### Linux

1. `AlsaBackend`

## 21. HTTP API 설계

prefix는 `/api/v1`로 고정한다.

## 21.1 GET /api/v1/health

응답:

```json
{
  "status": "ok"
}
```

## 21.2 GET /api/v1/devices

설명:

- 현재 인식된 입력 장치 목록 반환

응답:

```json
{
  "devices": [
    {
      "id": "device_01",
      "backend": "asio",
      "name": "X-USB ASIO Driver",
      "inputChannels": 32,
      "sampleRates": [44100, 48000],
      "defaultSampleRate": 48000,
      "isDefault": false
    }
  ]
}
```

## 21.3 GET /api/v1/device-profiles

응답:

```json
{
  "profiles": [
    {
      "id": "x32-32",
      "family": "x32",
      "expectedInputChannels": 32
    },
    {
      "id": "tf-34",
      "family": "tf",
      "expectedInputChannels": 34
    }
  ]
}
```

## 21.4 POST /api/v1/sessions/prepare

설명:

- 세션 디렉터리와 manifest 초안 생성

요청:

```json
{
  "title": "Sunday Service AM",
  "deviceId": "device_01",
  "profileId": "x32-32",
  "storageTarget": "server_local",
  "sampleRate": 48000,
  "tracks": [
    { "usbChannel": 1, "label": "Kick", "armed": true },
    { "usbChannel": 2, "label": "Snare", "armed": true }
  ]
}
```

검증:

- active session이 없어야 함
- track 수는 device profile channel 범위 이내여야 함
- armed track가 1개 이상이어야 함
- `storageTarget`은 `server_local` 또는 `client_download`
- sample rate가 profile/device capability 안에 있어야 함

응답:

```json
{
  "session": {
    "id": "sess_20260406_150501_ab12cd",
    "status": "prepared",
    "storageTarget": "server_local"
  }
}
```

## 21.5 POST /api/v1/recorder/start

요청:

```json
{
  "sessionId": "sess_20260406_150501_ab12cd"
}
```

동작:

1. prepared session 로드
2. 오디오 스트림 open
3. track segment 생성
4. 상태를 `recording`으로 전환

응답:

```json
{
  "recorder": {
    "state": "recording",
    "sessionId": "sess_20260406_150501_ab12cd"
  }
}
```

## 21.6 POST /api/v1/recorder/stop

요청:

```json
{
  "sessionId": "sess_20260406_150501_ab12cd"
}
```

동작:

1. session status를 `stopping`으로 전환
2. 입력 스트림 stop
3. queue drain
4. open segment finalize
5. manifest 완료
6. `storageTarget == client_download`면 자동 export job을 enqueue하고 export 상태를 `pending`으로 설정
7. 상태를 `completed`로 전환

## 21.7 GET /api/v1/recorder/state

응답:

- 가능한 state 값: `idle`, `prepared`, `recording`, `stopping`

```json
{
  "state": "recording",
  "sessionId": "sess_20260406_150501_ab12cd",
  "durationSeconds": 812,
  "sampleRate": 48000,
  "channelsArmed": 28,
  "dropCount": 0,
  "storageTarget": "server_local"
}
```

## 21.8 GET /api/v1/sessions

응답:

```json
{
  "sessions": [
    {
      "id": "sess_20260406_150501_ab12cd",
      "title": "Sunday Service AM",
      "status": "completed",
      "storageTarget": "client_download",
      "exportStatus": "ready",
      "startedAt": "2026-04-06T06:05:01.000Z",
      "stoppedAt": "2026-04-06T07:15:03.000Z",
      "trackCount": 32
    }
  ]
}
```

## 21.9 GET /api/v1/sessions/:id

응답:

- 해당 세션의 전체 manifest

## 21.10 GET /api/v1/sessions/:id/tracks/:channel/segments/:index

응답:

- `audio/wav`
- 실제 segment 파일 반환
- `client_download` 세션에서 retention이 끝나 media artifact가 삭제된 경우 `410 Gone`

## 21.11 POST /api/v1/sessions/:id/export

설명:

- `client_download` 세션의 ZIP export를 수동 재시도하거나 재생성한다.
- 정상 흐름에서는 stop 이후 자동 export job이 먼저 시도된다.
- raw track artifact가 retention 이후 삭제되었다면 `MEDIA_EXPIRED`로 실패한다.

응답:

```json
{
  "export": {
    "status": "ready",
    "archiveFile": "session.zip",
    "downloadUrl": "/api/v1/sessions/sess_20260406_150501_ab12cd/archive"
  }
}
```

## 21.12 GET /api/v1/sessions/:id/archive

응답:

- `application/zip`
- 세션 manifest와 전체 track segment를 포함한 ZIP 파일 반환
- retention 종료 후 archive가 정리되었다면 `410 Gone`

ZIP 구조:

```text
session.zip
  manifest.json
  tracks/
    ch01/
      000001.wav
    ch02/
      000001.wav
```

## 21.13 에러 포맷

```json
{
  "error": {
    "code": "DEVICE_CHANNEL_MISMATCH",
    "message": "Selected profile expects 32 inputs but the device exposes 2."
  }
}
```

예상 에러 코드:

- `ACTIVE_SESSION_EXISTS`
- `DEVICE_NOT_FOUND`
- `DEVICE_CHANNEL_MISMATCH`
- `UNSUPPORTED_SAMPLE_RATE`
- `NO_ARMED_TRACKS`
- `RECORDER_NOT_PREPARED`
- `RECORDER_ALREADY_RUNNING`
- `STORE_WRITE_FAILED`
- `AUDIO_BACKEND_ERROR`
- `INVALID_STORAGE_TARGET`
- `EXPORT_NOT_READY`
- `EXPORT_UNSUPPORTED_FOR_TARGET`
- `MEDIA_EXPIRED`

## 22. WebSocket 상태 스트림

경로:

- `/ws`

이벤트 유형:

- `recorder_state_changed`
- `meter_update`
- `drop_event`
- `device_lost`
- `session_completed`

### meter_update 예시

```json
{
  "type": "meter_update",
  "sessionId": "sess_20260406_150501_ab12cd",
  "channels": [
    { "usbChannel": 1, "peakDbfs": -12.4 },
    { "usbChannel": 2, "peakDbfs": -18.1 }
  ]
}
```

## 23. Web UI 요구사항

화면은 아래 영역으로 구성한다.

1. 장치 선택
2. device profile 선택
3. 저장 타깃 선택
4. 세션 제목 입력
5. 채널 리스트
6. armed 토글
7. 채널 이름 편집
8. Start / Stop 버튼
9. 실시간 상태 바
10. track meter grid
11. 저장 세션 목록

### 저장 타깃 선택 규칙

옵션:

- `서버에 저장 (권장)` -> `server_local`
- `내 PC로 저장` -> `client_download`

동작:

- `server_local` 선택 시 세션 완료 후 서버 보존 링크를 표시한다.
- `client_download` 선택 시 export 상태가 `ready`가 되면 `ZIP 다운로드` 버튼을 표시한다.
- 다운로드는 브라우저 기본 다운로드 메커니즘을 사용한다.
- 브라우저가 사용자 임의 폴더에 직접 쓰는 기능은 v1에서 제공하지 않는다.
- `client_download` 세션의 media artifact는 retention 이후 만료될 수 있다.

## 23.1 채널 리스트 규칙

- 행 1개가 USB 채널 1개
- 표시 항목:
  - `usbChannel`
  - `label`
  - `armed`
  - `lastPeakDbfs`

## 23.2 v1 UX 규칙

- active session이 있으면 장치 변경 UI 비활성화
- stop 중에는 모든 제어 비활성화
- 오류 발생 시 상단 고정 에러 배너 표시

## 24. 설정

환경 변수:

| 변수명 | 기본값 | 설명 |
| --- | --- | --- |
| `RECORDER_BIND` | `0.0.0.0:3000` | HTTP 바인딩 주소 |
| `DATA_DIR` | `./data` | 세션 저장 루트 |
| `SEGMENT_SECONDS` | `900` | track segment 길이 |
| `METER_INTERVAL_MS` | `100` | meter 전송 주기 |
| `QUEUE_BLOCK_CAPACITY` | `256` | 캡처 queue capacity |
| `FRAMES_PER_BUFFER_HINT` | `1024` | 오디오 버퍼 힌트 |
| `EXPORT_ARCHIVE_NAME` | `session.zip` | client download용 ZIP 파일명 |
| `CLIENT_DOWNLOAD_RETENTION_HOURS` | `24` | client download 세션의 archive 및 track artifact 보관 시간 |

## 25. 용량 계획

48kHz / 24-bit 기준 대략적인 원시 저장량:

- 1 mono channel: 약 `0.48 GiB / hour`
- 32 channels: 약 `15.45 GiB / hour`
- 34 channels: 약 `16.41 GiB / hour`

따라서 v1 구현에는 아래 UI 정보가 필요하다.

- 현재 free disk
- profile 기준 시간당 예상 사용량

## 26. 비정상 종료 복구

앱 시작 시 `data/sessions/*`를 스캔해서 아래를 수행한다.

1. `status == recording` 또는 `prepared`인데 종료되지 않은 세션 탐지
2. 열려 있던 WAV segment header 복구 시도
3. 세션 status는 `failed`로 마킹
4. 부분 복구에 성공했다면 `manifest.recovery.recoveredPartial = true` 기록

partial 파일은 남겨야 한다.

## 27. 구현 순서

1. Rust HTTP 서버와 정적 파일 서빙 뼈대 작성
2. `SessionStore`와 `LocalFsStore` 구현
3. `SessionManifest` 및 WAV segment writer 구현
4. `client_download`용 ZIP export 생성 구현
5. dummy audio backend로 end-to-end 세션 흐름 검증
6. `CoreAudioBackend` 또는 `AsioBackend` 1개 우선 구현
7. device/profile/storage-target UI 구현
8. start/stop + meter UI 연결
9. 비정상 종료 복구 구현
10. 실제 X32 또는 TF 장비로 현장 테스트

## 28. 1차 구현 우선순위

현실적으로는 아래 순서가 맞다.

### 경로 A: macOS 우선

- `CoreAudioBackend`
- X32/TF를 macOS에서 연결해 32ch/34ch 검증

### 경로 B: Windows 우선

- `AsioBackend`
- X32 X-USB 또는 Yamaha Steinberg USB Driver 환경 검증

장비 운용 기준이 Windows라면 `AsioBackend`가 사실상 우선이다.

## 29. 완료 기준

아래를 모두 만족하면 1차 구현 완료로 본다.

1. Recorder Server가 실행된다.
2. 브라우저에서 장치 목록을 조회할 수 있다.
3. X32 또는 TF 장치를 선택할 수 있다.
4. profile 채널 수와 장치 채널 수 mismatch를 감지한다.
5. armed된 모든 채널이 홈 PC 로컬 디스크에 mono WAV segment로 기록된다.
6. 사용자가 `서버에 저장` 또는 `내 PC로 저장`을 세션 준비 단계에서 선택할 수 있다.
7. `client_download` 세션은 export가 `ready`가 된 뒤 ZIP archive를 다운로드할 수 있다.
8. `server_local` 세션은 manifest와 track 파일을 조회할 수 있다.
9. 세션 목록에서 과거 기록을 볼 수 있다.
10. 한 세션 동안 메모리에 전체 오디오를 쌓지 않는다.

## 30. 구현 시 주의점

- 앱은 콘솔 USB 라우팅을 자동으로 제어하지 않는다.
- 채널 이름은 하드웨어 truth가 아니라 운영 메타데이터다.
- Windows에서 브라우저 단독 캡처를 시도하지 않는다.
- 장시간 녹음은 반드시 segment 기반으로 처리한다.
- 저장은 RAM이 아니라 디스크다.
- `client_download` 세션의 archive와 track artifact는 retention 이후 만료될 수 있다.

## 31. 참고 근거

설계 판단에 반영한 외부 근거:

- W3C Media Capture and Streams: 브라우저는 `MediaDeviceInfo` 기반으로 장치 목록을 제공하고, 오디오 입력에는 `channelCount` 같은 제약이 존재한다.
- W3C Web Audio API: 입력 스트림 채널은 `ChannelSplitterNode`로 분리할 수 있지만, 채널 의미 자체를 하드웨어 수준에서 설명해 주지는 않는다.
- Yamaha TF Series 공식 스펙: USB `24bit 34ch input / 34ch output`
- Yamaha TF Series 공식 기능 설명: 컴퓨터에 대해 최대 `34 tracks` 동시 녹음을 전제로 설명한다.

이 문서를 기준으로 구현을 시작하면 된다.
