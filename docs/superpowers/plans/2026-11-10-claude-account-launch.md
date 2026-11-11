# Claude Account Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escolher `Claude (Pessoal)` ou `Claude (Empresa)` no menu de nova aba e executar as duas contas em simultâneo, em Terminal ou Chat, conservando a conta de cada sessão.

**Architecture:** Transportar `claudeAccountId` do menu até ao host, resolver o perfil sem alterar a seleção global e persistir a escolha na sessão/pane. Reutilizar os routers, os serviços de contas e os fluxos de lançamento atuais. Separar a escolha persistida da observação `acquiredAccount` e negociar o novo contrato com hosts remotos.

**Tech Stack:** TypeScript, React/Zustand, Electron, RPC/Zod, serviços de contas e perfis Claude existentes, Vitest, Playwright/CDP e component fixtures.

**Spec:** [2026-11-10-claude-account-launch-design.md](../specs/2026-11-10-claude-account-launch-design.md)

## Global Constraints

- Reutilizar os perfis Claude existentes; não copiar tokens nem trocar a autenticação global.
- Guardar apenas IDs e metadados; caminhos e credenciais são resolvidos no host de execução.
- Uma seleção explícita nunca pode cair silenciosamente noutra conta.
- Preservar o comportamento de pedidos e sessões antigos sem conta explícita.
- Respeitar as capacidades existentes de Terminal e Chat em macOS, Linux, Windows, WSL e hosts remotos.
- Suportar folder workspaces e clientes móveis através dos mesmos contratos do host.
- Seguir `docs/STYLEGUIDE.md`, os tokens existentes e os componentes shadcn atuais.
- Executar testes e apps com `ORCA_BACKGROUND_LAUNCH=1`; não mostrar janelas nem tomar foco.
- Adicionar testes apenas para comportamentos relevantes, na camada que os possui, com resultados esperados independentes da implementação.
- Executar `pnpm check:changed` depois da última alteração e imediatamente antes de qualquer push; nunca usar `--no-verify`.

## Review Focus

1. Arranques concorrentes com uma troca global entre eles: cada processo usa a conta pedida, independentemente da ordem de conclusão. Prova: cenário renderizado da tarefa 6.
2. Reinício, retoma, conversão e replay após mudança da predefinição: a escolha permanece; alterar a conta num replay causa conflito. Prova: testes de host da tarefa 4 e restauração da tarefa 6.
3. Conta removida, runtime diferente, perfil legado dependente de System default ou credenciais herdadas: recusar ou pedir autenticação na conta pedida. Prova: serviço de resolução da tarefa 2.
4. Duas variantes com o mesmo agente, nomes iguais ou catálogos diferentes: identidade, opções e drafts permanecem separados. Prova: catálogo da tarefa 4 e interação renderizada da tarefa 6.
5. Host antigo ou catálogo WSL desatualizado: a seleção explícita não desaparece durante transporte, fallback ou reconexão. Prova: testes de fronteira das tarefas 2–4.

---

## Sequência e limites

Executar pela ordem abaixo. Recomenda-se execução sequencial na mesma sessão: Terminal, Chat e menu dependem do mesmo contrato e as alterações cruzam os mesmos tipos. Cada tarefa termina num checkpoint verificável; os commits indicados são para a futura execução, não para a preparação deste plano.

### Task 1: Dar um nome às contas existentes

**Files:**

- Modify: `src/shared/managed-account-types.ts`, `src/main/claude-accounts/claude-account-selection.ts`, `src/main/claude-accounts/service.ts`, `src/main/claude-accounts/claude-account-registration.ts`.
- Modify: `src/shared/rpc-contract/accounts-params.ts`, `src/main/runtime/rpc/methods/accounts/accounts.ts`, `src/main/runtime/agent-session/environment/runtime-account-controller.ts`, `src/main/runtime/orca-runtime.ts`.
- Modify: `src/preload/api/claude-accounts-bridge.ts`, `src/preload/api-types.ts`, `src/main/ipc/claude-accounts.ts`.
- Modify: `src/renderer/src/runtime/provider-accounts/observations/runtime-provider-accounts-client.ts`, `src/renderer/src/lib/provider-accounts/claude-account-label.ts`, `src/renderer/src/components/settings/accounts/claude/accounts-pane-claude-section.tsx`.

**Interfaces:**

- Acrescentar `label?: string` a `ClaudeManagedAccount` e `ClaudeManagedAccountSummary`.
- Produzir `ClaudeAccountService.renameAccount(accountId: string, label: string | null): Promise<ClaudeRateLimitAccountsState>` e expô-lo como `claudeAccounts:rename`/`accounts.renameClaude`.
- O label é aparado e limitado a 80 caracteres; `null` ou vazio remove-o. Contas sem label continuam a usar email. O ID é estável e nunca deriva do label.

- [ ] Acrescentar o campo opcional e preservá-lo em listagem, reautenticação e atualização do registo; não introduzir migração obrigatória nem alterar o ID.
- [ ] Implementar a operação de renomear através da fila de mutações existente, persistir a alteração e publicar o snapshot atualizado. Aplicar a mesma permissão `accounts-admin` das outras mutações; o cliente remoto não escreve settings locais.
- [ ] Acrescentar edição do nome em Accounts e reutilizar `getClaudeAccountLabel()` para a apresentação. Nomes repetidos continuam permitidos; email/organização distinguem as entradas.
- [ ] Verificar persistência do nome, reautenticação e remoção do nome pela API pública existente. Não criar testes de copy, traduções ou inventários; executar a suite existente `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/claude-accounts/claude-account-service.test.ts --maxWorkers=2`.
- [ ] Executar `pnpm tc:node` e `pnpm tc:web`; checkpoint sugerido: `feat: add display names to Claude accounts`.

### Task 2: Resolver uma conta explícita no host sem mudar a predefinição

**Files:**

- Modify: `src/main/claude-accounts/runtime-auth-service.ts`, `src/main/claude-accounts/claude-profile-router.ts`, `src/main/claude-accounts/claude-profile-wsl-router.ts`, `src/main/claude-accounts/environment.ts`.
- Modify: `src/shared/agent-session/agent-session-create-capabilities.ts`, `src/shared/agent-launch/startup/host-account-launch-env.ts`.
- Modify: `src/main/runtime/agent-session/environment/host-account-launch-env-state.ts`, `src/main/runtime/agent-session/environment/host-claude-profile-refresh.ts`, `src/main/orcad/orcad-wsl-host-claude-profile-refresh.ts`.
- Modify: `src/main/runtime/agent-session/environment/runtime-account-controller.ts`, `src/main/runtime/orca-runtime.ts` e os produtores atuais de `accounts.setHostLaunchEnv`, encontrados por `rg -n 'setHostLaunchEnv|HostAccountLaunchEnv' src`.
- Test: estender `src/main/claude-accounts/runtime-auth-service.test.ts` na fronteira do serviço.

**Interfaces:**

- Produzir `ClaudeRuntimeAuthService.prepareForClaudeAccountLaunch(accountId: string, target?: ClaudeAccountSelectionTarget): Promise<ClaudeRuntimeAuthPreparation>`.
- Produzir `ClaudeProfileRouter.prepareAccountLaunch(accountId: string)` e `ClaudeWslProfileRouter.prepareAccountLaunch(distro: string, accountId: string)`, com o mesmo resultado de preparação usado pelo serviço.
- Acrescentar capacidade `CLAUDE_ACCOUNT_LAUNCH_RUNTIME_CAPABILITY = 'agent-session.claude-account.v1'` e um catálogo WSL autorizado `claudeAccounts?: Record<string, { configDir: string; label?: string; email: string; needsSignIn?: true; organizationUuid?: string | null; organizationName?: string | null }>` a `HostAccountLaunchEnv`. Só o desktop proprietário publica caminhos nesta ponte de administração.
- O resultado de lançamento explícito não inclui o ponteiro global. O serviço atual `prepareForClaudeLaunch(target?)` mantém a semântica dos pedidos antigos.

- [ ] Escrever os casos relevantes no serviço: conta `work` pedida quando `personal` é a predefinição; ID removido; conta de outra distro; perfil legado sem login próprio; ambiente com uma chave/token que substituiria a subscrição escolhida. Usar diretórios temporários reais e o router real; expectativas de ID, erro e caminho relativo escritas literalmente, sem chamar funções de produção para calcular o esperado.
- [ ] Executar `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/claude-accounts/runtime-auth-service.test.ts --maxWorkers=2` e confirmar que os novos casos falham pelo comportamento em falta.
- [ ] Implementar a resolução por ID, validar conta/runtime e login correspondente com os leitores existentes e preparar só esse perfil. Perfil legado sem login próprio pede reautenticação própria, sem usar `coveredBySystemDefault` como substituto. A validade/renovação do token continua a ser verificada pelo CLI da conta.
- [ ] Compor o ambiente explícito com as funções existentes de `environment.ts`: remover overrides de autenticação que desviem a conta, aplicar o diretório preparado e impedir que `ORCA_CLAUDE_PROFILE_POINTER` o substitua. Não alterar `process.env` nem a seleção ou o ficheiro `selected-host`.
- [ ] Estender a ponte WSL para resolver IDs do catálogo autorizado e refrescar a conta pedida. Validar que o caminho pertence ao perfil/distro autorizado; remover uma conta do catálogo invalida futuros arranques. Não anunciar a capacidade até o host conseguir resolver tanto arranques como retomas e leituras do catálogo. Hosts antigos conservam o push legado sem campos novos.
- [ ] Reexecutar a suite do serviço e as suites existentes dos routers host/WSL; checkpoint sugerido: `feat: resolve explicit Claude accounts per launch`.

### Task 3: Fixar a conta nos terminais e na restauração de cada pane

**Files:**

- Modify: `src/shared/rpc-contract/agent-session-params.ts`, `src/shared/agent-session/agent-session-host-authority.ts`, `src/shared/rpc-contract/terminal-unary-params.ts`.
- Modify: `src/main/runtime/terminal/launch/terminal-create-options.ts`, `src/main/runtime/terminal/launch/runtime-agent-terminal-startup.ts`, `src/main/ipc/pty/runtime/spawn-preflight.ts`, `src/main/ipc/pty/ipc/spawn-preflight.ts`.
- Modify: `src/shared/workspace-layout/terminal-tab-types.ts`, `src/shared/workspace-layout/terminal-layout-snapshot-schema.ts`, `src/shared/agent-session/lifecycle/agent-session-resume.ts`, `src/shared/runtime-mobile-session-tab-contracts.ts`.
- Modify: `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-args.ts`, `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-in-new-tab.ts`, `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-web-host-tab.ts`.
- Modify: `src/renderer/src/lib/agent-session/accounts/claude/claude-session-account-move.ts`, `src/renderer/src/lib/provider-accounts/claude-account-switch-sessions.ts`.
- Create test: `src/main/runtime/terminal/launch/orca-runtime-terminal-claude-account.test.ts`, reutilizando a fixture de runtime existente na mesma pasta.
- Audit: produtores/consumidores de `pendingStartup`, `SleepingAgentLaunchConfig`, `RuntimeCreateAgentSessionRequest` e `RuntimeEnsureAgentSessionRequest`; transportar o campo pelos percursos existentes, sem criar outro mecanismo de arranque.

**Interfaces:**

- Consumir o serviço da tarefa 2 e acrescentar `claudeAccountId?: string` aos pedidos de create/ensure e `TerminalCreateOptions`, à configuração de restauro e a `LaunchAgentInNewTabArgs`.
- Persistir por pane em `TerminalLayoutSnapshot.claudeAccountIdsByLeafId?: Record<string, string>`. A rota já fornece o host/runtime; nunca guardar caminhos do desktop como identidade remota.
- `claudeAccountId` integra a identidade de replay de operações novas. Um retry não pode perder ou alterar o campo; um cliente não o envia a hosts sem a capacidade.

- [ ] Transportar o ID desde a ação até ao arranque real em todos os percursos usados pelo menu: create local, criação através do host, prompt adiado, ensure e recuperação. Recusar o campo quando `agent !== 'claude'` e recusar um ID explícito num host sem suporte antes de publicar um arranque bem-sucedido.
- [ ] Resolver o perfil no host e aplicá-lo depois dos defaults globais. Ambos os preflights atuais têm de respeitar a escolha. O launcher shell não volta a consultar o ponteiro global para esta sessão; usar ambiente do processo, não interpolar nomes de conta ou caminhos num comando shell.
- [ ] Gravar o ID na folha correta e preservá-lo em sleep/wake, buffers salvos, remount, detach e quit/relaunch. Clonar a conta num split que continua essa sessão; um terminal novo e independente continua com o comportamento atual. Limpar a entrada quando a folha é removida e transportar o metadado nos snapshots do host/mobile.
- [ ] Excluir panes com conta explícita dos reinícios automáticos causados por troca global. A configuração Ask/Always restart/Never restart continua a aplicar-se às sessões antigas sem escolha explícita.
- [ ] Criar `orca-runtime-terminal-claude-account.test.ts` na fronteira de lançamento/restauro do host: `retains the explicit account when a pane resumes after the default changes`. Pedir `work`, mudar a predefinição e retomar a mesma folha; o processo CLI de teste deve reportar o perfil `work` nas duas execuções. Incluir `refuses an explicit account on a legacy host` na fronteira de transporte responsável pela negociação. Não duplicar estas asserções em testes de mapeamento de props/IPC.
- [ ] Executar as suites tocadas com `ORCA_BACKGROUND_LAUNCH=1 pnpm test <ficheiros-de-teste-alterados> --maxWorkers=2` e `pnpm tc`; checkpoint sugerido: `feat: pin terminal Claude sessions to their account`.

### Task 4: Fixar a conta nos chats, retomas e catálogos de modelos

**Files:**

- Modify: `src/shared/agent-session/structured-agent-session-create.ts`, `src/shared/agent-session/lifecycle/structured-agent-session-mutation.ts`, `src/shared/rpc-contract/structured-agent-session-params.ts`, `src/shared/agent-session/lifecycle/agent-session-record.ts`.
- Modify: `src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create-handler.ts`, `src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-create.ts`, `src/main/runtime/agent-session/structured-agent-session-create-adoption.ts`.
- Modify: `src/main/native-chat/agent-session-wire/acquisition/structured-agent-session-attach.ts`, `src/main/native-chat/agent-session-wire/acquisition/structured-agent-session-create.ts`, `src/main/runtime/agent-session/records/agent-session-record-founding.ts`.
- Modify: `src/main/claude/claude-launch-account.ts`, `src/main/claude/structured/launch/claude-structured-launch-resolution.ts`, `src/main/runtime/agent-session/environment/structured-agent-account-home.ts`.
- Modify: `src/main/runtime/rpc/methods/structured-sessions/catalog/structured-agent-session-options-read.ts`, `src/main/native-chat/agent-model-catalog/agent-model-catalog-fingerprint.ts`.
- Modify: `src/renderer/src/lib/agent-session/launch/routing/agent-session-launch-plan.ts`, `src/renderer/src/lib/agent-session/launch/structured-agent-session-launch-callers.ts`, `src/renderer/src/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-structured-route.ts` e os emissores de create existentes.
- Create test: `src/main/runtime/rpc/methods/structured-sessions/creation/structured-agent-session-claude-account.test.ts`, reutilizando a fixture de RPC/host existente.
- Modify test: `src/main/runtime/rpc/methods/structured-sessions/catalog/structured-agent-session-options-workspace-scope.test.ts`.

**Interfaces:**

- Transportar e persistir `claudeAccountId?: string` em create, `AgentSessionRecord`, pedido/verdict de lançamento e createSupport/modelCatalog quando há uma conta explícita.
- Estender `prepareClaudeLaunchAccount(router, env, recordHome, claudeAccountId?)` para consumir a resolução explícita; ausência do campo preserva a resolução atual.
- O campo entra no fingerprint de create apenas quando presente, preservando os digests antigos. `acquiredAccount` continua a ser observação de arranque, nunca fonte substituta da escolha guardada.

- [ ] Em `structured-agent-session-claude-account.test.ts`, criar `retains the explicit account across record reload and reacquisition`: fundar um chat com `work`, mudar a predefinição, descarregar/recarregar o record e voltar a adquirir o processo; a escolha e o perfil observados continuam a ser `work`. Criar também `rejects a create replay that changes the account`: reutilizar a operação com `personal` produz conflito, sem uma segunda conversa.
- [ ] Propagar o campo por createSupport/admission, fingerprint do cliente e recomputação do host, founding e validação do record. Ausência mantém compatibilidade; ID explícito inválido ou relativo a outro runtime é recusado pelo host. Um fork herda a conta da origem; uma conta diferente no mesmo pedido não transfere a conversa.
- [ ] Aplicar o perfil explícito em cada aquisição do CLI e em operações que o relançam. Preservar a escolha em retoma, fork, rewind e conversão Terminal↔Chat; os dois modos usam o mesmo ID, sem depender da seleção global ou de descobrir o nome da conta no transcript.
- [ ] Tornar createSupport/modelCatalog e o fingerprint/cache do catálogo dependentes da conta escolhida. Modelo selecionado e permissões mantêm as regras atuais. Em `structured-agent-session-options-workspace-scope.test.ts`, criar `keeps model catalogs separate for two explicit Claude accounts` com perfis que oferecem modelos distintos e verificar que a segunda leitura não devolve o catálogo da primeira conta.
- [ ] Negociar os campos RPC com a capacidade da tarefa 2. O fallback Chat→Terminal conserva o ID e a intenção; se o destino não suporta a conta explícita, mostrar a recusa em vez de arrancar com outra conta. Cobrir esta condição no teste do host responsável pelo fallback.
- [ ] Executar as suites alteradas, a suite existente de Claude launch/account routing e `pnpm tc`; checkpoint sugerido: `feat: preserve explicit Claude accounts in chat sessions`.

### Task 5: Acrescentar as variantes ao menu e identificar a conta da sessão

**Files:**

- Modify: `src/shared/agent-launch/picker/agent-launch-picker.ts`, `src/renderer/src/components/agent/use-agent-launch-picker-inventory.ts`, `src/renderer/src/components/agent/agent-launch-picker-acquisition.ts`, `src/renderer/src/components/agent/agent-launch-picker-drafts.ts`.
- Modify: `src/renderer/src/components/tab-bar/new-tab-agent-menu-model.ts`, `src/renderer/src/components/tab-bar/tab-agent-launch-options.ts`, `src/renderer/src/components/tab-bar/QuickLaunchButton.tsx` e os consumidores das entradas do menu.
- Modify: `src/renderer/src/runtime/provider-accounts/observations/observed-provider-accounts.ts`, `src/renderer/src/lib/provider-accounts/claude-account-label.ts`.
- Modify: `src/renderer/src/components/native-chat/pane/actions/NativeChatPaneHeader.tsx` e a apresentação existente da identidade do agente no terminal.
- Create: `src/renderer/src/components/agent/claude-account-picker-entries.ts` para a projeção de contas em variantes, se não houver uma função existente que possa ser estendida com essa responsabilidade.
- Create: `src/renderer/src/components/tab-bar/ClaudeAccountLaunch.fixture.tsx` para revisão visual das entradas reais do menu.

**Interfaces:**

- Acrescentar `entryId?: string` e `claudeAccountId?: string` a `AgentPickerEntry` e transportar o segundo no draft de lançamento. Agentes sem variante conservam a identidade anterior.
- Identidade de variante: host/runtime/distro + `agent` + ID da conta. Labels, email e organização nunca são a chave React ou a chave de drafts/cache.
- `buildClaudeAccountPickerEntries(entry: AgentPickerEntry, accounts: ClaudeRateLimitAccountsState, target: ClaudeAccountSelectionTarget): AgentPickerEntry[]` conserva a entrada base e acrescenta as contas pertencentes ao destino.

- [ ] Reutilizar a observação de contas por owner/host já existente. Mostrar apenas contas do runtime de execução e distinguir carregamento/erro de um catálogo vazio. Uma conta sem login aparece com ação/indicação de reautenticação; não é lançada silenciosamente pela predefinição.
- [ ] Projetar variantes `Claude (<label ou email>)`, conservando o agente `claude`, as superfícies suportadas e o painel atual. Manter a entrada base/atalho e a posição dos restantes agentes; incluir nome/email na pesquisa sem duplicar atalhos.
- [ ] Separar chaves de seleção, cache, drafts e opções das variantes. Auditar os usos de `entry.agent`, `find()` por agente e `nativeChatLaunchPromptDraftScopeKey`: duas variantes não podem partilhar uma escolha de conta mutável. O prompt em elaboração deve permanecer na variante em que foi escrito.
- [ ] No clique direto e nas ações Terminal/Chat do painel, capturar `claudeAccountId` antes de qualquer await e passar o campo aos fluxos das tarefas 3–4. Abrir a variante não chama `selectAccount()` nem modifica a seleção global.
- [ ] Mostrar a conta pedida na identidade da sessão e distinguir falha/pedido de login de autenticação confirmada. Reutilizar o label atualizado sem regravar IDs. Acrescentar mensagens acionáveis para conta removida e host sem suporte usando os padrões existentes.
- [ ] Renderizar fixtures com duas contas, nomes iguais, email longo, conta sem login e host sem suporte; verificar light/dark e larguras 390 e 1280 px. Antes de alterar o cabeçalho do chat, ler `docs/styleguide/native-chat.md`. Checkpoint sugerido: `feat: choose Claude accounts from the new-tab menu`.

### Task 6: Validar o fluxo completo e fechar a integração

**Files:**

- Modify: `tests/e2e/golden-tab-bar-agent-launch.spec.ts` e o stub CLI existente relevante em `tests/e2e/helpers/`.
- Reuse: `src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs` quando o teste de Chat precisa de respostas do protocolo Claude.
- Update: documentação de contas/lançamento existente, localizada com `rg -n 'Claude accounts|Switching applies|contas Claude' docs/site/content docs`.

**Interfaces:**

- O stub simula a fronteira externa do CLI e reporta o diretório recebido e a identidade da conversa; não implementa a seleção de conta pelo Orca.
- A prova de aceitação usa o menu real e resultados dos processos/records do host. Não usar spies de chamadas, classes CSS, cópias de labels ou estado privado como prova de encaminhamento.

- [ ] Ler `tests/e2e/AGENTS.md` e localizar/carregar a skill `$electron` exigida pelo repositório antes da validação renderizada. Usar Playwright/CDP de renderers ocultos; não recorrer a computer-use nem ativar janelas.
- [ ] Acrescentar um cenário de comportamento: duas contas, viewport 1280×900, tema escuro, workspace de pasta e menu aberto; abrir Terminal/Empresa e Chat/Pessoal, mudar a predefinição antes de os arranques concluírem e verificar a identidade de cada processo. Num segundo lançamento, inverter os modos. Os valores esperados são `work` e `personal`, escritos no teste, sem derivação a partir do router.
- [ ] No mesmo fluxo, configurar um modelo numa variante, voltar à outra e verificar independência das opções; testar seleção por teclado e pesquisa sem afirmar textos de tradução. Guardar screenshot do menu e de ambos os modos.
- [ ] Exercitar quit/relaunch e retoma com contas explícitas, remoção da conta entre menu e clique e conversão de superfície. Verificar continuidade da escolha ou falha recuperável, sem transferir a conversa para a predefinição. Usar controlo de estado/promessas, sem sleeps de relógio nem chamadas reais à Anthropic.
- [ ] Executar os comandos abaixo com limites de seleção registados. Expandir os marcadores para a lista real dos ficheiros alterados. Não correr suites headful/native-focus no desktop do utilizador. Windows/WSL e hosts remotos precisam de evidência em ambiente próprio/CI; suporte não exercitado deve ser explicitado no relatório.

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test <ficheiros-de-teste-alterados> --maxWorkers=2
pnpm tc
pnpm exec oxlint <ficheiros-TypeScript-alterados>
pnpm exec oxfmt --check <ficheiros-alterados>
ORCA_BACKGROUND_LAUNCH=1 pnpm fixtures:shot tab-bar/ClaudeAccountLaunch --theme both
ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test tests/e2e/golden-tab-bar-agent-launch.spec.ts --config tests/playwright.config.ts --project electron-headless --workers=1
pnpm check:code-quality:changed origin/main
pnpm check:flaky-test-pattern-ratchet
pnpm check:changed
```

- [ ] Confirmar que não há fallback silencioso, que sessões antigas continuam a abrir, que Codex/Agent Teams não ganharam variantes e que nenhuma credencial aparece em payloads/logs/screenshots. Atualizar a documentação com nomes opcionais, escolha por sessão e limites de isolamento; checkpoint sugerido: `test: verify simultaneous Claude account launches`.
- [ ] Antes de qualquer push, executar novamente `pnpm check:changed` se houve edição/rebase depois da última execução. Se a seleção do check se tornar excessiva, usar checks com escopo e declarar o limite; não usar `--base=HEAD` como prova de toda a branch nem `--no-verify`.

## Resultado esperado

O utilizador abre o menu, escolhe a variante da conta e lança Terminal ou Chat. Cada sessão conserva essa conta durante todo o seu ciclo de vida. A predefinição global continua disponível e não interfere nas sessões com escolha explícita.

## Revisão do plano

Cobertura: nomes → tarefa 1; resolução/host/WSL → tarefa 2; terminal/restauro/troca global → tarefa 3; chat/replay/modelos/conversões → tarefa 4; menu/drafts/identificação → tarefa 5; simultaneidade/compatibilidade/evidência renderizada → tarefa 6. As decisões adicionais de manter a entrada base e limitar o âmbito ao Claude normal estão identificadas na spec como propostas.

Nota do ambiente de preparação: `docs/**` está ignorado pelo Git neste checkout; os dois documentos ficam guardados localmente. A execução deve confirmar o destino versionado antes de os incluir num commit. `pnpm` não estava disponível no PATH durante a preparação do plano; não foram executados formatter, testes nem checks de produto nesta fase documental.
