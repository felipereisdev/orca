# Claude usage account selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the Claude Usage account table with the approved account selector and a correctly attributed detail panel.

**Architecture:** Reuse ProviderDetailsMenu as the menu shell and ProviderPanel for metrics. Extend the existing Claude account menu owner with a presentational usage panel; the native-chat switch route keeps its current controls. Pass the footer owner's complete usage and account snapshot through the existing controller so previews never read desktop metrics for a remote host.

**Tech Stack:** React, TypeScript, shadcn/Radix Select, Playwright CDP, component fixtures.

**Spec:** `docs/superpowers/specs/2026-11-11-claude-usage-account-selector-design.md`

## Global Constraints

- No new dependencies, palette, type scale, custom select primitive, auth migration, credential changes, or changes to Codex menus.
- Folder workspaces remain supported.
- Use hidden Electron/CDP for app validation and standalone fixtures for layout; test launches use ORCA_BACKGROUND_LAUNCH=1.

## Review Focus

- The system account is active while named accounts exist: named readings must not inherit system consumption.
- A remote host reuses desktop account IDs: only that host's snapshot can supply its metrics.
- A saved account is removed or needs sign-in: selection falls back to an available row, not stale unrelated data.
- A WSL/runtime selection differs from the polling target: never label another runtime's active metrics as the selected runtime.
- A select opens inside a submenu: keyboard/pointer interaction must keep the usage menu open until dismissed intentionally.

### Task 1: Render and wire the account usage selector

**Files:**

- Create `src/renderer/src/components/status-bar/ClaudeAccountUsagePanel.tsx` and its fixture.
- Modify `ProviderDetailsMenu.tsx`, `ClaudeSwitcherForOwner.tsx`, `ClaudeSwitcherMenu.tsx`, `status-bar-claude-accounts.ts`, `use-status-bar-controller.ts`, `StatusBarSurface.tsx`.
- Test `tests/e2e/claude-account-launch.spec.ts`.

**Interfaces:**

- Consumes `ClaudeStatusSwitchGroup`, `ClaudeRateLimitAccountsState`, owner `RateLimitState`, and existing menu props.
- Produces `ClaudeAccountUsagePanel` with runtime-scoped targets, active usage, per-account previews, loading state, and local view selection. `ProviderDetailsMenu.panelContent?: React.ReactNode` replaces its default identity card when supplied.

- [x] Add an Electron regression journey with system usage 91%, personal 18%, work 3%, no active saved account, and a second owner/runtime boundary. Assert the rendered account metrics change and the actual global selection stays unchanged; absence of saved accounts retains the system view.
- [x] Run the journey against the current build and observe the missing selector failure.
- [x] Extend the existing account group projection to support fallback-only System default and saved labels. Preserve existing chat switching semantics.
- [x] Implement the panel with shared Select and ProviderPanel. Pass owner-specific usage from the status bar, keep the menu open while selecting, and render unavailable/sign-in states without substituting another account's data.
- [x] Add fixtures for populated, empty, narrow/long-name, loading/error, and runtime-mismatch states. Render both themes; inspect the real arrow inset, text wrapping, and metric alignment.
- [x] Rebuild and run the Electron journey plus existing account launch and relevant status-bar tests. Run product typecheck, scoped lint/format, and changed checks; report broad-selection limits.
- [x] Obtain a fresh review of this task's range, fix material findings, commit the change, and leave the user dev instance updated.
