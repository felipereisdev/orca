# Claude por conta — implementação e validação

Branch: `feat/claude-account-launch`, baseada em `6d3d8245b2`.

O menu de nova aba mantém Claude e acrescenta as contas guardadas, com nomes opcionais em Definições → Contas. Cada variante abre Terminal ou Chat com a conta escolhida. A escolha acompanha a sessão, receitas de retoma, conversões, fingerprints e catálogos. O host resolve o ID para o perfil e recusa contas removidas ou sem login correspondente. Hosts antigos não recebem pedidos explícitos sem suporte.

## Validação

- 313 testes passaram, 5 ignorados pelas condições existentes, em 91 ficheiros (mais 2 ignorados), nas suites de contas, Chat, persistência, catálogos, fork, RPC, PTY e menu.
- Um cenário Electron oculto passou, viewport 1280×900, tema escuro, workspace de pasta: Empresa/Terminal e Pessoal/Chat, depois o inverso; troca global antes do envio; diretório real recebido pelo processo; remoção de headers herdados; drafts independentes e abertura por teclado.
- Fixtures do menu revistas nos temas claro e escuro e larguras 390/1280.
- `pnpm tc`, lint/format e qualidade do código alterado passaram. No check geral final, 37 dos 38 checks passaram; o único não concluído foi o conjunto automático de testes afetados.

O CLI usado no E2E é um processo de teste que implementa o protocolo Claude. Não foram usados logins reais nem alterado o perfil da aplicação em execução. As capturas estão em `test-results/claude-account-launch-laun-682d1-hout-changing-their-binding-electron-headless/`.

A revisão independente encontrou três problemas importantes, todos reproduzidos e corrigidos: preflight do Terminal sobrepunha a conta global, providers repunham headers de autenticação herdados e descoberta de modelos conservava credenciais herdadas. Os novos testes falharam antes das correções e passaram depois.

## Limites

- O check automático de testes afetados pelo grafo de imports excedeu quatro minutos. No último run, com limite de um minuto, o único check não concluído foi essa execução automática. Foram executadas as suites focadas acima; isto não equivale à suite completa.
- `typecheck:e2e` encontra módulos cloud `@orca-cloud/relay-contract` não resolvidos e declarações dos stubs mobile neste ambiente. O cenário executável de Electron passou; o typecheck de produto passou.
- Windows/WSL e hosts remotos não foram exercitados em máquinas reais. As guardas de runtime, negociação de capacidades e testes WSL existentes foram considerados.
- Restauração/conversão têm cobertura de host e persistência; o cenário renderizado valida novas sessões, não um reinício completo da aplicação.
- Nomes iguais podem continuar visualmente ambíguos no menu normal. A edição dos nomes permite distingui-los; desambiguação automática fica adiada como observação menor.
- Mantém-se a política existente de partilha de histórico/configuração entre perfis; a funcionalidade fixa a autenticação por sessão.

## Decisões registadas

- Ruling: Use a native git worktree outside the project — the installed Orca runtime does not manage this checkout, so its worktree command cannot target it without adding unrelated app state — cost: checkout is visible as a separate path rather than an Orca-managed worktree.
- Ruling: Follow repository test policy over generic TDD instructions — no new tests for trivial display-name plumbing; add behavior tests at account routing, host replay and rendered launch boundaries — cost: label plumbing relies on typechecking and existing service coverage.
- Task 1: Ruling: Extract name input/RPC declaration and existing reset-result type to stay within lint module-size limits; no behavior change to reset flow — cost: three focused files to navigate.
- Task 2: Ruling: Router test owns explicit profile selection; existing runtime-auth-service tests replace both routers with fakes and would only assert forwarding. Added real-router tests instead — cost: service runtime-target validation still needs existing WSL coverage.
- Task 3: Ruling: Also retain the account ID in the existing launchConfig.agentEnv recipe as ORCA_CLAUDE_ACCOUNT_ID — several legacy restore routes already persist this recipe, so the ID survives without trusting persisted credential paths — cost: typed field and environment identity must remain consistent.
- Ruling: Consolidate implementation into a coherent final feature commit — runtime/controller and generated RPC files are shared across tasks, and partial staging obscures validation — cost: review will cover the whole feature rather than small commit checkpoints.
- Task 3: Ruling: Reuse existing agentLaunchConfigByPaneKey and persisted sleeping launch recipes instead of adding claudeAccountIdsByLeafId — the existing registry already owns per-pane persistence, retirement and snapshots — cost: account display/conversion must read the recipe when a terminal is the source.
- Ruling: Extract existing account-home/read and path helpers into their domain owners to retain the 300-line module gate — avoids lint suppressions — cost: additional imports/reexports.
- Ruling: Use actual profile-router, record-founding, catalog-service and fork-admission tests rather than forwarding-only service mocks — tests detect wrong account resolution, persisted binding and cache reuse — cost: Electron scenario must cover menu-to-process wiring separately.
- Ruling: Dispatch whole-branch reviewer while the final Electron validation runs — runtime implementation is committed and stable, allowing independent review without pausing verification — cost: any E2E-driven changes must retain regression evidence.
- Final: Ruling: Keep quota rotation and complete history/config isolation excluded — user/spec scope uses existing account folders — cost: accounts still share the existing history/config-linking policy.
- Final: Ruling: Keep Agent Teams and other providers unchanged — requested variants belong only to Claude — cost: no account-specific Agent Teams entries.
- Final: Ruling: Validate platform-independent routing and existing WSL suites here; actual Windows/WSL and rendered restore/conversion journeys remain for those environments — local host is macOS — cost: no live Windows/WSL proof.
- Final: Ruling: Preserve the feature branch and worktree — the request authorizes implementation; publishing/integration was not requested — cost: the running application and main checkout do not yet include the feature.
