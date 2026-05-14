# Changelog

## 1.0.1

## 1.0.0

### Major Changes

- [#12](https://github.com/OctaFuse/octafuse-gateway/pull/12) [`6c86fc5`](https://github.com/OctaFuse/octafuse-gateway/commit/6c86fc5afb480e0345b3e67a4a80e57d7fa14ced) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Database & schema (D1 / Postgres / MySQL)

  - Rewrote engine baselines and Drizzle schema: add **`users`** table, slim **`api_keys`** (drop budget fields from keys), rename/replace legacy audit storage with **`user_audit_logs`** (user budget audit), add **`user_id`** on **`request_logs`**, and align analytics SQL.

  ### Core services & write paths

  - Introduce **`user-service`** (`getOrCreateUser`, budget reset, plan updates) and slim **`key-service`** to create/revoke/rename keys only.
  - Route critical writes through **`updateUserBudgetWithAuditTx`** and **`insertRequestUsageAndChargeTx(userId)`**; use conditional **`UPDATE`** on Postgres/MySQL to guard concurrency.
  - Add **`UsersRepository`**, **`UserAuditLogsRepository`**, and **`apiKeys.getApiKeyWithUserByKey`**; remove obsolete **`api_keys`** budget helpers.

  ### Admin API

  - Add **`/admin/users`** CRUD and related sub-resources; trim **`/admin/keys`** (no budget on keys); register **`users-service`** in the admin app.

  ### Admin UI

  - Add **`/gateway/users`** list and detail; rework **`/gateway/keys`** (no budget editing, simplified JOIN display); filter **audit logs** by **`user_id`**.
  - Improve user detail (metadata summary, keys), **API Keys** “New Key” flow, **Audit Logs** UX (snapshot field filters, copy, placeholders), and branding/titles.
  - **Create user** now **requires email** when creating without a user id; DB and forms enforce non-null email.

  ### Audit logging & docs

  - Replace legacy user-audit mapping with the **user budget audit** pipeline; remove deprecated mappers and refresh migration / audit docs.

  ### Tooling & housekeeping

  - Add a **client simulator** to exercise proxy requests locally.
  - Docs: README and conventions; fix admin **session expired** event name; GitHub Actions workflow image description tweak.

## 0.2.2

### Patch Changes

- [#10](https://github.com/OctaFuse/octafuse-gateway/pull/10) [`cbcdbec`](https://github.com/OctaFuse/octafuse-gateway/commit/cbcdbec39047e907ac718050a7d90428c7b5c6ce) Thanks [@dyc87112](https://github.com/dyc87112)! - always create and push root **vX.Y.Z** after `changeset tag` (private workspace default skips `v*` tags)

## 0.2.1

### Patch Changes

- [#8](https://github.com/OctaFuse/octafuse-gateway/pull/8) [`ef46a21`](https://github.com/OctaFuse/octafuse-gateway/commit/ef46a216662527fed64084243b1bacc16dfd0adf) Thanks [@dyc87112](https://github.com/dyc87112)! - release pipeline: inject PAT into checkout/git push for tags, add Docker workflow concurrency, embed CHANGELOG section in GitHub Release notes

## 0.2.0

### Minor Changes

- [#4](https://github.com/OctaFuse/octafuse-gateway/pull/4) [`c83fa69`](https://github.com/OctaFuse/octafuse-gateway/commit/c83fa6977568448988805b9a06f976df9b75d732) Thanks [@dyc87112](https://github.com/dyc87112)! - first release

## 0.1.1

All notable changes to this project are recorded via [Changesets](.changeset/README.md) and merged into this file on each **Version Packages** release PR.

## 0.1.0

Baseline before automated Changesets entries; see git history for prior work.
