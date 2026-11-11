# Escolha da conta Claude no lançamento

## Intenção

Permitir usar a conta Claude pessoal e a da empresa em simultâneo no mesmo Orca, escolhendo a conta no menu de nova aba mostrado pelo utilizador. A escolha deve funcionar em Terminal e Chat, incluindo duas contas dentro do mesmo projeto.

## Comportamento pretendido

- O menu oferece variantes como `Claude (Pessoal)` e `Claude (Empresa)`, construídas a partir das contas guardadas no host de execução.
- Cada variante conserva o painel de configuração atual e as ações Terminal e Chat, quando essas superfícies estão disponíveis nesse host.
- A conta é capturada na seleção e enviada com o lançamento. A seleção global não é alterada para abrir uma variante.
- A sessão guarda a conta escolhida e conserva-a em novas tentativas, reinícios, recuperação, retoma e passagem entre Terminal e Chat.
- Trocar a conta global não move as sessões criadas por uma variante explícita.
- Uma conta removida, indisponível ou sem autenticação provoca uma falha recuperável nessa conta. Não há substituição automática por outra conta.
- A conta aparece junto da identificação da sessão. Antes do arranque é uma escolha; depois do arranque, qualquer indicação de conta autenticada depende da observação do host.

## Decisões de produto propostas para o plano

- Acrescentar um nome opcional editável às contas: por exemplo, `Pessoal` ou `Empresa`. Sem nome, apresentar o email; em casos ambíguos, acrescentar a organização disponível.
- Manter a entrada `Claude` e o atalho atuais como acesso à predefinição existente. Acrescentar as variantes por conta sem duplicar o mesmo atalho em todas as linhas.
- As variantes identificam o mesmo agente `claude`; não criar agentes fictícios como `claude-personal`.
- O nome da conta serve apenas para apresentação. Identidade, persistência e encaminhamento usam o ID da conta e o host/runtime de execução.
- A funcionalidade abrange o Claude normal. O preset `claude-agent-teams`, os outros agentes, automações e escolhas predefinidas por projeto mantêm o comportamento atual.

## Situação atual verificada no repositório

- `ClaudeProfileRouter` e `ClaudeWslProfileRouter` já preparam diretórios distintos para as contas.
- `ClaudeRuntimeAuthService.prepareForClaudeLaunch(target?)` resolve a seleção atual; não recebe uma conta explícita.
- `prepareClaudeLaunchAccount()` consulta novamente a seleção no arranque de Chat. `accountHome` e `acquiredAccount` não substituem uma escolha explícita persistida: o segundo é uma observação do processo que arrancou.
- A função shell de `claude` consulta `ORCA_CLAUDE_PROFILE_POINTER` em cada chamada. Uma sessão fixa precisa de evitar que esse ponteiro global lhe mude a conta.
- `AgentPickerEntry`, os drafts e algumas chaves do menu usam apenas o agente como identidade. Duas entradas Claude exigem identidades diferentes para não misturar configuração e drafts.
- Create, createSupport e modelCatalog usam contratos RPC com validação estrita. Campos novos exigem negociação de capacidades.
- Hosts WSL sem serviços próprios recebem do desktop apenas o ambiente da conta selecionada. Para várias contas, essa ponte tem de passar a transportar um catálogo autorizado por ID.
- Parte do histórico e das configurações é partilhada pelos perfis atuais. Este trabalho fixa a conta de execução; não oferece isolamento completo dos dados locais entre empresa e pessoal.

## Abordagens consideradas

1. **Trocar a conta global e conservar processos existentes.** Já existe como alternativa para terminais, mas exige trocas manuais e não fixa a escolha nos próximos arranques.
2. **Conta predefinida por projeto.** Útil futuramente, mas insuficiente para escolher as duas contas dentro do mesmo projeto.
3. **Variantes no menu com conta persistida por sessão.** É a abordagem pedida pelo utilizador e a base deste plano. Reutiliza os perfis e o lançamento atual, acrescentando uma escolha explícita de conta.

## Contrato de encaminhamento

Acrescentar `claudeAccountId?: string` ao pedido de lançamento e às identidades persistidas que precisam de o repetir. O host/runtime vem da rota já resolvida; o cliente não escolhe diretórios nem transporta credenciais. Um pedido com conta explícita para um agente diferente de `claude` é recusado.

O host resolve o ID no seu catálogo, verifica a correspondência do runtime e prepara o perfil existente. Nos hosts WSL geridos pelo desktop, o host resolve o ID num catálogo que apenas o desktop proprietário pode publicar. A conta explícita prevalece sobre a predefinição e sobre o ponteiro shell. Credenciais herdadas que substituiriam essa conta não podem prevalecer silenciosamente.

Pedidos sem o campo conservam a semântica atual. Sessões antigas não são migradas para uma conta com base na seleção global atual. Forks e conversões herdam a conta da origem quando esta é explícita; não acrescentar uma operação de transferência de conversas entre contas.

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

## Critérios de aceitação

1. Com duas contas guardadas, o menu permite abrir qualquer uma em Terminal e Chat, conforme suporte do host.
2. Um terminal da empresa e um chat pessoal podem trabalhar simultaneamente no mesmo workspace; também é possível inverter os modos.
3. Trocar a predefinição enquanto os processos arrancam não altera as contas pedidas.
4. Reiniciar e retomar cada sessão conserva a conta original, incluindo após reinício do Orca.
5. Uma nova tentativa do mesmo lançamento não cria outra sessão nem aceita outra conta sob a mesma identidade de operação.
6. Falhas de autenticação e remoção de conta preservam a identidade pedida e oferecem recuperação sem substituição de conta.
7. Modelos disponíveis, drafts e opções de uma variante não são confundidos com os de outra variante.
8. Um cliente remoto ou móvel só pode escolher contas do host/runtime de execução; hosts antigos recusam a variante com uma explicação acionável.
9. Sem contas guardadas, a entrada Claude continua a funcionar como atualmente.

## Fora do âmbito

Conta predefinida por projeto; rotação por quota; mudança automática de conta; novos fornecedores; alterações ao preset Agent Teams; importação/cópia de credenciais; isolamento completo de históricos, plugins e instruções; mudanças na disponibilidade das superfícies já suportadas.

## Referências

- [Autenticação com várias contas no Claude Code](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts).
- `AGENTS.md`, `docs/STYLEGUIDE.md`, `docs/agents-md-refs/cross-platform-support.md`, `docs/agents-md-refs/test-antipatterns.md` e `docs/agents-md-refs/component-fixtures.md`.
