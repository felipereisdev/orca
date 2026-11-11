# PostgreSQL read-only connections

The adapter is validated against PostgreSQL 16 with verified TLS and password authentication. A connection uses a dedicated login, explicit database/host/port and optional PEM CA certificate/server name. Certificate verification is always enabled. Queries must qualify application tables with their schema; the session search path contains only `pg_catalog`.

## Supported privilege profile

The login must have no superuser, database/role creation, replication or RLS-bypass attributes, no role memberships, no database CREATE/TEMP privileges, no schema CREATE privileges, and no ownership or write grants on application objects. Grant only USAGE on approved schemas and SELECT on approved tables/columns. Accessible columns must use built-in scalar types; custom/domain/array types, RLS, foreign tables and materialized views are refused. Views must use PostgreSQL 15+ `security_invoker=true`; every accessible view definition must also pass the supported read-query parser. Functions outside `pg_catalog` and `information_schema` must not be executable by this login, including rights inherited from PUBLIC.

Preflight runs again inside the read-only transaction used for execution. Changes to permissions can make an existing connection unavailable. Orca never applies provisioning SQL to an existing database.

## Provisioning example

Have the database administrator adapt and review this example. The PUBLIC revocations change rights for other logins; use a dedicated database or review every affected application first. Existing callable routines in other application schemas must also have their PUBLIC EXECUTE grants reviewed. Set the password through the administrator's secret-management process (`\password orca_reader` in psql), rather than embedding it in scripts/history.

```sql
CREATE ROLE orca_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE, TEMPORARY ON DATABASE application_database FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA approved FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE application_owner IN SCHEMA approved
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
GRANT CONNECT ON DATABASE application_database TO orca_reader;
GRANT USAGE ON SCHEMA approved TO orca_reader;
GRANT SELECT ON approved.invoices TO orca_reader;
-- For reviewed views: ALTER VIEW approved.invoice_totals SET (security_invoker = true);
```

The login must not own the database, schema, tables or routines. Apply equivalent default-privilege restrictions for each routine-creating owner. No general-purpose role such as `pg_read_all_data` is required or accepted by this initial profile.

## Execution and verification

The adapter opens a fresh session per operation, uses read-only transactions, positional bound parameters, a bounded cursor and a single end-to-end deadline. Numeric values remain exact strings, duplicate column names retain separate column positions, and nulls remain nulls. Cancellation sends `pg_cancel_backend` for the same login's active backend, then destroys the session. Sessions are never returned to a pool or replayed automatically.

Run `ORCA_BACKGROUND_LAUNCH=1 pnpm test:database` with Docker and OpenSSL available. The fixture starts `postgres:16-alpine` bound only to a random loopback port, generates a temporary verified TLS certificate and uses explicit disposable credentials. It never reads project `.env` files. Missing Docker, certificate tools or server startup is a test failure, not skipped evidence.
