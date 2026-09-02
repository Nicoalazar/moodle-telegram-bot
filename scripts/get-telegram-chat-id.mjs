#!/usr/bin/env node
// Script interactivo: pide el token del bot (de @BotFather), te pide que le
// mandes un mensaje al bot, y detecta tu chat_id vía getUpdates. Guarda ambos
// valores en .env.
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

async function main() {
  console.log('=== Obtener TELEGRAM_CHAT_ID ===\n');

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    console.log('Usando TELEGRAM_BOT_TOKEN existente desde .env');
  } else {
    token = (await ask('Token del bot (te lo dio @BotFather): ')).trim();
  }

  console.log('\nAhora andá a Telegram y mandale cualquier mensaje a tu bot (ej: "hola").');
  await ask('Presioná Enter una vez que ya le escribiste... ');

  let data;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    data = await res.json();
  } catch (err) {
    console.error('\nError de red al contactar Telegram:', err.message);
    process.exit(1);
  }

  if (!data.ok) {
    console.error('\nTelegram devolvió un error:', data.description);
    process.exit(1);
  }

  const chatsById = new Map();
  for (const update of data.result) {
    const chat = update.message?.chat ?? update.channel_post?.chat;
    if (chat) {
      chatsById.set(chat.id, chat.title || chat.username || chat.first_name || String(chat.id));
    }
  }

  if (chatsById.size === 0) {
    console.error('\nNo se encontraron mensajes recientes. Escribile al bot y volvé a correr este script.');
    process.exit(1);
  }

  const chats = [...chatsById.entries()];
  console.log('\nChats encontrados:');
  chats.forEach(([id, name], i) => console.log(`  [${i}] id=${id}  (${name})`));

  let chosen = chats[0];
  if (chats.length > 1) {
    const idxRaw = await ask(`\nElegí el índice a usar [0-${chats.length - 1}] (default 0): `);
    const idx = Number(idxRaw.trim());
    if (Number.isInteger(idx) && chats[idx]) chosen = chats[idx];
  }

  const [chatId] = chosen;
  upsertEnvVars({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: String(chatId) });
  console.log(`\nListo. Se guardó en .env: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID=${chatId}`);
}

main();
