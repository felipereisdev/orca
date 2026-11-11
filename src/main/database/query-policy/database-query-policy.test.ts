import { describe, expect, it } from 'vitest'
import { validateDatabaseReadQuery } from './database-query-policy'

describe('database read-query admission', () => {
  it.each([
    ['postgres', 'SELECT id FROM public.encomendas'],
    ['postgres', 'WITH x AS (SELECT 1 AS id) SELECT id FROM x'],
    ['postgres', "SELECT 'DELETE; DROP TABLE x' AS literal"],
    ['postgres', 'SELECT count(*) FROM public.encomendas WHERE id = $1'],
    ['sql-server', 'SELECT TOP (10) id FROM dbo.encomendas'],
    ['sql-server', 'SELECT id FROM dbo.encomendas WHERE id = @id'],
    ['oracle', 'SELECT id FROM encomendas FETCH FIRST 10 ROWS ONLY'],
    ['oracle', 'SELECT id FROM encomendas WHERE id = :id']
  ] as const)('admits a supported %s read: %s', (engine, sql) => {
    expect(validateDatabaseReadQuery(engine, sql).sql).toBe(sql)
  })

  it.each([
    ['postgres', 'SELECT 1; DELETE FROM public.encomendas'],
    ['postgres', 'WITH x AS (DELETE FROM public.encomendas RETURNING *) SELECT * FROM x'],
    ['postgres', 'SELECT * FROM public.encomendas FOR UPDATE'],
    ['postgres', 'SELECT * INTO copied FROM public.encomendas'],
    ['postgres', 'SELECT public.mutate_data()'],
    ['postgres', "SELECT nextval('encomendas_id_seq')"],
    ['postgres', "SELECT pg_catalog.pg_read_file('/etc/passwd')"],
    ['postgres', "SELECT dblink('remote', 'SELECT 1')"],
    ['postgres', 'SELECT * FROM public.encomendas; SET TRANSACTION READ WRITE'],
    ['postgres', "SELECT 'unterminated"],
    ['sql-server', 'SELECT * INTO copied FROM dbo.encomendas'],
    ['sql-server', 'SELECT id FROM dbo.encomendas WITH (UPDLOCK)'],
    ['sql-server', "SELECT * FROM OPENROWSET('SQLNCLI', 'remote', 'SELECT 1')"],
    ['sql-server', 'SELECT * FROM server_name.database_name.dbo.encomendas'],
    ['sql-server', 'SELECT dbo.mutate_data()'],
    ['sql-server', 'SELECT NEXT VALUE FOR dbo.sequence_name'],
    ['sql-server', 'SELECT 1; EXEC dbo.mutate_data'],
    ['oracle', 'SELECT * FROM encomendas FOR UPDATE'],
    ['oracle', 'SELECT encomendas_seq.NEXTVAL FROM dual'],
    ['oracle', 'SELECT mutate_data() FROM dual'],
    ['oracle', 'SELECT * FROM encomendas@remote'],
    ['oracle', 'BEGIN mutate_data(); END;'],
    ['oracle', 'SELECT 1 FROM dual; DELETE FROM encomendas'],
    ['oracle', "SELECT 'unterminated FROM dual"]
  ] as const)('refuses a %s query with unsafe or unsupported behavior: %s', (engine, sql) => {
    expect(() => validateDatabaseReadQuery(engine, sql)).toThrow()
  })

  it('rejects oversized SQL before attempting dialect parsing', () => {
    expect(() => validateDatabaseReadQuery('postgres', `SELECT ${' '.repeat(65_536)}`)).toThrow()
  })
})
