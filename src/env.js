import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env');

/** Carga .env a process.env sin pisar variables ya seteadas en el entorno. */
export function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

/** Actualiza (o agrega) claves en .env preservando el resto del archivo. */
export function upsertEnvVars(vars) {
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  }
  const keysToSet = new Set(Object.keys(vars));
  const seen = new Set();
  const outLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      outLines.push(line);
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      outLines.push(line);
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (keysToSet.has(key)) {
      outLines.push(`${key}=${vars[key]}`);
      seen.add(key);
    } else {
      outLines.push(line);
    }
  }

  for (const key of keysToSet) {
    if (!seen.has(key)) {
      outLines.push(`${key}=${vars[key]}`);
    }
  }

  while (outLines.length && outLines[outLines.length - 1] === '') {
    outLines.pop();
  }

  fs.writeFileSync(ENV_PATH, outLines.join('\n') + '\n', { mode: 0o600 });
}
