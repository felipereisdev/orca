# Claude usage account selector

## Intent and approved approach

The user chose option A in the visual companion: one account selector above the full usage details. The existing footer panel still exposes the old global account switcher, duplicates System default, ignores saved labels, and compresses reset labels into narrow columns.

Use the Orca Select primitive with its existing icon padding, a flat provider heading, selected-account identity, the existing ProviderPanel metrics, and Manage Accounts at the bottom. Use the existing popover shell, tokens, density, and countdown formatting. Keep labels and numbers on readable lines at narrow widths.

## Approaches

- A, selected: account selector plus one detail panel. Compact and consistent with the current provider drill-in.
- B, considered: all account details stacked. Easier comparison, but much taller and needs scrolling with more accounts.

## Behavior

- Show saved account labels, falling back to email. System default is available only when the selected runtime has no saved accounts.
- Selecting an account in Usage only chooses whose metrics to inspect. This is an implementation decision following the consultation-oriented preview; no answer was received to the optional semantic question. It does not select a global authentication account or move existing chats/terminals.
- Start on the active saved account when present, otherwise the first saved account. Never attribute the system login's metrics to that first saved account.
- Use the selected owner's usage snapshot and runtime. An absent reading shows pending/unavailable state rather than another account's numbers.
- Preserve the native-chat account-switch workflow separately through its existing chatAction route.
- Preserve sign-in and Manage Accounts actions for the correct owner, including remote hosts.

## Constraints and exclusions

No new dependencies, palette, type scale, custom select primitive, auth migration, credential changes, or changes to Codex menus. Folder workspaces remain supported. Use hidden Electron/CDP for app validation and standalone fixtures for layout; test launches use ORCA_BACKGROUND_LAUNCH=1.

## Acceptance

The actual Select shows Ucloud and Pessoal without System default, changes the displayed consumption without changing the global account, and keeps the arrow inset using the shared primitive. No saved accounts retains the system view. Validate long names, 336px width, light/dark, missing data, and owner/runtime boundaries.
