import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      DB_MIGRATION: D1Database;
      DB_MIGRATION_CARDS: D1Database;
    }
  }
}
