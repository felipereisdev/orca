# Claude usage account selector verification

Base: `60e84ff741`. User selected visual option A and requested an inset chevron.

## Result

The Claude usage menu now uses the shared Orca Select, saved labels, and existing ProviderPanel metrics. System default remains only for runtimes without saved accounts. Selection is a local consultation view; it does not change the global login or existing sessions. Manage Accounts opens on the displayed owner.

Remote roster and consumption come from the same retained accounts snapshot. Switching owners cannot reuse a previous owner's readings. Contact loss marks all saved-account preview collections unverifiable, including the adjacent Codex/Antigravity collections. The native-chat account switch route retains its existing controls.

## Evidence

- Electron regression failed before implementation because the account selector was absent; passed after implementation with personal 18%, work 3%, and system 91% kept distinct.
- The Electron journey covers pointer selection, keyboard open, Escape/focus restoration, an unrelated default remote host, fallback System default when accounts are empty, and both accounts in Terminal/Chat.
- Three snapshot-boundary tests failed before the review fixes and passed afterward: paired roster/readings, remote disconnection, owner switch with matching account IDs.
- Five focused test files, 13 tests passed. Existing native-chat usage and account-row keyboard tests remain green.
- Sixteen real-component screenshots passed, eight states in both light/dark, including 336px/long names, open selector, missing readings, loading, sign-in, stale errors, and no accounts. Inspected standard, narrow, and open-select screenshots.
- Product typecheck, scoped lint, changed-code quality, localization, and the focus-read ratchet passed. Removed only the retired ClaudeSwitcherMenu baseline entry.
- Broad changed checks passed 36/37 gates; related unit selection exceeded the explicit one-minute limit. Focused tests passed separately. No live remote host was contacted; remote cases use the repository's published snapshot contract.
- Fresh review found and then cleared three Important owner-boundary issues. No remaining Important/Critical findings.

## Local runtime

The user's existing development instance receives these renderer changes through HMR. No production build or installation is required. No push or merge was performed.
