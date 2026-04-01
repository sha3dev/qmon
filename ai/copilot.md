# GitHub Copilot Adapter

- Read `AGENTS.md` and `ai/contract.json` first.
- Fix `error` rules first and treat `warning` rules as review signals, not blind rewrite orders.
- Do not modify managed files unless the user explicitly requests a contract/tooling update.
- Rewrite `README.md` as real package documentation and document public exports and public methods after implementation.
- Run `npm run check` and resolve all failures before finalizing.
