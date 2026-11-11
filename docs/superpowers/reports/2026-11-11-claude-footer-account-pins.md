# Claude footer account selection verification

Base: `454822306b`. The user approved account checkboxes and independent side-by-side footer indicators.

## Delivered

- Right-click footer → Claude Usage → independent saved-account checkboxes, with the existing provider-wide switch retained.
- Saved account names and correctly attributed usage in each selected footer chip. Explicitly selecting none retains the Usage entry point.
- Client-local, owner/runtime-scoped ID preferences survive reload and renames. Removed IDs cannot inherit system consumption. Browser pairings keep separate scopes and never send this preference to older hosts.
- Existing visibility-aware polling refreshes selected local previews; manual Refresh also refreshes them. Remote views use the existing coupled account/usage stream.
- Unique measurement identities support independent collapsing and account names in overflow descriptions.

## Evidence

- New Electron journey failed on the missing account submenu before implementation. It now verifies two visible accounts, unchecking one, reload persistence, empty selection, and unchanged authentication selection.
- Manual-refresh regression failed with stale 3% after clicking Refresh, then passed with 13% after the integration fix.
- Explicit 340×800 viewport verifies one Claude chip remains visible while the other collapses into +1, then both expand at 1280×800.
- Three Electron journeys passed together: footer selection, both account launches in Terminal/Chat, and ten-provider narrow-footer density.
- Four focused unit files passed, 47 tests, covering owner/runtime isolation, same IDs across owners, removed selections, remote saved accounts with unavailable system login, desktop-only configuration exclusion, paired browser ownership/re-pairing, and browser-local preference preservation.
- Eight real-component fixture screenshots passed in both themes; inspected the two-account strip, visibility menu, and narrow overflow.
- Product typecheck and lint passed. Changed-code quality, localization, host-list, timer, RPC catalog and other static gates passed. Broad related unit selection exceeded the explicit one-minute cap; scoped tests passed independently.
- Fresh review cleared remote-only visibility, paired-browser fallback ownership, and manual inactive-account refresh findings. No remaining Important/Critical source findings.

## Development instance

Reloaded the existing renderer over CDP without activating the window. Verified the footer renders and the new preference can be saved/read through its real UI API while preserving existing choices. No authentication selection was changed. No live SSH host was used for validation; remote cases exercise the published snapshot boundary.

No push or merge was performed.
