# Contributing to Octafuse Gateway

Thanks for your interest in improving this project.

## License and CLA

This repository is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](./LICENSE).

**By contributing** (including pull requests, issues with proposed code or text you intend to be merged, or other material you submit for inclusion in the project), you agree that:

1. Your contribution is licensed under **AGPL-3.0** in accordance with the terms of that license; and  
2. You grant the project maintainers a **perpetual, worldwide, non-exclusive** license to use, modify, and redistribute your contribution **under other terms as well**, including a **commercial / proprietary license**, without additional compensation from the maintainers.

The second point is intended to keep a path open for a future **“community AGPL + optional commercial license”** model. If the project later decides to remain AGPL-only, this paragraph can be narrowed or removed in a single policy update.

## How to contribute

- **Bugs & features**: open an issue using the templates in [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/) when possible.  
- **Pull requests**: use [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md); keep changes focused; match existing style (TypeScript formatting, commit messages).  
- **Docs & SQL**: follow the conventions described in [docs/README.md](./docs/README.md) and migration notes in the repository.

## Code of conduct

All participants are expected to follow the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md).

## Development

See the root [README.md](./README.md) for install, `npm` scripts, and Docker-based workflows. Run relevant smoke tests (for example `npm run test:gateway:postgres-smoke`) before submitting substantial changes when applicable.
