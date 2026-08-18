import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "archive.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  runMigrations(db);

  return db;
}

function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database.query("SELECT name FROM schema_migrations").all().map((row) => (row as { name: string }).name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    database.transaction(() => {
      database.exec(sql);
      database
        .query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(file, new Date().toISOString());
    })();
  }
}

/** For tests: create an isolated in-memory database with the full schema applied. */
export function createTestDb(): Database {
  const testDb = new Database(":memory:");
  testDb.exec("PRAGMA foreign_keys = ON;");
  runMigrations(testDb);
  return testDb;
}
