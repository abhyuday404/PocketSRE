# PocketSRE workspace notes

- Use pnpm workspaces and keep shared domain logic in `packages/`.
- Keep `packages/incident-engine` free of Node-only APIs so it runs on React Native.
- Connectors are read-only unless implemented through the explicit action boundary.
- Every AI conclusion must cite evidence IDs that exist in the incident bundle.
- Never place secrets, tokens, raw authorization headers, or model files in the repository.
- The mobile app must retain a deterministic fallback so development and demos do not depend on a model download.
- Run `pnpm typecheck` and `pnpm test` before handing off changes.
