# Octafuse Gateway

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/OctaFuse/octafuse-gateway?sort=semver&display_name=tag&color=2f80ed)](https://github.com/OctaFuse/octafuse-gateway/releases)
[![Package Versions](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml/badge.svg)](https://github.com/OctaFuse/octafuse-gateway/actions/workflows/verify-package-versions.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](./docs/operators/deployment/cloudflare-quickstart.md)
[![Docker](https://img.shields.io/badge/Docker-optional-2496ED?logo=docker&logoColor=white)](./docs/operators/deployment/docker.md)

**Octafuse Gateway** は、Agent 向けに設計されたセルフホスト可能なオープンソース AI Gateway です。複数の Provider が提供するモデル、画像生成・編集、Agent Tools、さらに自社運用またはプライベート環境に展開した AI サービスを統合し、分散した AI リソースを単一のエントリーポイントに集約します。Route、キー、予算、使用量、監査を一元管理することで、リソースの運用、振り分け、制御を効率化します。単なるモデルリクエストの中継にとどまらず、Agent に必要なリソースや機能を、検出・呼び出し・管理できる拡張可能な形で提供します。

**言語：** [中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · **公式サイト：** [octafuse.dev](https://octafuse.dev/en/)

## 主な機能

- AI リソースへの統一エントリーポイント：1 つの Gateway URL とユーザー API Key で、複数のアップストリームモデル、自社運用またはプライベート環境のモデルサービス、画像機能、Agent Tools に接続できます。
- 複数プロトコルへの対応：OpenAI Chat Completions、Anthropic Messages、Gemini、OpenAI Images API と互換性のあるエンドポイントを提供します。
- ルーティングとフェイルオーバー：Route グループ、優先度、可用性に基づいてアップストリームを選択します。**スティッキールーティング**によりプロンプトキャッシュのヒット率を高め、レート制限や障害が発生した場合は自動的に切り替えます。
- アップストリームキープール：複数の Provider API Key の優先度、重み、RPM / TPM 制限、同時実行数、サーキットブレーカーの状態を一元管理し、リアルタイムの残容量に応じて振り分けます。
- **Provider / モデルのプリセット**：公式ベンダーに加え、集約プラットフォームや各種 Coding / Token Plan を含む多数のインポートテンプレートを同梱。Base URL とモデルカタログ情報を事前入力できるため、ドキュメントをあちこち調べて手作業で保守する手間を減らせます。
- ユーザー API Key と予算：個人、チーム、顧客、プロジェクトごとに独立した Key を発行し、期間ごとの予算、ステータス、メタデータを設定できます。ユーザー自身による予算残高の確認にも対応します。
- 画像生成・編集：OpenAI Images API と互換性のあるインターフェースから画像モデルを呼び出せます。トークン使用量の内訳に基づく課金と、画像単位の課金をサポートします。
- **Agent Tools インターフェース**：`/v1/tools/*` から Agent ツールを統一的に利用でき、呼び出しログと実行回数に応じた課金に対応します。現在は Web 検索（`web-search`）、Web ページ取得（`web-fetch`）、深掘り検索（`web-deep-search`）をサポートしています。
- **公開機能カタログ**：ユーザー API Key がなくても、`/catalog/models` から現在利用可能なモデル、プロトコル、機能を確認できます。ポータルやクライアントによる機能の検出・連携を容易にします。
- **3 種の台帳と時間帯別料金**：Provider 利用原価、モデルのカタログ価格、ユーザー請求額を個別に記録し、業務で使用するタイムゾーンに合わせてピーク時間帯 / オフピーク時間帯の倍率を設定できます。
- 可観測性と動作確認：リクエスト、レイテンシ、トークン使用量、コスト、監査ログを一元的に確認できます。Playground / Simulator を使って Route やクライアントからの呼び出しを検証できます。
- コントロールプレーンと API：Admin 画面と `/api/admin/*` を使って、Provider、モデル、Route、ユーザー、設定を管理できます。独自のポータルや自動化システムとの連携にも対応します。
- 柔軟なデプロイ方式：**Cloudflare Workers + D1 に無料でデプロイ**できるほか、Docker + Postgres / MySQL によるセルフホストにも対応します。

機能の全体像、ルーティング仕様、課金基準については、[機能マップ](./docs/users/features.md)を参照してください。

## 他のオープンソース AI Gateway との違い

[New API](https://github.com/QuantumNous/new-api)、[LiteLLM](https://github.com/BerriAI/litellm)、[Bifrost](https://github.com/maximhq/bifrost) は、いずれも優れた特徴を持つオープンソース AI Gateway です。基本機能には共通点がありますが、対象ユーザーやユースケースは異なります。Octafuse は、特に Agent 向け機能の提供とリソース運用を重視しています。以下は公開版のみを対象とした比較であり、製品の優劣を示すものではありません。

| 比較項目 | Octafuse Gateway | New API | LiteLLM | Bifrost |
|------|------------------|---------|---------|---------|
| 統一機能エントリーポイント | モデル、画像、Agent Tools | モデル、画像、音声・動画、ドキュメントのリランキング | モデル、画像、音声、ベクトル埋め込み、ドキュメントのリランキング | モデル、マルチモーダル、MCP |
| ルーティングとフェイルオーバー | Route グループ、優先度、スティッキールーティング、サーキットブレーカー | 重み付きルーティング、失敗時の再試行 | ロードバランシング、再試行、フェイルオーバー | ロードバランシング、自動フェイルオーバー |
| キーと予算 | アップストリームキープール、ユーザーキー、期間ごとの予算 | トークン、クォータ、ユーザー | 仮想キー、プロジェクト / ユーザー予算 | 仮想キー、階層型予算 |
| Provider / モデルプリセット | **公式ベンダー + 集約プラットフォーム + Coding / Token Plan；Base URL とカタログ価格をワンクリックインポート** | チャネルを手動設定 | 対応範囲が最も広い | 基本的な手動設定 |
| 管理と可観測性 | 管理画面と API、ログ、コスト、監査 | 管理画面、使用量、課金 | 管理画面、ログ、使用量、コスト | 管理画面、ログ、メトリクス、トレーシング |
| Docker デプロイ | ✓ | ✓ | ✓ | ✓ |
| Cloudflare エッジデプロイ | ✓ | — | — | — |
| データベース対応 | D1/SQLite、Postgres、MySQL | SQLite、Postgres、MySQL | Postgres | SQLite、Postgres |
| Agent 対応 | Web 検索、Web ページ取得、深掘り検索など、よく使われるツールを内蔵 | — | MCP、A2A | MCP |
| 課金機能 | **3 種の台帳、時間帯別倍率、ツールの実行回数に応じた課金** | クォータと使用量に基づく課金 | 使用量の追跡と予算管理 | 階層型予算と使用量管理 |

「—」は、各プロジェクトの公式公開ドキュメントに同種の組み込み機能として記載されていないことを示します。プラグイン、外部サービス、追加開発によって実現できないという意味ではありません。各プロジェクトは継続的に進化しているため、具体的な機能とライセンスの範囲については、それぞれのリポジトリと公式ドキュメントを確認してください。

## 画面プレビュー

| 運用ダッシュボード | モデルルーティング |
|---|---|
| ![Octafuse Gateway の運用ダッシュボード](./docs/assets/screenshots/dashboard.png) | ![Octafuse Gateway のモデルルーティング画面](./docs/assets/screenshots/routes.png) |

Provider 管理や Playground など、その他の画面は [docs/assets/screenshots/](./docs/assets/screenshots/) で確認できます。

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

詳しくは、[Cloudflare クイックデプロイ](./docs/operators/deployment/cloudflare-quickstart.md)を参照してください。本番環境で使用する前に、Admin のデフォルトパスワードを変更し、`MASTER_KEY` をローテーションしてください。

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
