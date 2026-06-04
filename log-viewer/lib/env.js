// Resolves the Postgres connection string for the log viewer.
//
// Priority:
//   1. LOG_VIEWER_DB_URL  — explicit override (e.g. a read-only role you provision)
//   2. <config.db.urlKey> read from <config.db.envFile> (defaults to
//      VECTOR_ARTEFACTS_DB_URL in ../backend/.env.dev)
//
// We deliberately do NOT import the backend's env loader — this tool is
// standalone. We parse the dotenv file by hand, only for the one key we need,
// and never log the value.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Parse a single KEY=value out of a dotenv file without pulling in a dep. */
function readEnvKey(filePath, key) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    return null;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

/**
 * @param {object} config parsed config.json
 * @returns {{ url: string, source: string }}
 */
export function resolveDatabaseUrl(config) {
  if (process.env.LOG_VIEWER_DB_URL) {
    return { url: process.env.LOG_VIEWER_DB_URL, source: 'env:LOG_VIEWER_DB_URL' };
  }

  const dbCfg = config.db || {};
  const envFile = resolve(__dirname, '..', dbCfg.envFile || '../backend/.env.dev');
  const key = dbCfg.urlKey || 'VECTOR_ARTEFACTS_DB_URL';
  const url = readEnvKey(envFile, key);

  if (!url) {
    throw new Error(
      `Could not resolve a database URL. Set LOG_VIEWER_DB_URL, or ensure ` +
        `${key} exists in ${envFile}.`
    );
  }
  return { url, source: `${dbCfg.envFile || '../backend/.env.dev'}:${key}` };
}

/** Redact a DSN for safe logging — keeps host/db, hides credentials. */
export function redactDsn(url) {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `postgres://<redacted>@${u.host}/${db}`;
  } catch {
    return '<unparseable-dsn>';
  }
}
