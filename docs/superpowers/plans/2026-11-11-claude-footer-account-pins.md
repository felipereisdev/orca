# Claude footer account selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show independently selected Claude account usage indicators side by side in the footer and persist the selection.

**Architecture:** Extend client UI preferences with an owner/runtime-scoped account-ID map. Project footer entries from the existing provider list and authoritative account data; keep the Usage roster independent. Reuse existing provider rendering and width measurements with unique entry IDs.

**Tech Stack:** TypeScript, React, Zustand, shadcn DropdownMenu, Playwright CDP.

**Spec:** `docs/superpowers/specs/2026-11-11-claude-footer-account-pins-design.md`

## Global Constraints

- UI-only selection: no authentication or session migration.
- Scope preferences by owner/runtime; paired browser preferences remain client-local.
- Shared Orca primitives/tokens, visibility-aware polling, unique collapse identities.
- Hidden tests with ORCA_BACKGROUND_LAUNCH=1; no focus activation.

## Review Focus

- Same account IDs on two owners or runtimes must not share selection or readings.
- Missing/removed accounts must not display the system account's consumption.
- Zero selections must retain a usable entry point to Usage.
- Duplicate provider IDs must not collapse two account chips together.
- Refreshes and hydration must not reset saved selections or send new keys to older paired hosts.

### Task 1: Persist and render selected footer accounts

**Files:**

- New `src/shared/status-bar-account-selection.ts`; extend persisted UI types/defaults/RPC schema, UI slice preference/hydration, desktop/web normalization, pairing-local fields, and WSL UI disposition.
- New `src/renderer/src/components/status-bar/status-bar-usage-entries.ts` and `use-claude-footer-accounts.ts`.
- Extend `use-status-bar-controller.ts`, `StatusBarSurface.tsx`, `StatusBarVisibilityMenu.tsx`, `StatusBarProviderSegment.tsx`, and `usage-unit-label.tsx`; extract the Claude visibility subsection to keep files focused.
- New `tests/e2e/claude-footer-accounts.spec.ts`, fixture, and focused projection tests only for owner/runtime attribution cases not covered by the UI journey.

**Interfaces:** `StatusBarUsageEntry { id, limits, accountLabel? }`; owner/runtime `scopeKey`; selected account IDs; `setStatusBarClaudeAccounts(scopeKey, ids)` persists the presentation preference.

- [x] Add and run the failing Electron journey for account checkboxes and independent indicators.
- [x] Add the preference contract, persistence paths, and browser-local pairing classification.
- [x] Build owner/runtime-scoped footer entries from named account readings, and refresh selected local previews without a new raw timer.
- [x] Add the account visibility submenu, named segments, empty selection entry point, and independent overflow identities.
- [x] Verify Electron selection/reload/no-default-mutation, narrow overflow, owner boundaries, fixtures in both themes, typecheck/lint/changed checks.
- [x] Obtain a fresh review, fix material issues, commit locally, and update the existing dev instance.
