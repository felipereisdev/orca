import { ZodError } from 'zod'
import { useEffect, useState } from 'react'
import type {
  DatabaseConnectionConfiguration,
  DatabaseCredentials
} from '../../../../../shared/database/database-contracts'
import type {
  DatabaseHostCapabilities,
  DatabaseSettingsOptions
} from '../../../../../shared/database/database-settings-options'
import type { DatabaseRuntimeClient } from '@/runtime/database/database-runtime-client'
import { useTranslate } from '@/i18n/use-translate'
import {
  databaseConnectionDraft,
  databaseConnectionInput,
  type DatabaseConnectionDraft
} from './database-connection-draft'

export function useDatabaseConnectionDraft(
  client: DatabaseRuntimeClient,
  connectionId: string | null,
  options: DatabaseSettingsOptions
) {
  const t = useTranslate()
  const [original, setOriginal] = useState<DatabaseConnectionConfiguration>()
  const [initial, setInitial] = useState(databaseConnectionDraft)
  const [draft, setDraft] = useState(databaseConnectionDraft)
  const [loading, setLoading] = useState(Boolean(connectionId))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set())
  const [test, setTest] = useState<{ serverVersion: string; readOnlyProfile: boolean } | null>(null)
  const [capabilities, setCapabilities] = useState<DatabaseHostCapabilities>()
  const [hostError, setHostError] = useState<string | null>(null)
  const [hostRefresh, setHostRefresh] = useState(0)
  const [showPending, setShowPending] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const pending = loading || saving || testing
  const hostChecking = !capabilities && !hostError
  useEffect(() => {
    const timer = window.setTimeout(() => setShowPending(pending || hostChecking), 200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [pending, hostChecking])
  useEffect(() => {
    if (!connectionId) {
      return
    }
    let current = true
    void client
      .configuration(connectionId)
      .then((connection) => {
        if (!current) {
          return
        }
        setOriginal(connection)
        setDraft(databaseConnectionDraft(connection))
        setInitial(databaseConnectionDraft(connection))
      })
      .catch((reason) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false)
        }
      })
    return () => {
      current = false
    }
  }, [client, connectionId])
  useEffect(() => {
    let current = true
    setHostError(null)
    const cached = options.hosts.find(
      (host) => host.executionHostId === draft.executionHostId
    )?.capabilities
    setCapabilities(hostRefresh > 0 ? undefined : cached)
    if (!cached || hostRefresh > 0) {
      void client
        .hostCapabilities(draft.executionHostId)
        .then((value) => {
          if (current) {
            setCapabilities(value)
          }
        })
        .catch((reason) => {
          if (current) {
            setHostError(reason instanceof Error ? reason.message : String(reason))
          }
        })
    }
    return () => {
      current = false
    }
  }, [client, draft.executionHostId, options.hosts, hostRefresh])
  function update<K extends keyof DatabaseConnectionDraft>(
    field: K,
    value: DatabaseConnectionDraft[K]
  ) {
    setDraft((current) => ({ ...current, [field]: value }))
    setError(null)
    setTest(null)
    setInvalidFields((fields) => {
      const next = new Set(fields)
      next.delete(field)
      return next
    })
  }
  async function save(): Promise<DatabaseConnectionConfiguration | undefined> {
    setError(null)
    setInvalidFields(new Set())
    if (!capabilities?.engines.includes(draft.engine) || !capabilities.protectedCredentialStorage) {
      setError(
        t(
          'database.form.hostUnavailable',
          'The execution host or protected credential storage is unavailable'
        )
      )
      return undefined
    }
    const changingCredentials = Boolean(draft.username || draft.password || !original)
    if (changingCredentials && (!draft.username || !draft.password)) {
      setInvalidFields(
        new Set(
          ['username', 'password'].filter((field) =>
            field === 'username' ? !draft.username : !draft.password
          )
        )
      )
      setError(t('database.form.credentialsRequired', 'Enter both a username and password'))
      return undefined
    }
    const credentials: DatabaseCredentials | undefined = changingCredentials
      ? { username: draft.username, password: draft.password }
      : undefined
    setSaving(true)
    return Promise.resolve()
      .then(() =>
        client.save(databaseConnectionInput(draft, original), credentials, original?.revision)
      )
      .then((saved) => {
        setOriginal(saved)
        setDraft(databaseConnectionDraft(saved))
        setInitial(databaseConnectionDraft(saved))
        return saved
      })
      .catch((reason: unknown) => {
        if (reason instanceof ZodError) {
          setInvalidFields(
            new Set(
              reason.issues.map((issue) =>
                String(issue.path[0] === 'projects' ? 'projects' : issue.path.at(-1))
              )
            )
          )
          setError(
            t(
              'database.form.invalidDetails',
              'Review the highlighted connection details before saving'
            )
          )
        } else {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
        return undefined
      })
      .finally(() => setSaving(false))
  }
  async function testSaved() {
    if (!original || dirty) {
      return
    }
    setTesting(true)
    setError(null)
    setTest(null)
    await client
      .test(original.id)
      .then(setTest)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason))
      )
      .finally(() => setTesting(false))
  }
  return {
    draft,
    invalidFields,
    update,
    original,
    dirty,
    pending,
    showPending,
    loading,
    saving,
    testing,
    error,
    test,
    save,
    testSaved,
    capabilities,
    hostError,
    hostChecking,
    retryHost: () => setHostRefresh((value) => value + 1)
  }
}
export type DatabaseConnectionDraftController = ReturnType<typeof useDatabaseConnectionDraft>
