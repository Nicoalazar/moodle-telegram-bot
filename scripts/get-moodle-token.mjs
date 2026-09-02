#!/usr/bin/env node
// Script interactivo: pide usuario/contraseña de Moodle SOLO en esta corrida,
// obtiene un token vía Web Service API (servicio moodle_mobile_app) y lo guarda
// en .env. La contraseña nunca se escribe a disco.
import readline from 'node:readline';
import { loadEnv, upsertEnvVars } from '../src/env.js';

loadEnv();

function ask(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let muted = false;
    rl._writeToOutput = (stringToWrite) => {
      if (!muted || stringToWrite === query) {
        rl.output.write(stringToWrite);
      } else if (stringToWrite === '\r\n' || stringToWrite === '\n') {
        rl.output.write('\n');
      } else {
        rl.output.write('*');
      }
    };
    rl.question(query, (value) => {
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
    muted = true;
  });
}

async function main() {
  console.log('=== Obtener MOODLE_TOKEN via Web Service API (moodle_mobile_app) ===\n');

  let baseUrl = process.env.MOODLE_BASE_URL;
  if (baseUrl) {
    console.log(`Usando MOODLE_BASE_URL existente: ${baseUrl}`);
  } else {
    baseUrl = (await ask('URL base de Moodle (ej: https://aulasvirtuales.bue.edu.ar): ')).trim();
  }
  baseUrl = baseUrl.replace(/\/+$/, '');

  const username = (await ask('Usuario de Moodle: ')).trim();
  const password = await askHidden('Contraseña de Moodle (no se guarda en ningún archivo): ');

  const tokenUrl = `${baseUrl}/login/token.php`;
  const body = new URLSearchParams({ username, password, service: 'moodle_mobile_app' });

  let data;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    data = await res.json();
  } catch (err) {
    console.error('\nError de red al contactar Moodle:', err.message);
    process.exit(1);
  }

  if (data.error) {
    console.error('\nMoodle devolvió un error:');
    console.error(`  ${data.error}${data.errorcode ? ` (${data.errorcode})` : ''}`);
    process.exit(1);
  }

  if (!data.token) {
    console.error('\nRespuesta inesperada de Moodle:', JSON.stringify(data));
    process.exit(1);
  }

  upsertEnvVars({ MOODLE_BASE_URL: baseUrl, MOODLE_TOKEN: data.token });
  console.log('\nListo. Se guardó en .env: MOODLE_BASE_URL y MOODLE_TOKEN.');
}

main();
