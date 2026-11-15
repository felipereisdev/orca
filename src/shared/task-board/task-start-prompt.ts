import type { TaskStartContext } from './task-start-context-types'
import type { TaskStartAgentChoice, TaskStartRole } from './task-start-settings'

export const TASK_START_FLOW_TEXT =
  'Estruture um plano com superpowers. Após finalizar o plano peça para o $revisor do plano via orca-cli revisar o plano. Quando ele finalizar, analise o retorne de forma criteriosa e ajuste se necessário. Você pode fazer esse fluxo de revisões e correções no máximo 3 vezes, mas normalmente só vai precisar de uma. Quando o plano tiver finalizado, crie o roteiro de qa com base no plano/spec. Ao finalizar, implemente com a opção recomendada (subagent driven ou native driven). Para implementar utilize o $implementer e para todos os tipos de revisões utilize o $reviewer. Quando finalizar completamente a implementação, execute o roteiro de qa com o $qa. Para backend no roteiro use curl para testar os endpoints, para frontend utilize o browser embutido via orca-cli. Se não souber as credenciais, pergunte.'

const FLOW_TOKENS: readonly [string, TaskStartRole][] = [
  ['$revisor', 'planReviewer'],
  ['$implementer', 'implementer'],
  ['$reviewer', 'reviewer'],
  ['$qa', 'qa']
]

const AGENT_SECTION: readonly [string, TaskStartRole, string][] = [
  ['$planner', 'planner', 'planejamento'],
  ['$revisor', 'planReviewer', 'revisor do plano'],
  ['$implementer', 'implementer', 'implementação'],
  ['$reviewer', 'reviewer', 'revisões'],
  ['$qa', 'qa', 'QA']
]

export function taskStartRoleLabel(choice: TaskStartAgentChoice, accountLabel?: string): string {
  const agent = choice.agent.charAt(0).toUpperCase() + choice.agent.slice(1)
  const parts = [accountLabel ? `${agent} (${accountLabel})` : agent]
  if (choice.model) {
    parts.push(choice.model)
    if (choice.effort) {
      parts.push(choice.effort)
    }
  }
  return parts.join(' · ')
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

export function taskStartWorkerCommand(choice: TaskStartAgentChoice): string {
  const flags = [`--agent ${shellQuote(choice.agent)}`]
  if (choice.accountId) {
    flags.push(`--account ${shellQuote(choice.accountId)}`)
  }
  if (choice.model) {
    flags.push(`--model ${shellQuote(choice.model)}`)
    if (choice.effort) {
      flags.push(`--effort ${shellQuote(choice.effort)}`)
    }
  }
  return `ORCA orchestration worker-start ${flags.join(' ')} --worktree current --spec-file <arquivo>`
}

function renderFlow(labels: Partial<Record<TaskStartRole, string>>): string {
  // One pass so a label that itself contains a $token is never substituted twice.
  const byToken = new Map(FLOW_TOKENS)
  return TASK_START_FLOW_TEXT.replace(/\$(?:revisor|implementer|reviewer|qa)\b/g, (token) => {
    const role = byToken.get(token)
    return (role && labels[role]) || token
  })
}

function renderImages(context: TaskStartContext): string {
  if (context.images.length === 0) {
    return ''
  }
  const lines = context.images.map((image) => {
    const where =
      image.origin.kind === 'description'
        ? 'descrição'
        : `comentário de ${image.origin.author} em ${image.origin.at}`
    const target = image.path ?? `${image.url} (não foi possível baixar)`
    return `- ${target}  (origem: ${where})`
  })
  return `## Prints\n${lines.join('\n')}\n\n`
}

function renderComments(context: TaskStartContext): string {
  if (context.comments.length === 0) {
    return ''
  }
  const blocks = context.comments.map((c) => `### ${c.author} — ${c.at}\n${c.body}`)
  return `## Comentários\n${blocks.join('\n\n')}\n\n`
}

const EXECUTABLE_RULE =
  '`ORCA` = `$ORCA_CLI_COMMAND` se definido; senão `orca-dev` se `ORCA_DEV_REPO_ROOT` estiver definido; senão `orca`.'

const STATUS_SECTION = `## Status
Reporte cada mudança de etapa com \`ORCA task-start phase <etapa>\`. ${EXECUTABLE_RULE}
Etapas:
- \`planning\`: ao começar a estruturar o plano.
- \`plan-review\`: enquanto o plano está em revisão.
- \`qa-script\`: ao criar o roteiro de qa.
- \`development\`: durante a implementação; informe o progresso com \`--current <n> --total <m> --step "<subtarefa>"\` a cada subtarefa.
- \`final-review\`: na revisão final da implementação.
- \`qa\`: ao executar o roteiro de qa.
- \`waiting\`: sempre que precisar perguntar algo ao usuário.
- \`completed\`: quando tudo estiver concluído.`

export function buildTaskStartPrompt(args: {
  context: TaskStartContext
  roles: Partial<Record<TaskStartRole, TaskStartAgentChoice>>
  labels: Partial<Record<TaskStartRole, string>>
}): string {
  const { context, roles, labels } = args
  const agentLines = AGENT_SECTION.flatMap(([token, role, purpose]) => {
    const choice = roles[role]
    if (!choice) {
      return []
    }
    const label = labels[role] ?? taskStartRoleLabel(choice)
    return [`- ${token} (${purpose}): ${label}`, `  \`${taskStartWorkerCommand(choice)}\``]
  })
  const roleLabels = Object.fromEntries(
    FLOW_TOKENS.map(([, role]) => [
      role,
      labels[role] ?? (roles[role] ? taskStartRoleLabel(roles[role]) : undefined)
    ])
  )
  return [
    `# Tarefa ${context.displayId}: ${context.title}`,
    `Origem: ${context.provider} — ${context.url}`,
    '',
    `## Descrição\n${context.description}`,
    '',
    `${renderImages(context)}${renderComments(context)}## Seu papel`,
    'Você é o orquestrador desta tarefa. Não execute as etapas você mesmo: delegue cada uma ao agente do papel correspondente, via orca-cli, neste worktree.',
    'O planejamento é feito pelo $planner.',
    '',
    `## Agentes\n${agentLines.join('\n')}`,
    '',
    STATUS_SECTION,
    '',
    `## Fluxo\n${renderFlow(roleLabels)}`,
    ''
  ].join('\n')
}
