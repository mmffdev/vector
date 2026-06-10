// Standalone dotenv/DSN resolver for the log viewer.
//
// This tool deliberately does not import the backend env loader. It reads only
// the keys named in config.json, supports multi-DB sources, and never logs raw
// credentials.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEnvFile(filePath) {
  const values = new Map();
  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return values;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values.set(key, val);
  }
  return values;
}

function readKey(envValues, key) {
  return process.env[key] || envValues.get(key) || '';
}

function buildUrlFromParts(envValues, parts = {}) {
  const host = readKey(envValues, parts.host);
  const port = readKey(envValues, parts.port) || '5432';
  const user = readKey(envValues, parts.user);
  const password = readKey(envValues, parts.password);
  const database = readKey(envValues, parts.database);

  if (!host || !user || !database) return '';
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  return `postgres://${auth}@${host}:${port}/${database}?sslmode=disable`;
}

function resolveOneDatabase(key, dbCfg = {}) {
  const overrideKey = `LOG_VIEWER_${key.toUpperCase()}_DB_URL`;
  if (process.env[overrideKey]) {
    return { key, url: process.env[overrideKey], source: `env:${overrideKey}` };
  }

  if (key === 'vector' && process.env.LOG_VIEWER_DB_URL) {
    return { key, url: process.env.LOG_VIEWER_DB_URL, source: 'env:LOG_VIEWER_DB_URL' };
  }

  const envFile = resolve(__dirname, '..', dbCfg.envFile || '../backend/.env.dev');
  const envValues = readEnvFile(envFile);
  const urlKey = dbCfg.urlKey || (dbCfg.parts ? '' : 'VECTOR_ARTEFACTS_DB_URL');
  const url = readKey(envValues, urlKey) || buildUrlFromParts(envValues, dbCfg.parts);

  if (!url) {
    throw new Error(
      `Could not resolve database ${key}. Set ${overrideKey}, or ensure ${urlKey || 'configured parts'} exist in ${envFile}.`
    );
  }
  return { key, url, source: `${dbCfg.envFile || '../backend/.env.dev'}:${urlKey || 'parts'}` };
}

export function resolveDatabases(config) {
  const databaseDefs = config.databases || {
    vector: config.db || {},
  };

  return Object.fromEntries(
    Object.entries(databaseDefs).map(([key, dbCfg]) => {
      const resolved = resolveOneDatabase(key, dbCfg);
      return [
        key,
        {
          ...dbCfg,
          key,
          label: dbCfg.label || key,
          url: resolved.url,
          source: resolved.source,
        },
      ];
    })
  );
}

export function redactDsn(url) {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `postgres://<redacted>@${u.host}/${db}`;
  } catch {
    return '<unparseable-dsn>';
  }
}
