const TZ = 'America/Argentina/Buenos_Aires';
const MAX_CHUNK_LEN = 3800; // margen bajo el límite de 4096 de Telegram

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(ms) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

function courseSoonestTimestamp(diff) {
  const dates = [
    ...diff.newAssignments.filter((a) => a.duedate).map((a) => a.duedate),
    ...diff.dueSoonEvents.map((e) => e.timestart),
  ];
  return dates.length ? Math.min(...dates) : Infinity;
}

function buildCourseBlock(diff) {
  const lines = [];

  const deadlineItems = [
    ...diff.dueSoonEvents.map((e) => ({ label: e.name, timestamp: e.timestart, tag: 'Vence pronto' })),
    ...diff.newAssignments
      .filter((a) => a.duedate)
      .map((a) => ({ label: a.name, timestamp: a.duedate, tag: 'Tarea nueva' })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  for (const item of deadlineItems) {
    lines.push(`- ${item.tag} (${formatDate(item.timestamp)}): ${escapeHtml(item.label)}`);
  }

  for (const a of diff.newAssignments.filter((a) => !a.duedate)) {
    lines.push(`- Tarea nueva: ${escapeHtml(a.name)}`);
  }

  if (diff.noDueDatePending.length > 0 && diff.noDueDatePending.length <= 4) {
    for (const p of diff.noDueDatePending) {
      lines.push(`- Pendiente (sin fecha): ${escapeHtml(p.name)} [${escapeHtml(p.modname)}]`);
    }
  } else if (diff.noDueDatePending.length > 4) {
    lines.push(`- ${diff.noDueDatePending.length} pendientes sin fecha de entrega`);
  }

  if (diff.newModules.length > 0 && diff.newModules.length <= 4) {
    for (const m of diff.newModules) {
      lines.push(`- Nuevo: ${escapeHtml(m.name)} [${escapeHtml(m.modname)}]`);
    }
  } else if (diff.newModules.length > 4) {
    lines.push(`- ${diff.newModules.length} contenidos nuevos`);
  }

  if (diff.newGrades.length > 0 && diff.newGrades.length <= 4) {
    for (const g of diff.newGrades) {
      lines.push(`- Nota: ${escapeHtml(g.itemName)} = ${escapeHtml(g.gradeFormatted)}`);
    }
  } else if (diff.newGrades.length > 4) {
    lines.push(`- ${diff.newGrades.length} notas nuevas`);
  }

  if (diff.newForumActivity.length > 0 && diff.newForumActivity.length <= 4) {
    for (const f of diff.newForumActivity) {
      const kindLabel = f.kind === 'tema' ? 'Nuevo tema' : 'Nueva respuesta';
      lines.push(`- ${kindLabel} en "${escapeHtml(f.forumName)}": ${escapeHtml(f.discussionName)}`);
    }
  } else if (diff.newForumActivity.length > 4) {
    lines.push(`- ${diff.newForumActivity.length} novedades en foros`);
  }

  return `<b>${escapeHtml(diff.courseFullname)}</b>\n${lines.join('\n')}`;
}

/** Junta bloques de curso en uno o más mensajes, respetando el límite de largo de Telegram. */
function chunkBlocks(header, blocks, maxLen = MAX_CHUNK_LEN) {
  const chunks = [];
  let current = header;
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > maxLen && current !== header && current) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Arma el/los mensaje(s) de resumen a partir de los resultados de diffCourse
 * de todas las materias. Agrupa por materia y prioriza (ordena) las materias
 * que tengan el vencimiento más cercano primero. Devuelve un array de
 * strings (normalmente de longitud 1; más de uno solo si el resumen es
 * demasiado largo para un único mensaje de Telegram).
 */
export function buildSummaryMessages(courseDiffs, { noNewsMessage = 'No hay nada nuevo, disfrutá la vida' } = {}) {
  const withNews = courseDiffs.filter((d) => d.hasNews);
  if (withNews.length === 0) return [noNewsMessage];

  withNews.sort((a, b) => courseSoonestTimestamp(a) - courseSoonestTimestamp(b));
  const blocks = withNews.map(buildCourseBlock);

  return chunkBlocks('Novedades en tu aula virtual:', blocks);
}

export async function sendTelegramMessage({ botToken, chatId, text }) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: 'true',
      }).toString(),
    });
  } catch (err) {
    throw new Error(`Telegram: error de red (${err.message})`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Telegram: respuesta no-JSON (${err.message})`);
  }

  if (!data.ok) {
    throw new Error(`Telegram error: ${data.description ?? 'desconocido'} (code ${data.error_code ?? '?'})`);
  }
  return data.result;
}

/** Envía todos los mensajes en orden, con una pequeña pausa entre cada uno. Si alguno falla, corta y propaga el error. */
export async function sendSummary({ botToken, chatId, messages, delayMs = 500 }) {
  for (const text of messages) {
    await sendTelegramMessage({ botToken, chatId, text });
    await sleep(delayMs);
  }
}
