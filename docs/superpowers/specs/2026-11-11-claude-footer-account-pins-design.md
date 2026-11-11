# Claude footer account selection

The user approved choosing Claude accounts in the footer context menu and showing selected accounts side by side. Reuse the existing visibility menu, provider segments, usage source, and responsive overflow. The alternative of adding a separate settings page adds navigation without helping this small selection.

- Under Claude Usage, show independent checkboxes for the current runtime's saved accounts, using their saved names/email fallback. Keep the provider-wide switch and the system-only checkbox when no saved accounts exist.
- Each selected account renders its name and its own consumption. Start with the active saved account, otherwise the first, to preserve the existing one-indicator density until the user chooses more.
- Persist IDs in client UI preferences, scoped by owner and runtime/distro. Preserve selection across renames and reloads. Removed IDs cannot acquire another account's data. Explicitly selecting no accounts shows no Claude indicators, while the Usage menu remains accessible.
- The selection changes presentation only. It never switches authentication, terminals, or chat accounts.
- Use the owner's coupled account/usage snapshot remotely; use the existing local account projection and preview data locally. Missing readings remain pending/unavailable. Poll visible local pinned previews using the existing visibility-aware interval wrapper and existing debounced API; remote streams already refresh their previews.
- Account chips get unique measurement IDs, so two Claude accounts collapse independently into the existing overflow chip. Overflow descriptions include account names. Keep all accounts available in the Usage detail selector.
- Use shared primitives/tokens; support narrow/mobile, light/dark, folder workspaces, and owner/runtime changes. Keep this new UI preference browser-local when paired with older hosts.

Validation: hidden Electron journey selecting both accounts, unchecking one, reloading, selecting none, and restoring them; verify actual persisted UI and unchanged account selection. Check existing narrow-footer E2E, owner-boundary tests, and real-component fixtures.
