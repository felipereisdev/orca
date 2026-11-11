# Claude Account Name Editor Implementation Plan

> **For agentic workers:** Execute natively in the existing feature worktree.

**Goal:** Aplicar a opção A escolhida no visual companion.

**Architecture:** O editor possui apenas o estado temporário do nome e utiliza o runner/API existentes. Extrair o cartão Claude da secção para manter a separação entre seleção e edição sem elementos interativos aninhados, e permitir validar o cartão real numa fixture.

**Tech Stack:** React, TypeScript, shadcn, component fixtures.

**Spec:** `docs/superpowers/specs/2026-11-11-claude-account-name-editor-design.md`

## Global Constraints

- Não alterar autenticação, seleção ou contratos RPC.
- Seguir STYLEGUIDE.md e a política de testes do AGENTS.md; a mudança de apresentação/interação usa fixture renderizada, sem testes de copy ou mocks de chamadas.
- Não interagir com as contas reais durante a validação.

## Review Focus

- Enter guarda uma vez; Esc e Cancelar não gravam.
- O editor não seleciona a conta e não contém botões dentro de botões.
- Falhas mantêm o rascunho; conta sem nome continua a apresentar email.
- Claro/escuro e largura reduzida preservam ações acessíveis.

### Task 1: Editor inline e integração do cartão

- [x] Substituir `claude-account-name-input.tsx` por `claude-account-name-editor.tsx`, com estado fechado/edição, lápis, Enter, Esc e ações explícitas.
- [x] Extrair `claude-account-card.tsx` e integrar o editor no título; conservar o runner e as ações existentes.
- [x] Criar fixture do cartão real com conta fictícia e validar os estados normal/edição, cancelar/guardar, temas e largura reduzida.
- [x] Executar typecheck, lint/format, qualidade alterada e checks aplicáveis; rever a alteração e guardar num commit local.

## Verificação

Typecheck, oxlint, qualidade incremental e gates de localização passaram. Seis capturas do cartão real foram verificadas nos dois temas e em 390/760 px. Interação por Playwright numa fixture isolada confirmou guardar, cancelar, Esc no botão Guardar, foco após refresh demorado, rascunho após falha e ausência de overflow a 390 px. As duas correções de teclado da revisão independente foram reproduzidas antes da correção e verificadas depois. Não foram alteradas contas reais.

O check automático de testes afetados voltou a exceder o limite de um minuto; usaram-se verificações focadas. O formatter inicialmente incluiu HTML temporário do companion; esses ficheiros foram formatados e o check de formato passou separadamente.
