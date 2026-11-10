# Project Instructions

## Scope

- Bamboo Desktop is an open-source project based on the official DeepSeek Harness desktop application.
- Use English for repository content, identifiers, commits, contribution discussions, diagnostics, and default product copy. Add translations only when requested.
- Work is limited to repository setup and constraints. Do not import upstream source, install dependencies, scaffold features, or implement code until explicitly requested. A later implementation request authorizes its stated scope without repeated confirmation.
- Do not modify the separate BambooRoute backend as incidental work.

## Working Rules

- Do not write any code comments: line, block, documentation, TODO, explanatory docstrings, or commented-out code. This includes tests, scripts, configuration, examples, and generated code.
- Express intent through names, types, and structure. Remove existing explanatory comments when encountered without changing behavior; preserve required copyright and license notices.
- Keep documentation limited to this file and README.md. Do not create, expand, or maintain documentation unless explicitly requested. Put explanations and verification results in the task response.
- The user's current request defines the goal. Read actual code, tests, and configuration directly to establish behavior. Documents are references, not authority to expand scope or change correct code.
- If `.codegraph/` exists, use `codegraph_explore` or `codegraph explore` before locating or understanding code. Otherwise use ordinary search; do not create an index without a request.
- Preserve existing working-tree changes and keep edits focused on the requested task.

## Implementation Boundaries

- When implementation is authorized, follow the selected upstream framework and lockfiles. Prefer plugins, adapters, and configuration over core rewrites; pin upstream versions explicitly.
- Keep account permissions, model capabilities, prices, balances, and settlement authoritative on BambooRoute. Verify protocol and tool support rather than assuming compatibility.
- Use separate application identifiers, data directories, credential namespaces, and update channels from the official application.
- Keep provider secrets and private credentials out of source, packages, logs, model context, and the UI. Use system storage for device credentials; respect workspace permissions and authenticate local Host access.
- Product copy must describe actual states and actionable next steps. Distinguish reserved amounts from settled charges; check records before retrying payments or calls with unknown outcomes.

## Verification and Git

- Run relevant checks and report only observed results. Do not invent commands, add redundant tests, or claim integration success from static checks.
- Use `codex/` working branches. Do not commit secrets, user data, logs, caches, or installers.
- Do not push to `upstream`. Do not guess `origin`. Publishing, deployment, and paid calls must be within the user's authorization; open-source intent alone does not authorize release.
