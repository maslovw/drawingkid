// SQLite storage: star ledger, App Store transactions, ideas in progress, daily spend,
// the prompt cache and anonymous counters for the launch metrics.
//
// Nothing here identifies a person. Accounts are the StoreKit appAccountToken (a random
// UUID made by the app); prompt text is deleted after PROMPT_RETENTION_HOURS.

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  token TEXT PRIMARY KEY,
  stars INTEGER NOT NULL DEFAULT 0 CHECK (stars >= 0),
  full_studio INTEGER NOT NULL DEFAULT 0,
  free_star_claimed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL,
  account TEXT NOT NULL,
  product_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  ownership TEXT NOT NULL,
  environment TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_account ON transactions (account);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  prompt TEXT,
  images INTEGER NOT NULL DEFAULT 0,
  charged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY,
  account TEXT NOT NULL,
  idea_id TEXT NOT NULL,
  cached INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS generations_account_time ON generations (account, created_at);
CREATE TABLE IF NOT EXISTS spend (
  day TEXT PRIMARY KEY,
  usd REAL NOT NULL DEFAULT 0,
  alerted_at_percent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stats (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
`;

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class Store {
  constructor(path, { clock = Date.now } = {}) {
    this.db = new DatabaseSync(path);
    this.clock = clock;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // Runs `fn` in one transaction; any throw rolls everything back.
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // --- Accounts and stars --------------------------------------------------

  account(token) {
    this.db.prepare('INSERT OR IGNORE INTO accounts (token, created_at) VALUES (?, ?)').run(token, this.clock());
    const row = this.db.prepare('SELECT * FROM accounts WHERE token = ?').get(token);
    return { stars: row.stars, fullStudio: Boolean(row.full_studio), freeStarClaimed: Boolean(row.free_star_claimed) };
  }

  addStars(token, stars) {
    this.account(token);
    this.db.prepare('UPDATE accounts SET stars = stars + ? WHERE token = ?').run(stars, token);
  }

  // Takes one star if there is one. Returns false when the balance is 0.
  takeStar(token) {
    this.account(token);
    return this.db.prepare('UPDATE accounts SET stars = stars - 1 WHERE token = ? AND stars > 0').run(token).changes === 1;
  }

  // Marks the free star as claimed and credits it; false if this account already had it.
  claimFreeStar(token) {
    this.account(token);
    return this.tx(() => {
      const changed = this.db
        .prepare('UPDATE accounts SET free_star_claimed = 1, stars = stars + 1 WHERE token = ? AND free_star_claimed = 0')
        .run(token).changes;
      return changed === 1;
    });
  }

  // --- App Store transactions ----------------------------------------------

  // Records a verified transaction and credits it once. Returns false if it was already
  // recorded (a replay or a restore), so the caller doesn't credit twice.
  recordTransaction({ transactionId, originalTransactionId, account, productId, stars, fullStudio, ownership, environment }) {
    this.account(account);
    return this.tx(() => {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO transactions
           (transaction_id, original_transaction_id, account, product_id, stars, ownership, environment, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(transactionId, originalTransactionId, account, productId, stars, ownership, environment, this.clock()).changes;
      if (fullStudio) this.db.prepare('UPDATE accounts SET full_studio = 1 WHERE token = ?').run(account);
      if (!inserted) return false;
      if (stars) this.db.prepare('UPDATE accounts SET stars = stars + ? WHERE token = ?').run(stars, account);
      return true;
    });
  }

  // Undoes a refunded or revoked transaction: removes the stars it gave, as far as they
  // haven't been spent, and the Full Studio flag. Returns the transaction, or null.
  revokeTransaction(transactionId, { fullStudio }) {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId);
      if (!row || row.revoked) return null;
      this.db.prepare('UPDATE transactions SET revoked = 1 WHERE transaction_id = ?').run(transactionId);
      this.db.prepare('UPDATE accounts SET stars = MAX(0, stars - ?) WHERE token = ?').run(row.stars, row.account);
      if (fullStudio) this.db.prepare('UPDATE accounts SET full_studio = 0 WHERE token = ?').run(row.account);
      return row;
    });
  }

  // --- Ideas -----------------------------------------------------------------

  createIdea({ id, account, prompt, charged }) {
    this.db
      .prepare('INSERT INTO ideas (id, account, prompt, charged, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, account, prompt, charged ? 1 : 0, this.clock());
  }

  idea(id) {
    return this.db.prepare('SELECT * FROM ideas WHERE id = ?').get(id) ?? null;
  }

  countImage(ideaId) {
    this.db.prepare('UPDATE ideas SET images = images + 1 WHERE id = ?').run(ideaId);
  }

  // A first page that never arrived: the idea is dropped and its star goes back.
  refundIdea(ideaId) {
    this.tx(() => {
      const row = this.idea(ideaId);
      if (!row) return;
      this.db.prepare('DELETE FROM ideas WHERE id = ?').run(ideaId);
      if (row.charged) this.db.prepare('UPDATE accounts SET stars = stars + 1 WHERE token = ?').run(row.account);
    });
  }

  // --- Generations, spend and limits ---------------------------------------

  recordGeneration({ account, ideaId, cached, costUsd }) {
    const now = this.clock();
    this.db
      .prepare('INSERT INTO generations (account, idea_id, cached, cost_usd, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(account, ideaId, cached ? 1 : 0, costUsd, now);
    if (costUsd > 0) this.addSpend(costUsd);
  }

  imagesInLastHour(account) {
    const since = this.clock() - 3600_000;
    return this.db.prepare('SELECT COUNT(*) AS n FROM generations WHERE account = ? AND created_at > ?').get(account, since).n;
  }

  addSpend(usd) {
    this.db
      .prepare('INSERT INTO spend (day, usd) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET usd = usd + excluded.usd')
      .run(today(this.clock()), usd);
  }

  spendToday() {
    return this.db.prepare('SELECT usd, alerted_at_percent FROM spend WHERE day = ?').get(today(this.clock())) ?? { usd: 0, alerted_at_percent: 0 };
  }

  markAlerted(percent) {
    this.db
      .prepare('INSERT INTO spend (day, alerted_at_percent) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET alerted_at_percent = excluded.alerted_at_percent')
      .run(today(this.clock()), percent);
  }

  // --- Prompt cache ----------------------------------------------------------

  cached(key) {
    const row = this.db.prepare('SELECT file FROM cache WHERE key = ?').get(key);
    if (row) this.db.prepare('UPDATE cache SET hits = hits + 1 WHERE key = ?').run(key);
    return row?.file ?? null;
  }

  putCache(key, file) {
    this.db.prepare('INSERT OR IGNORE INTO cache (key, file, created_at) VALUES (?, ?, ?)').run(key, file, this.clock());
  }

  // --- Counters for the launch metrics --------------------------------------

  count(name, by = 1) {
    this.db
      .prepare('INSERT INTO stats (day, name, count) VALUES (?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET count = count + excluded.count')
      .run(today(this.clock()), name, by);
  }

  stats(sinceDay) {
    return this.db.prepare('SELECT name, SUM(count) AS count FROM stats WHERE day >= ? GROUP BY name ORDER BY name').all(sinceDay);
  }

  // --- Retention --------------------------------------------------------------

  purge({ promptRetentionHours, ideaRetentionDays }) {
    const now = this.clock();
    const prompts = this.db
      .prepare('UPDATE ideas SET prompt = NULL WHERE prompt IS NOT NULL AND created_at < ?')
      .run(now - promptRetentionHours * 3600_000).changes;
    const ideas = this.db.prepare('DELETE FROM ideas WHERE created_at < ?').run(now - ideaRetentionDays * 86400_000).changes;
    this.db.prepare('DELETE FROM generations WHERE created_at < ?').run(now - ideaRetentionDays * 86400_000);
    return { prompts, ideas };
  }
}
