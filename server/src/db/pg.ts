import pg from 'pg';

export type RunResult = { changes: number };

export type Statement = {
  get: (...params: unknown[]) => Promise<Record<string, unknown> | undefined>;
  all: (...params: unknown[]) => Promise<Record<string, unknown>[]>;
  run: (...params: unknown[]) => Promise<RunResult>;
};

export type Db = {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => Promise<void>;
};

function translateSql(sql: string): string {
  let n = 0;
  let out = sql.replace(/\?/g, () => `$${++n}`);
  out = out.replace(/datetime\('now',\s*'\+1 year'\)/gi, "(NOW() + INTERVAL '1 year')::text");
  out = out.replace(/datetime\('now'\)/gi, 'NOW()::text');
  out = out.replace(/date\('now'\)/gi, 'CURRENT_DATE::text');
  out = out.replace(/\bexcluded\./gi, 'EXCLUDED.');
  out = out.replace(/""/g, "''");
  return out;
}

export function createPgDb(pool: pg.Pool): Db {
  return {
    prepare(sql: string): Statement {
      const text = translateSql(sql);
      return {
        async get(...params: unknown[]) {
          const result = await pool.query(text, params);
          return result.rows[0] as Record<string, unknown> | undefined;
        },
        async all(...params: unknown[]) {
          const result = await pool.query(text, params);
          return result.rows as Record<string, unknown>[];
        },
        async run(...params: unknown[]) {
          const result = await pool.query(text, params);
          return { changes: result.rowCount ?? 0 };
        },
      };
    },
    async exec(sql: string) {
      const text = translateSql(sql);
      await pool.query(text);
    },
  };
}
