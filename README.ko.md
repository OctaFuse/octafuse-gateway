# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway**는 Agent를 위한 셀프 호스팅이 가능한 오픈 소스 AI Gateway입니다. 여러 Provider의 모델, OpenAI Responses, 이미지 생성·편집, ASR / TTS / 실시간 오디오, Agent Tools, 자체 구축 또는 비공개 배포한 AI 서비스를 하나의 진입점으로 통합합니다. 또한 Route, Key, 예산, 사용량, 감사 기능을 통해 분산된 AI 리소스를 중앙에서 관리하고 스케줄링하며 제어할 수 있습니다. 단순히 모델 요청을 전달하는 데 그치지 않고, Agent가 필요한 리소스와 기능을 탐색하고 호출하며 관리할 수 있도록 지속적으로 확장 가능한 기반을 제공합니다.

**언어:** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **공식 웹사이트:** [octafuse.dev](https://octafuse.dev/en/)

## 핵심 기능

Octafuse Gateway의 핵심 목표는 **1인 기업(OPC) 또는 기업 내부를 위한 통합 AI 역량 허브를 구축하는 것**입니다. 보유한 멀티모달 AI 리소스와 다양한 도구를 하나로 연결하고, 배포·과금·운영 관리를 통합합니다.

주요 기능은 다음과 같습니다.

1. Provider 연결: 모델 벤더나 집계 플랫폼을 자유롭게 연결할 수 있습니다. Coding / Token Plan을 포함한 다양한 프리셋에서 엔드포인트를 원클릭으로 가져온 뒤 해당 API Key를 추가하면 됩니다. 전체 목록은 [Providers Catalog](https://octafuse.dev/en/catalog/providers/)를 참조하세요. 새로운 Provider 추가 PR도 환영합니다.
2. AI 모델 연결: 내장 모델 데이터에서 가져올 수 있어 일반적인 모델 파라미터와 가격을 일일이 설정할 필요가 없습니다. 전체 목록은 [Models Catalog](https://octafuse.dev/en/catalog/models/)를 참조하세요. 새로운 모델 추가 PR도 환영합니다.
3. 다중 프로토콜 지원:
    - OpenAI 엔드포인트:
      - Chat Completions: `POST /v1/chat/completions`
      - Responses: `POST /v1/responses`
      - Images: `POST /v1/images/generations`, `POST /v1/images/edits`
      - Audio: `POST /v1/audio/transcriptions`, `POST /v1/audio/speech`
      - Models: `GET /v1/models`
    - Anthropic 엔드포인트: `POST /v1/messages`
    - Google Gemini 엔드포인트: `POST /v1beta/models/{model}:generateContent` (`streamGenerateContent` 포함)
    - DashScope 동기식 멀티모달 ASR: `POST /v1/dashscope/services/aigc/multimodal-generation/generation`
    - DashScope 실시간 오디오: `GET /v1/dashscope/realtime`
4. Agent 도구 연결: `/v1/tools/*`를 통해 Agent용 도구를 통합 제공하고 로그, 과금, 비용 관리를 중앙화합니다. 모델과 도구를 하나의 Gateway에서 사용할 수 있습니다.
    - 웹 검색(`POST /v1/tools/web-search`): Bocha, Tavily, Alibaba Cloud CleverSee, Tencent Cloud WSA
    - 웹페이지 가져오기(`POST /v1/tools/web-fetch`): Firecrawl, Tavily Extract, Jina Reader
    - 심층 검색(`POST /v1/tools/web-deep-search`, 검색 + 읽기): Firecrawl Search, Jina Search
    - AI 작성 콘텐츠 탐지(`POST /v1/tools/ai-detection`): Tencent Cloud TMS가 구현되어 있으며 다중 엔진 확장을 위한 카탈로그를 제공합니다
    - Agent 도구는 계속 추가할 예정이며 관련 PR도 환영합니다.
5. 통합 AI 역량 진입점: 연결한 모델, 플랫폼, 도구는 배포된 Octafuse Gateway Base URL을 통해 제공됩니다. 클라이언트는 하나의 엔드포인트만 기억하면 됩니다.
6. 다양한 라우팅 전략: 동일 모델에 여러 업스트림 리소스가 있는 경우 워크로드에 맞는 전략을 선택할 수 있습니다.
    - `hash_affinity`: 기본 전략. 동일 사용자, 모델, 프로토콜을 안정적으로 같은 업스트림에 배치해 **Prompt Cache 적중률을 높이며**, 캐시와 세션 연속성이 중요한 작업에 적합합니다. 단기 트래픽은 완전히 균등하지 않을 수 있습니다
    - `weighted_random`: 가중치 기반 무작위 분배로 **부하 분산성이 높아**, 비용 비율 배분이나 A/B 테스트에 적합합니다. 같은 사용자도 Provider가 자주 바뀔 수 있어 캐시 적중률은 낮아질 수 있습니다
    - `weight_priority`: 가중치가 높은 순서로 고정 시도하는 결정적 전략입니다. 같은 우선순위 안에서 명확한 주·백업 구성을 만들기 좋지만 첫 Provider가 대부분의 트래픽을 처리합니다
    - `weighted_round_robin`: 가중치 기반 순환으로 트래픽을 더 고르게 분배합니다. 카운터는 런타임 인스턴스별로 유지되며 여러 인스턴스 사이에서 전역 동기화되지 않습니다
7. 사용자 관리와 회계 통합:
    - External system, User, API Key의 3단계 구조: External system으로 시스템이나 팀을 구분하고 API Key로 인증, 과금, 감사를 수행합니다
    - 세 가지 원장: 각 호출의 카탈로그 가격, 실제 Provider 비용, 사용자 청구액을 별도로 기록합니다
    - 시간대별 배율: 피크 / 비피크 가격과 평일·주말 배수를 이용해 비용 계산 정확도를 높이고 고객 가격과 프로모션을 유연하게 구성합니다
    - 모델별 사용자 배율: 사용자와 카탈로그 모델별로 할인, 할증 또는 무료 이용을 설정하며 카탈로그 가격과 Provider 비용은 변경하지 않습니다
8. 관리 화면과 관리 API:
    - 수동 운영과 외부 포털 연동을 모두 지원하는 관리 화면 및 API
    - 요청 상세, 통계, 운영 분석을 제공하는 관측성과 데이터 분석
    - Provider, 모델, Route, 클라이언트 설정을 빠르게 검증하는 Playground / Simulator
9. 유연한 배포 방식:
    - **Cloudflare Workers + D1 무료 배포**
    - Docker + Postgres / MySQL 배포

## 다른 오픈 소스 AI Gateway와의 차이

[New API](https://github.com/QuantumNous/new-api), [LiteLLM](https://github.com/BerriAI/litellm), [Sub2API](https://github.com/Wei-Shaw/sub2api), [Bifrost](https://github.com/maximhq/bifrost)는 각각 다른 강점을 가진 성숙한 오픈 소스 AI Gateway입니다. Octafuse는 **Agent 역량 제공과 AI 리소스 운영**에 더 집중하며, 주요 차이는 다음 다섯 영역에 있습니다.

| 중점 영역 | Octafuse 내장 메커니즘 | 적합한 사용 사례 |
|---|---|---|
| Agent 역량 | 웹 검색, 웹 가져오기, 심층 검색, 도구 호출 로그 및 과금 | 하나의 Gateway에서 Agent에 모델과 도구 제공 |
| 리소스 연결 | Provider / 모델 프리셋, 다중 프로토콜 엔드포인트, 원클릭 가져오기 | 분산된 AI 리소스의 통합 관리 |
| 정교한 라우팅 | 독립 Route Pool, 계층형 정책, 캐시 친화성, 장애 조치, 서킷 브레이커 | 안정성, 캐시 적중률, 비용 간 균형 |
| 운영 및 과금 | 카탈로그 가격, Provider 비용, 사용자 청구의 세 원장과 시간대별·멀티모달 과금 | 내부 정산, 한도 관리, 외부 서비스 운영 |
| 유연한 배포 | 다중 데이터베이스를 지원하는 Docker 또는 Cloudflare Workers + D1 | 셀프 호스팅, 엣지 배포, 저비용 도입 |

**평가 기준:**

- **✅ 완전**: 공개 버전에 해당 영역의 주요 사용 사례를 포괄하는 통합 메커니즘이 마련됨
- **🟡 우수**: 핵심 기능은 성숙했지만 지원 범위나 운영 깊이가 상대적으로 제한됨
- **🟠 기본**: 사용할 수 있는 기반은 있으나 외부 구성 요소나 추가 개발 의존도가 높음
- **⚪ 없음**: 공식 공개 문서에 동급의 내장 기능이 명시되지 않음

<details>
<summary><strong>전체 기능 비교 펼치기(22개 항목)</strong></summary>

### 연결 및 Agent 역량

| 세부 기능 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| Provider / 모델 프리셋 및 원클릭 가져오기 | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| 네이티브 프로토콜 및 멀티모달 지원 | 🟡¹ | ✅ | ✅ | ✅ | ✅ |
| 웹 검색, 가져오기, 심층 검색 내장 | ✅ | ⚪ | 🟠 | 🟠 | 🟠 |
| 도구 Provider 설정, 호출 로그, 과금 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### 라우팅 및 거버넌스

| 세부 기능 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 프로토콜 / operation 단위 요청 진입점 및 독립 Route Pool | ✅ | 🟠 | 🟡 | 🟡 | 🟡 |
| 다중 분배 전략 및 계층별 오버라이드 | ✅ | 🟡 | ✅ | 🟡 | 🟡 |
| Prompt Cache 친화 라우팅 | ✅ | 🟡 | ✅ | ✅ | ✅ |
| 우선순위 주·백업, 장애 조치, Provider 서킷 브레이커 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| External system, User, API Key 계층 관리 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 주기별 예산, 상태, 모델 접근 제어 | ✅ | ✅ | ✅ | ✅ | ✅ |

### 과금

| 세부 기능 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 카탈로그 가격, Provider 비용, 사용자 청구의 세 원장 | ✅ | ⚪ | ⚪ | ✅ | ⚪ |
| 비즈니스 시간대 기준 시간대별 배율 | ✅ | ⚪ | ⚪ | 🟡 | ⚪ |
| 이미지 / 음성 차등 과금 | ✅ | 🟡 | 🟡 | 🟡 | 🟠 |
| Agent 도구 건별 과금 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### 운영 및 배포

| 세부 기능 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 관리 화면 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 관리 API | ✅ | ✅ | ✅ | ✅ | ✅ |
| 관측성 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SQLite / D1 | ✅ | ✅ | ⚪ | ⚪ | ✅ |
| PostgreSQL | ✅ | ✅ | ✅ | ✅ | ✅ |
| MySQL | ✅ | ✅ | ⚪ | ⚪ | ⚪ |
| Docker 셀프 호스팅 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cloudflare Workers 엣지 배포 | ✅ | ⚪ | ⚪ | ⚪ | ⚪ |

<sup>1</sup> Octafuse의 네이티브 프로토콜 및 멀티모달 지원은 계속 확장 중입니다.

</details>

평가는 각 프로젝트의 현재 공개 저장소와 공식 문서를 기준으로 하며, 해당 기능이 통합 메커니즘으로 내장되어 있는지를 중점적으로 봅니다. 성능, 커뮤니티 규모, 상용 지원, 추가 개발 가능성은 평가 범위에 포함하지 않습니다. 이 비교는 Octafuse의 제품 포지셔닝에 따른 것이며 모든 기능을 종합해 순위를 매기는 표가 아닙니다. 최신 기능과 라이선스는 각 프로젝트의 공식 문서를 확인하세요.

## 빠른 시작

**Node.js 20+**가 필요합니다. Proxy와 Admin은 **두 개의 터미널**에서 동시에 실행해야 합니다.

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
```

터미널 1 — Proxy(`:8787`):

```bash
npm run dev:proxy
```

터미널 2 — Admin(`:8789`):

```bash
npm run dev:admin
```

| 서비스 | 주소 | 설명 |
|------|------|------|
| Proxy | http://127.0.0.1:8787 | 추론 진입점 |
| Admin | http://127.0.0.1:8789 | 관리 콘솔. 로컬 기본 계정은 **`admin` / `admin`**입니다. |

`dev:admin`을 처음 실행하면 `packages/admin/.dev.vars`가 생성됩니다. Admin을 열어 Provider, Route, 사용자 API Key를 설정한 뒤 해당 Key로 Proxy를 호출하세요. 자세한 단계와 `curl` 예시는 [docs/users/quickstart.md](./docs/users/quickstart.md)를 참조하세요.

### Cloudflare에 배포

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

자세한 내용은 [Cloudflare 빠른 배포](./docs/operators/deployment/cloudflare-quickstart.md)를 참조하세요. 프로덕션 환경에서 사용하기 전에 기본 Admin 비밀번호를 변경하고 외부 연동별로 이름이 지정된 최소 권한 Admin API Key를 생성하세요.

Docker 셀프 호스팅과 Postgres / MySQL 데이터베이스 구성은 [배포 문서 인덱스](./docs/operators/deployment/README.md)를 참조하세요.

## 문서

| 작업 | 링크 |
|------|------|
| 기능 맵, Admin 설정, 클라이언트 연동 | [docs/users/](./docs/users/) |
| 로컬 시작 안내 및 요청 예시 | [docs/users/quickstart.md](./docs/users/quickstart.md) |
| API, 통합, 로컬 개발, 아키텍처 | [docs/developers/](./docs/developers/) |
| Cloudflare / Docker / 마이그레이션 | [docs/operators/](./docs/operators/) |
| 릴리스 및 유지관리 | [docs/maintainers/](./docs/maintainers/) |
| HTTP 예시 | [examples/README.md](./examples/README.md) |

## 기여 및 보안

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## 라이선스

이 저장소는 **GNU Affero General Public License v3.0(AGPLv3)**에 따라 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE)를 참조하세요.
