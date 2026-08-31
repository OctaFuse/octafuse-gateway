# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** は、Agent 向けに設計されたセルフホスト可能なオープンソース AI Gateway です。複数の Provider が提供するモデル、OpenAI Responses、画像生成・編集、ASR / TTS / リアルタイム音声、Agent Tools、さらに自社運用またはプライベート環境に展開した AI サービスを統合し、分散した AI リソースを単一のエントリーポイントに集約します。Route、キー、予算、使用量、監査を一元管理することで、リソースの運用、振り分け、制御を効率化します。単なるモデルリクエストの中継にとどまらず、Agent に必要なリソースや機能を、検出・呼び出し・管理できる拡張可能な形で提供します。

**言語：** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **公式サイト：** [octafuse.dev](https://octafuse.dev/en/)

## 主な機能

Octafuse Gateway の中核的な目標は、**一人会社（OPC）や企業向けの統合 AI 機能ハブを構築すること**です。保有するマルチモーダル AI リソースと多様なツールを一元的に接続し、配信、課金、運用管理までを統合します。

主な機能は次のとおりです。

1. Provider の接続：任意のモデルベンダーや集約プラットフォームを接続できます。Coding / Token Plan を含む多数のプリセットからエンドポイントをワンクリックでインポートし、対応する API Key を追加するだけで利用できます。対応一覧は [Providers Catalog](https://octafuse.dev/en/catalog/providers/) を参照してください。新しい Provider の PR も歓迎します。
2. AI モデルの接続：組み込みカタログからモデルをインポートでき、一般的なパラメータや価格を個別に設定する必要がありません。対応一覧は [Models Catalog](https://octafuse.dev/en/catalog/models/) を参照してください。新しいモデルの PR も歓迎します。
3. 複数プロトコルへの対応：
    - OpenAI エンドポイント：
      - Chat Completions：`POST /v1/chat/completions`
      - Responses：`POST /v1/responses`
      - Images：`POST /v1/images/generations`、`POST /v1/images/edits`
      - Audio：`POST /v1/audio/transcriptions`、`POST /v1/audio/speech`
      - Models：`GET /v1/models`
    - Anthropic エンドポイント：`POST /v1/messages`
    - Google Gemini エンドポイント：`POST /v1beta/models/{model}:generateContent`（`streamGenerateContent` を含む）
    - DashScope 同期マルチモーダル ASR：`POST /v1/dashscope/services/aigc/multimodal-generation/generation`
    - DashScope リアルタイム音声：`GET /v1/dashscope/realtime`
4. Protocol の適合と変換：クライアントとアップストリームの Protocol 変換を Route で選択でき、使い慣れた呼び出し方式のまま異なる Provider を利用できます。たとえば、OpenAI Images クライアントから Alibaba Cloud Model Studio の Qwen Image / Wan Image モデルを呼び出せます。
5. Agent ツールの接続：`/v1/tools/*` で Agent 向けツールを統一的に提供し、ログ、課金、コスト管理を一元化します。モデルとツールを同じ Gateway から利用できます。
    - Web 検索（`POST /v1/tools/web-search`）：Bocha、Tavily、Alibaba Cloud CleverSee、Tencent Cloud WSA
    - Web ページ取得（`POST /v1/tools/web-fetch`）：Firecrawl、Tavily Extract、Jina Reader
    - 深掘り検索（`POST /v1/tools/web-deep-search`、検索 + 読み取り）：Firecrawl Search、Jina Search
    - AI 生成テキスト検出（`POST /v1/tools/ai-detection`）：Tencent Cloud TMS を実装済みで、複数エンジンへ拡張できるカタログを用意しています
    - Agent 向けツールは今後も追加予定で、PR も歓迎します。
6. AI 機能の統一エンドポイント：接続したモデル、プラットフォーム、ツールは、デプロイ済み Octafuse Gateway の Base URL から提供されます。クライアントが覚える接続先は 1 つだけです。
7. 複数のルーティング戦略：同じモデルに複数のアップストリームリソースがある場合、用途に応じて次の戦略を選択できます。
    - `hash_affinity`：既定の戦略。同一ユーザー、モデル、プロトコルを安定して同じアップストリームに割り当て、**Prompt Cache のヒット率を高める**ため、キャッシュやセッション継続性を重視する用途に適します。短時間のトラフィックは完全に均等にならない場合があります
    - `weighted_random`：重みに応じてランダムに分配し、**高い負荷分散性**を実現します。コストの比率配分や A/B テストに適しますが、同じユーザーでも Provider が頻繁に変わり、キャッシュヒット率が下がる可能性があります
    - `weight_priority`：重みの高い順に固定して試行する決定的な戦略です。同一優先度内で明確なプライマリ / バックアップを構成する用途に適しますが、先頭の Provider に大部分のトラフィックが集中します
    - `weighted_round_robin`：重みに基づくローテーションで、より均等にトラフィックを分配します。カウンターは実行インスタンスごとに管理され、複数インスタンス間では同期されません
8. ユーザー管理と会計の統合：
    - External system、User、API Key の 3 階層：External system でシステムやチームを分離し、API Key で認証、課金、監査を行います
    - 2 種類のクォータ：周期クォータはサブスクリプション、永久クォータは追加購入に利用でき、両方を同時に使えます
    - 3 種の台帳：各呼び出しについて、カタログ価格、実際の Provider 原価、ユーザー請求額を個別に記録します
    - ピーク / オフピーク料金：モデルと Route の価格を時間帯や曜日ごとに設定し、実際の価格をプレビューできます
    - モデル別ユーザー倍率：ユーザーとカタログモデルの組み合わせごとに割引、割増、無料化を設定でき、カタログ価格や Provider 原価は変更しません
9. 管理画面と管理 API：
    - 手動運用にも外部ポータル連携にも利用できる管理画面と API
    - リクエスト詳細、統計、運用分析を確認できる可観測性とデータ分析
    - Provider、モデル、Route、クライアント設定を素早く検証できる Playground / Simulator。リアルタイム音声認識もテストできます
10. 柔軟なデプロイ方式：
    - **Cloudflare Workers + D1 への無料デプロイ**
    - Docker + Postgres / MySQL によるデプロイ

## 管理画面の概要

| Provider の接続 | Request Surface → 戦略 → Upstream Target の Route 構成 |
|---|---|
| ![Provider：Key の状態、Protocol 機能、Route 数をカードで表示](./docs/assets/screenshots/providers.webp) | ![Route：Request Surface、Route Pool、戦略、スティッキー、フェイルオーバーを階層表示](./docs/assets/screenshots/routes.webp) |

Providers ページではアップストリームアカウントと Protocol Endpoint を接続します。Routes ページではクライアントの Request Surface、Route 戦略、Upstream Target を一つの流れとして確認できます。設定手順の全体は [管理画面設定ガイド](./docs/users/configuration.md) を参照してください。

## 他のオープンソース AI Gateway との違い

[New API](https://github.com/QuantumNous/new-api)、[LiteLLM](https://github.com/BerriAI/litellm)、[Sub2API](https://github.com/Wei-Shaw/sub2api)、[Bifrost](https://github.com/maximhq/bifrost) は、それぞれ異なる強みを持つ成熟したオープンソース AI Gateway です。Octafuse は **Agent 機能の提供と AI リソース運用**をより重視しており、主な違いは次の 5 つの領域にあります。

| 重点領域 | Octafuse の組み込み機構 | 適した用途 |
|---|---|---|
| Agent 機能 | Web 検索、Web 取得、深掘り検索、ツール呼び出しログと課金 | 1 つの Gateway から Agent にモデルとツールを提供 |
| リソース接続 | Provider / モデルプリセット、マルチプロトコルエンドポイント、ワンクリックインポート | 分散した AI リソースの一元管理 |
| 高度なルーティング | 独立 Route Pool、階層ポリシー、キャッシュ親和性、フェイルオーバー、サーキットブレーカー | 信頼性、キャッシュヒット率、コストのバランス調整 |
| 運用と課金 | カタログ価格、Provider 原価、ユーザー請求の 3 台帳と、時間帯別・マルチモーダル課金 | 内部原価管理、クォータ管理、外部向けサービス |
| 柔軟なデプロイ | 複数データベース対応の Docker、または Cloudflare Workers + D1 | セルフホスト、エッジデプロイ、低コストでの導入 |

**評価基準：**

- **✅ 完備**：公開版において、この項目の主要なユースケースを網羅する一体的な仕組みを提供
- **🟡 良好**：中核機能は成熟しているものの、対応範囲または運用面の深さが比較的限定的
- **🟠 基本**：利用可能な基礎機能はあるものの、外部コンポーネントや追加開発への依存が大きい
- **⚪ なし**：公式公開ドキュメントに同種の組み込み機能として記載なし

<details>
<summary><strong>機能比較の全 24 項目を表示</strong></summary>

### 接続と Agent 機能

| 機能の評価項目 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| Provider / モデルプリセットとワンクリックインポート | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| OpenAI、Anthropic、Gemini の主要 Protocol Endpoint | ✅ | ✅ | ✅ | ✅ | ✅ |
| DashScope ネイティブ同期 / リアルタイム音声と Protocol 変換 Route | ✅¹ | ⚪ | ⚪ | ⚪ | ⚪ |
| テキスト、画像、音声、動画などのマルチモーダル対応 | 🟡² | ✅ | ✅ | 🟡 | ✅ |
| Web 検索、取得、深掘り検索の内蔵 | ✅ | ⚪ | 🟠 | 🟠 | 🟠 |
| ツール Provider 設定、呼び出しログ、課金 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### ルーティングとガバナンス

| 機能の評価項目 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| プロトコル / operation 単位のリクエスト入口と独立 Route Pool | ✅ | 🟠 | 🟡 | 🟡 | 🟡 |
| 複数の分配戦略と階層別オーバーライド | ✅ | 🟡 | ✅ | 🟡 | 🟡 |
| Prompt Cache 親和性ルーティング | ✅ | 🟡 | ✅ | ✅ | ✅ |
| 優先度による主従構成、フェイルオーバー、Provider サーキットブレーカー | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| External system、User、API Key の階層管理 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| 期間予算、状態、モデルアクセス制御 | ✅ | ✅ | ✅ | ✅ | ✅ |

### 課金

| 機能の評価項目 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| カタログ価格、Provider 原価、ユーザー請求の 3 台帳 | ✅ | ⚪ | ⚪ | ✅ | ⚪ |
| 業務タイムゾーンに基づく時間帯別倍率 | ✅ | ⚪ | ⚪ | 🟡 | ⚪ |
| 画像 / 音声の差異化料金 | ✅ | 🟡 | 🟡 | 🟡 | 🟠 |
| Agent ツールの呼び出し回数課金 | ✅ | ⚪ | 🟡 | 🟠 | 🟠 |

### 運用とデプロイ

| 機能の評価項目 | Octafuse | New API | LiteLLM | Sub2API | Bifrost |
|---|:---:|:---:|:---:|:---:|:---:|
| 管理画面 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 管理 API | ✅ | ✅ | ✅ | ✅ | ✅ |
| 可観測性 | ✅ | ✅ | ✅ | ✅ | ✅ |
| SQLite / D1 | ✅ | ✅ | ⚪ | ⚪ | ✅ |
| PostgreSQL | ✅ | ✅ | ✅ | ✅ | ✅ |
| MySQL | ✅ | ✅ | ⚪ | ⚪ | ⚪ |
| Docker セルフホスト | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cloudflare Workers エッジデプロイ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ |

<sup>1</sup> Octafuse は DashScope ネイティブ同期 ASR、リアルタイム ASR / TTS に対応し、OpenAI 互換の ASR / TTS リクエストを DashScope へ Protocol 変換して Route できます。
<br />
<sup>2</sup> Octafuse は現在、テキスト、画像、ASR、TTS、リアルタイム音声に対応しています。動画はまだ統一 Request Surface に含まれていません。

</details>

評価は各プロジェクトの現在の公開リポジトリと公式ドキュメントに基づき、機能が一体的な仕組みとして組み込まれているかを重視しています。性能、コミュニティ規模、商用サポート、追加開発の可能性は評価対象外です。この比較は Octafuse の製品ポジショニングに沿ったものであり、各プロジェクトの全機能を総合的に順位付けするものではありません。最新の機能とライセンスについては、各プロジェクトの公式ドキュメントを確認してください。

## クイックスタート

**Node.js 20+** が必要です。Proxy と Admin は、**2 つのターミナル**で同時に起動してください。

```bash
git clone https://github.com/OctaFuse/octafuse-gateway.git
cd octafuse-gateway
npm install
npm run db:migrate
```

ターミナル 1 — Proxy（`:8787`）：

```bash
npm run dev:proxy
```

ターミナル 2 — Admin（`:8789`）：

```bash
npm run dev:admin
```

| サービス | URL | 説明 |
|------|------|------|
| Proxy | http://127.0.0.1:8787 | 推論エンドポイント |
| Admin | http://127.0.0.1:8789 | 管理コンソール。ローカル環境のデフォルトアカウントは **`admin` / `admin`** |

`dev:admin` の初回実行時に `packages/admin/.dev.vars` が生成されます。Admin を開いて Provider、Route、ユーザー API Key を設定し、その Key で Proxy を呼び出してください。詳しい手順と `curl` の例については、[docs/users/quickstart.md](./docs/users/quickstart.md)を参照してください。

### Cloudflare へのデプロイ

```bash
npx wrangler login
npm run bootstrap:cloudflare
```

詳しくは、[Cloudflare クイックデプロイ](./docs/operators/deployment/cloudflare-quickstart.md)を参照してください。本番環境で使用する前に、Admin のデフォルトパスワードを変更し、外部連携ごとに名前付き・最小権限の Admin API Key を作成してください。

Docker によるセルフホストと Postgres / MySQL の構成については、[デプロイドキュメント一覧](./docs/operators/deployment/README.md)を参照してください。

## ドキュメント

| 目的 | リンク |
|------|------|
| 機能マップ、Admin の設定、クライアント連携 | [docs/users/](./docs/users/) |
| ローカル環境での導入とリクエスト例 | [docs/users/quickstart.md](./docs/users/quickstart.md) |
| API、インテグレーション、ローカル開発、アーキテクチャ | [docs/developers/](./docs/developers/) |
| Cloudflare / Docker / マイグレーション | [docs/operators/](./docs/operators/) |
| リリースとメンテナンス | [docs/maintainers/](./docs/maintainers/) |
| HTTP の例 | [examples/README.md](./examples/README.md) |

## コントリビューションとセキュリティ

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [SECURITY.md](./SECURITY.md)
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)

## ライセンス

本リポジトリは、**GNU Affero General Public License v3.0（AGPLv3）** に基づいて提供されています。詳しくは [LICENSE](./LICENSE) を参照してください。
