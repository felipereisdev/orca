# SQL grammar provenance

Vendored from [antlr/grammars-v4](https://github.com/antlr/grammars-v4) at commit
`c306207ac870e7c5a95763b518ba3e3a1ca61409` (2026-11-11 checkout).
The PostgreSQL, T-SQL, and PL/SQL grammar files retain their original MIT notices.
The adjacent TypeScript base classes come from the same commit's `Antlr4ng` directories.

`generate-parsers.mjs` applies the upstream target-specific header substitution,
generates with pinned antlr-ng 1.0.10, and bundles against antlr4ng 3.0.16.
Generated outputs are ignored; builds regenerate from these checked-in inputs without network access.

These parsers recognize syntax. Orca's query-policy visitors and database permissions
separately restrict execution; parsing alone is not authorization.
