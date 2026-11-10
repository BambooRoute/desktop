# Bamboo Desktop

Bamboo Desktop is an open-source desktop client for BambooRoute, based on the official [DeepSeek Harness desktop application](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop).

The goal is to let users install the app, sign in to Bamboo, and use models and local tasks without manually configuring API keys or endpoint URLs.

## Status

Development baseline: a branded desktop shell and local workspace. Bamboo sign-in and model access are not implemented yet.

## Run

Requires Node.js 24.9+, Git, and the upstream native build prerequisites. Currently verified on macOS Apple Silicon.

```sh
npm run setup
npm run build
npm start
```

Setup fetches the commit pinned in `config/upstream.json` and installs its frozen dependencies under `.runtime/`. The first launch downloads and verifies the pinned desktop runtime. Data stays in `.local/bamboo/`; set `BAMBOO_HOME` to use another location. Upstream updates and telemetry are disabled.

Checks: `npm test`, `npm run test:ui`, and `npm run check` after a build.

## Direction

- Reuse the upstream desktop shell, local runtime, and plugin system.
- Keep accounts, model access, pricing, and billing in the BambooRoute backend.
- Use English for repository content and default product copy.

Follow [AGENTS.md](AGENTS.md). Read implementation code directly when available; do not add code comments or extra documentation.

Upstream uses MIT. Preserve its required notices when importing source. The license for Bamboo-authored contributions remains to be selected before distribution.
