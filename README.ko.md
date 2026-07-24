# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway**는 Agent를 위한 셀프 호스팅이 가능한 오픈 소스 AI Gateway입니다. 여러 Provider의 모델과 이미지 생성·편집 기능, Agent Tools, 자체 구축 또는 비공개 배포한 AI 서비스를 하나의 진입점으로 통합합니다. 또한 Route, Key, 예산, 사용량, 감사 기능을 통해 분산된 AI 리소스를 중앙에서 관리하고 스케줄링하며 제어할 수 있습니다. 단순히 모델 요청을 전달하는 데 그치지 않고, Agent가 필요한 리소스와 기능을 탐색하고 호출하며 관리할 수 있도록 지속적으로 확장 가능한 기반을 제공합니다.

**언어:** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **공식 웹사이트:** [octafuse.dev](https://octafuse.dev/en/)

## 핵심 기능

- 통합 AI 리소스 진입점: 하나의 Gateway 주소와 사용자 API Key로 여러 업스트림 모델, 자체 구축 또는 비공개 배포한 모델 서비스, 이미지 기능, Agent Tools에 연결합니다.
- 다중 프로토콜 호환: OpenAI Chat Completions, Anthropic Messages, Gemini, OpenAI Images API와 호환되는 엔드포인트를 제공합니다.
- Route 및 장애 조치: Route 그룹, 우선순위, 가용성을 기준으로 업스트림을 선택합니다. **스티키 라우팅**으로 프롬프트 캐시 적중률을 높이고, 속도 제한이나 장애가 발생하면 자동으로 전환합니다.
- 업스트림 Key 풀: 여러 Provider API Key의 우선순위, 가중치, RPM / TPM 제한, 동시 실행 수, 서킷 브레이커 상태를 중앙에서 관리하고 실시간 잔여 용량에 따라 스케줄링합니다.
- **Provider / 모델 프리셋**: 공식 모델 벤더뿐 아니라 집계 플랫폼과 각종 Coding / Token Plan을 포함한 대량의 가져오기 템플릿을 제공합니다. Base URL과 모델 카탈로그 정보가 미리 채워져, 문서를 찾아다니며 엔드포인트와 모델 목록을 수작업으로 관리하는 비용을 줄입니다.
- 사용자 API Key 및 예산: 개인, 팀, 고객 또는 프로젝트별로 독립적인 Key를 발급하고 주기별 예산, 상태, 메타데이터를 설정할 수 있으며, 사용자는 자신의 잔여 한도를 조회할 수 있습니다.
- 이미지 생성 및 편집: OpenAI Images API 호환 인터페이스로 이미지 모델을 호출하며, 토큰 사용량을 항목별로 산정하는 요금제와 이미지 수 기준 과금을 지원합니다.
- **Agent Tools API**: `/v1/tools/*`를 통해 Agent 도구를 통합 제공하고 호출 로그와 건별 과금을 지원합니다. 현재 웹 검색(`web-search`), 웹페이지 가져오기(`web-fetch`), 심층 검색(`web-deep-search`)을 사용할 수 있습니다.
- **공개 기능 카탈로그**: 사용자 API Key 없이도 `/catalog/models`에서 현재 사용 가능한 모델, 프로토콜, 기능을 확인할 수 있어 포털과 클라이언트가 손쉽게 기능을 탐색하고 연동할 수 있습니다.
- **세 종류의 원장 및 시간대별 가격 정책**: 공급 비용, 모델 카탈로그 가격, 사용자 청구액을 각각 기록하며, 비즈니스 시간대를 기준으로 피크 / 비피크 배율을 설정할 수 있습니다.
- 관측성 및 연동 테스트: 요청, 지연 시간, Token 사용량, 비용, 감사 기록을 한곳에서 확인하고 Playground / Simulator로 Route와 클라이언트 호출을 검증할 수 있습니다.
- 관리 제어 플레인 및 API: Admin 관리 화면과 `/api/admin/*`를 통해 Provider, 모델, Route, 사용자, 설정을 관리하거나 자체 포털 및 자동화 시스템과 연동할 수 있습니다.
- 유연한 배포 방식: **Cloudflare Workers + D1 무료 배포**를 지원하며, Docker + Postgres / MySQL 환경에 셀프 호스팅할 수도 있습니다.

전체 기능, Route 동작 방식, 과금 기준은 [기능 맵](./docs/users/features.md)을 참조하세요.

## 다른 오픈 소스 AI Gateway와의 차이

[New API](https://github.com/QuantumNous/new-api), [LiteLLM](https://github.com/BerriAI/litellm), [Bifrost](https://github.com/maximhq/bifrost)는 각기 다른 강점을 지닌 우수한 오픈 소스 AI Gateway입니다. 기본 기능은 비슷하지만 주요 사용자와 사용 사례가 서로 다르며, Octafuse는 Agent 기능 제공과 리소스 운영에 더 중점을 둡니다. 아래 표는 공개 버전만을 비교한 것으로, 제품의 우열을 의미하지 않습니다.

| 항목 | Octafuse Gateway | New API | LiteLLM | Bifrost |
|------|------------------|---------|---------|---------|
| 통합 제공 기능 | 모델, 이미지, Agent Tools | 모델, 이미지, 오디오·비디오, 문서 리랭킹 | 모델, 이미지, 오디오, 벡터 임베딩, 문서 리랭킹 | 모델, 멀티모달, MCP |
| Route 및 장애 조치 | Route 그룹, 우선순위, 스티키 라우팅, 서킷 브레이커 | 가중치 기반 라우팅, 실패 재시도 | 부하 분산, 재시도, 장애 조치 | 부하 분산, 자동 장애 조치 |
| Key 및 예산 | 업스트림 Key 풀, 사용자 Key, 주기별 예산 | 토큰, 한도, 사용자 | 가상 Key, 프로젝트 / 사용자 예산 | 가상 Key, 계층형 예산 |
| Provider / 모델 프리셋 | **공식 벤더 + 집계 플랫폼 + Coding / Token Plan; Base URL·카탈로그 가격 원클릭 가져오기** | 채널 수동 설정 | 지원 범위 가장 넓음 | 기본 수동 설정 |
| 관리 및 관측성 | 관리 화면 및 API, 로그, 비용, 감사 | 관리 화면, 사용량, 과금 | 관리 콘솔, 로그, 사용량 및 비용 | 관리 화면, 로그, 메트릭, 분산 추적 |
| Docker 배포 | ✓ | ✓ | ✓ | ✓ |
| Cloudflare 엣지 배포 | ✓ | — | — | — |
| 데이터베이스 지원 | D1/SQLite, Postgres, MySQL | SQLite, Postgres, MySQL | Postgres | SQLite, Postgres |
| Agent 지원 | 웹 검색, 웹페이지 가져오기, 심층 검색 등 자주 쓰이는 도구를 내장 | — | MCP, A2A | MCP |
| 과금 기능 | **세 종류의 원장, 시간대별 배율, 도구 건별 과금** | 한도 및 사용량 기반 과금 | 사용량 추적 및 예산 | 계층형 예산 및 사용량 거버넌스 |

“—”는 해당 프로젝트의 공식 공개 문서에 동일한 유형의 기능이 기본 제공된다고 명시되어 있지 않다는 뜻이며, 플러그인, 외부 서비스 또는 별도 개발을 통해 구현할 수 없다는 의미는 아닙니다. 각 프로젝트는 지속적으로 발전하고 있으므로, 구체적인 기능과 라이선스 범위는 각 저장소와 공식 문서를 기준으로 확인하세요.

## 화면 미리보기

| 운영 개요 | 모델 Route |
|---|---|
| ![Octafuse Gateway 운영 개요 화면](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway 모델 Route 화면](./docs/assets/screenshots/routes.png) |

Provider 관리, Playground 등 더 많은 화면은 [docs/assets/screenshots/](./docs/assets/screenshots/)에서 확인할 수 있습니다.

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

자세한 내용은 [Cloudflare 빠른 배포](./docs/operators/deployment/cloudflare-quickstart.md)를 참조하세요. 프로덕션 환경에서 사용하기 전에 기본 Admin 비밀번호를 변경하고 `MASTER_KEY`를 교체해야 합니다.

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
