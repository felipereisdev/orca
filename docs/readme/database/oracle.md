# Oracle read-only connections

The adapter uses `oracledb` 26.0.0 in Thin mode with password authentication, an explicit TCP host/port and service name, and verified TCPS. No Oracle Client installation or Thick-mode fallback is used. Oracle Free 23.26.3.0.0 is exercised in a disposable container. Other server versions require separate verification.

Provide a public PEM CA certificate when the execution host's trust store does not trust the issuer. Orca carries a pinned driver patch allowing a CA-only PEM without a client private key; chain validation and server identity matching remain enabled. Mutual TLS wallets/client keys are outside the initial enrollment flow. The optional TLS server-name field means the full certificate subject DN for Oracle (for example `CN=db.example.com,O=Example`), as required by the driver; leave it blank to verify the actual hostname against CN/SAN. Do not disable identity checks to work around a failure.

## Provisioning

Use a dedicated reader user that owns no objects, has no enabled roles and has only the `CREATE SESSION` system privilege. Grant `SELECT` or `READ` on individually approved ordinary tables. Password provisioning belongs to the administrator's secret-management process.

```sql
-- After creating a dedicated user with a securely supplied password:
GRANT CREATE SESSION TO orca_reader;
GRANT SELECT ON approved.invoices TO orca_reader;
```

SYS, SYSTEM, other system identities, owner accounts, ANY/administration privileges, grant options and writable/callable application grants are refused. The initial profile refuses accessible application views, materialized views, synonyms, external tables, virtual columns, object types and row-level security policies. Application routines granted to PUBLIC also make the profile unavailable. Oracle-maintained system metadata and the default PUBLIC `INHERIT PRIVILEGES` grants on users are treated separately: the reader cannot own code or create it, and arbitrary routine calls remain forbidden by the parsed query policy.

The profile is checked again inside every fresh read-only transaction. Orca never applies grant/provisioning changes to an existing database. Prefer a dedicated reporting database when an existing account cannot meet these restrictions.

## Results and cancellation

NUMBER values are fetched as strings directly from Oracle's protocol representation. Numeric input values stay bound strings and are explicitly converted on the server with a fixed decimal separator; more than 38 significant digits or unsupported scales are refused before Oracle can round them. Duplicate names retain the original database name and a separate column position. Oracle itself treats empty strings as NULL.

One-row ResultSet fetching avoids unbounded result buffering. CLOB/NCLOB locators read at most 4,097 UCS-2 units and BLOB locators at most 3,073 bytes before the common result encoder applies its final 4 KiB UTF-8 preview limit. VARCHAR/RAW cells have Oracle's fixed scalar size ceiling. Object/JSON/LONG/BFILE and approximate floating types are outside the initial result subset. Date/timestamp fetching uses explicit NLS formats and avoids a JavaScript Date conversion.

The operation deadline covers the whole session; `callTimeout` additionally bounds individual round trips. Cancellation uses `connection.break()`, waits for the operation to settle and closes the private connection. Sessions and statements are never automatically replayed or switched to Thick mode.

## Verification

Run `ORCA_BACKGROUND_LAUNCH=1 pnpm test:database tests/database/oracle-adapter.integration.test.ts` with Docker and OpenSSL. This integration gate runs under Node, matching the service runtime; Bun's TLS socket renegotiation is incompatible with the driver's TCPS flow. The `gvenzl/oracle-free:23-full` fixture binds only random loopback ports and generates a disposable server wallet/certificate and explicit fixture-only passwords. It does not read project credentials. Missing Docker/images/startup fail the gate rather than silently skipping it.
