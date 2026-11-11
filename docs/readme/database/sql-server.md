# SQL Server read-only connections

The adapter uses the portable `mssql`/Tedious driver, verified TLS, an explicit TCP port and database, and a fresh private session for every operation. It has been exercised with SQL Server 2022 CU18 (16.0.4185.3). SQL authentication is supported; integrated Windows authentication is outside this initial profile. Never enable `trustServerCertificate` to bypass a certificate failure. Supply the issuing PEM CA and certificate server name instead.

## Provisioning

Create a dedicated login and database user through the administrator's secret-management process. In the application database, grant only `CONNECT`, `VIEW DEFINITION`, and `SELECT` on approved schemas or ordinary tables. The login must not own objects or belong to server roles other than `public`; database roles other than `public` and `db_datareader` are refused. Prefer explicit schema/table grants to the database-wide reader role. Effective server, database, schema, object and column permissions are checked again before each operation; any write, execute, impersonation or administration permission makes the connection unavailable. Do not provision this user in system databases.

```sql
-- After creating a dedicated login with a securely supplied password:
CREATE USER orca_reader FOR LOGIN orca_reader;
GRANT CONNECT TO orca_reader;
GRANT VIEW DEFINITION TO orca_reader;
GRANT SELECT ON SCHEMA::approved TO orca_reader;
```

The initial strict profile accepts ordinary tables with built-in scalar columns. It refuses accessible views, synonyms, external tables, computed columns, row-level security predicates and user-defined column types. These objects can introduce indirect function execution or ownership-chain access that the initial adapter does not certify. Use a separate reporting database with ordinary reviewed tables if an existing account cannot meet this profile. Orca never changes server grants itself.

## Query behavior

Submit one supported `SELECT`/CTE with bound `@name` parameters. Cross-database/server references, table/locking hints, `SELECT INTO`, arbitrary functions, stored procedures and batches are refused. SQL Server has no general read-only transaction switch: permission enforcement and the restricted parsed query are required. Read-only application intent only assists server routing.

Results preserve duplicate column names by position and convert exact numeric types to text on the server before Tedious can round them. Decimal parameters are converted from bound strings on the server, up to precision 38. Result metadata is inspected before execution; unsupported types fail closed. The initial result subset supports integers, decimal/numeric, bit, GUID, date/time/datetime2/datetimeoffset, text and binary. Legacy datetime, money, approximate floating point, sql_variant and CLR types are refused rather than accepting a lossy implicit string conversion. Server `TEXTSIZE` bounds large text/binary values before the driver materializes them. The common result encoder applies the final UTF-8/row/output limits and marks previews.

Cancellation waits for the request's attention/cancellation response and destroys the private connection; no query is automatically replayed. The end-to-end deadline also covers privilege and metadata inspection.

## Verification

`ORCA_BACKGROUND_LAUNCH=1 pnpm test:database tests/database/sql-server-adapter.integration.test.ts` requires Docker, OpenSSL and the `mcr.microsoft.com/mssql/server:2022-CU18-ubuntu-22.04` image. The disposable server binds only a random loopback port and uses generated TLS certificates and fixture-only passwords. No project secrets or existing databases are consulted. Tests cover exact numbers, duplicate/null cells, permission rejection, typed parameters, oversized values and cancellation confirmed at the server.

The pinned `mssql` package and its transitive `powershell-utils` dependency carry ASCII representation patches for Unicode characters in regular expressions. The expressions keep the same code points and behavior while satisfying the headless server bundle’s ASCII gate. Revalidate that gate and the live SQL Server suite when upgrading the driver.
