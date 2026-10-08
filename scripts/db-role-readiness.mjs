/**
 * AEROSFORGE ONE — read-only PostgreSQL application-role readiness audit.
 * Run: node scripts/db-role-readiness.mjs --self-test
 *      DATABASE_URL=... node scripts/db-role-readiness.mjs
 * Uses an existing application database connection, issues only SELECT, and never prints credentials.
 * This is a strict RLS readiness gate, not a proof of least privilege or object-level authorization.
 * A database using application-layer authorization rather than RLS may fail this strict gate intentionally; document why.
 */

function assess({ superuser, bypassRls, ownedTables, rlsTables, totalTables }) {
  const issues = [];
  if (superuser) issues.push('application principal is a superuser');
  if (bypassRls) issues.push('application principal can bypass row-level security');
  if (ownedTables > 0) issues.push('application principal owns tables, normally bypassing their RLS');
  if (totalTables === 0) issues.push('no public application tables were found');
  if (totalTables > 0 && rlsTables < totalTables) issues.push('one or more public application tables lack RLS');
  return { passesStrictRlsGate: issues.length === 0, issues };
}

if (process.argv.includes('--self-test')) {
  const cases = [
    [{ superuser: false, bypassRls: false, ownedTables: 0, rlsTables: 7, totalTables: 7 }, true],
    [{ superuser: true, bypassRls: true, ownedTables: 7, rlsTables: 0, totalTables: 7 }, false],
    [{ superuser: false, bypassRls: false, ownedTables: 1, rlsTables: 7, totalTables: 7 }, false],
    [{ superuser: false, bypassRls: false, ownedTables: 0, rlsTables: 0, totalTables: 7 }, false],
    [{ superuser: false, bypassRls: false, ownedTables: 0, rlsTables: 6, totalTables: 7 }, false],
    [{ superuser: false, bypassRls: false, ownedTables: 0, rlsTables: 0, totalTables: 0 }, false],
  ];
  for (const [sample, expected] of cases) {
    if (assess(sample).passesStrictRlsGate !== expected) throw new Error('assessment failed');
  }
  console.log(JSON.stringify({ selfTest: 'passed', cases: cases.length }));
} else {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required; no network call was attempted.');
    process.exitCode = 2;
  } else {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 7000,
      query_timeout: 7000,
      application_name: 'aerosforge-readonly-role-audit',
    });
    try {
      await client.connect();
      const result = await client.query(`
        SELECT
          r.rolsuper AS superuser,
          r.rolbypassrls AS bypass_rls,
          (SELECT count(*)::int FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) AS total_tables,
          (SELECT count(*)::int FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity) AS rls_tables,
          (SELECT count(*)::int FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owned_tables
        FROM pg_roles r WHERE r.rolname = current_user;
      `);
      if (result.rowCount !== 1) throw new Error('database role lookup did not return exactly one row');
      const row = result.rows[0];
      const report = assess({
        superuser: row.superuser,
        bypassRls: row.bypass_rls,
        ownedTables: Number(row.owned_tables),
        rlsTables: Number(row.rls_tables),
        totalTables: Number(row.total_tables),
      });
      console.log(JSON.stringify({
        check: 'application-db-principal-readiness',
        totalTables: Number(row.total_tables),
        rlsEnabledTables: Number(row.rls_tables),
        ownedTables: Number(row.owned_tables),
        principalIsSuperuser: row.superuser,
        principalBypassesRls: row.bypass_rls,
        ...report,
        note: 'Role-based and record-level authorization must still be independently tested.',
      }, null, 2));
      if (!report.passesStrictRlsGate) process.exitCode = 3;
    } catch (error) {
      // Avoid accidentally exposing connection strings or credentials in driver error text.
      console.error('Database role audit failed; check network access and database credentials.');
      process.exitCode = 2;
    } finally {
      try { await client.end(); } catch { /* no logging of connection detail */ }
    }
  }
}
