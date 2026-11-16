import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/repository/repo-types'
import type { PreflightStatus } from '../preflight/agent-detection'
import { selectTaskBoardHostRepos } from './task-board-host-repos'

function repo(id: string, executionHostId: Repo['executionHostId'] = null): Repo {
  return { id, path: `/src/${id}`, displayName: id, badgeColor: '', addedAt: 1, executionHostId }
}

function preflight(glab: { installed: boolean; authenticated: boolean }): PreflightStatus {
  return { git: { installed: true }, gh: { installed: true, authenticated: true }, glab }
}

describe('selectTaskBoardHostRepos', () => {
  it('keeps a local repo whose glab is installed but fails the auth probe', () => {
    const repos = [repo('app')]
    const selected = selectTaskBoardHostRepos(
      repos,
      'gitlab',
      preflight({ installed: true, authenticated: false })
    )
    expect(selected.map((r) => r.id)).toEqual(['app'])
  })

  it('drops local repos when glab is not installed on this host', () => {
    const selected = selectTaskBoardHostRepos(
      [repo('app')],
      'gitlab',
      preflight({ installed: false, authenticated: false })
    )
    expect(selected).toEqual([])
  })

  it('never reads repos executed by another Orca runtime', () => {
    const selected = selectTaskBoardHostRepos(
      [repo('remote-app', 'runtime:vps'), repo('ssh-app', 'ssh:box')],
      'gitlab',
      preflight({ installed: true, authenticated: true })
    )
    expect(selected.map((r) => r.id)).toEqual(['ssh-app'])
  })
})
