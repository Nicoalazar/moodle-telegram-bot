// Cliente para ntfy.sh (https://ntfy.sh/docs/publish/): no requiere cuenta ni token.
// El "topic" es simplemente un nombre elegido por el usuario dentro de la URL
// (ej. https://ntfy.sh/aula-nico-8271); cualquiera que lo conozca puede suscribirse,
// así que conviene elegir algo no adivinable.
const TZ = 'America/Argentina/Buenos_Aires';
const MAX_MESSAGE_LEN = 3800; // ntfy trunca mensajes muy largos; recortamos nosotros con aviso.

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
  const lines = [`${diff.courseFullname}:`];

  const deadlineItems = [
    ...diff.dueSoonEvents.map((e) => ({ label: e.name, timestamp: e.timestart, tag: 'Vence pronto' })),
    ...diff.newAssignments
      .filter((a) => a.duedate)
      .map((a) => ({ label: a.name, timestamp: a.duedate, tag: 'Tarea nueva' })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  for (const item of deadlineItems) {
    lines.push(`- ${item.tag} (${formatDate(item.timestamp)}): ${item.label}`);
  }
  for (const a of diff.newAssignments.filter((a) => !a.duedate)) {
    lines.push(`- Tarea nueva: ${a.name}`);
  }
  if (diff.noDueDatePending.length > 0 && diff.noDueDatePending.length <= 4) {
    for (const p of diff.noDueDatePending) lines.push(`- Pendiente (sin fecha): ${p.name} [${p.modname}]`);
  } else if (diff.noDueDatePending.length > 4) {
    lines.push(`- ${diff.noDueDatePending.length} pendientes sin fecha de entrega`);
  }
  if (diff.newModules.length > 0 && diff.newModules.length <= 4) {
    for (const m of diff.newModules) lines.push(`- Nuevo: ${m.name} [${m.modname}]`);
  } else if (diff.newModules.length > 4) {
    lines.push(`- ${diff.newModules.length} contenidos nuevos`);
  }
  if (diff.newGrades.length > 0 && diff.newGrades.length <= 4) {
    for (const g of diff.newGrades) lines.push(`- Nota: ${g.itemName} = ${g.gradeFormatted}`);
  } else if (diff.newGrades.length > 4) {
    lines.push(`- ${diff.newGrades.length} notas nuevas`);
  }
  if (diff.newForumActivity.length > 0 && diff.newForumActivity.length <= 4) {
    for (const f of diff.newForumActivity) {
      const kindLabel = f.kind === 'tema' ? 'Nuevo tema' : 'Nueva respuesta';
      lines.push(`- ${kindLabel} en "${f.forumName}": ${f.discussionName}`);
    }
  } else if (diff.newForumActivity.length > 4) {
    lines.push(`- ${diff.newForumActivity.length} novedades en foros`);
  }

  return lines.join('\n');
}

/** Arma { title, message } para una única notificación ntfy con todas las materias que tienen novedades. */
export function buildNtfySummary(courseDiffs, { noNewsMessage = 'No hay nada nuevo, disfrutá la vida' } = {}) {
  const withNews = courseDiffs.filter((d) => d.hasNews);
  if (withNews.length === 0) {
    return { title: 'Aula virtual: sin novedades', message: noNewsMessage };
  }

  withNews.sort((a, b) => courseSoonestTimestamp(a) - courseSoonestTimestamp(b));
  let message = withNews.map(buildCourseBlock).join('\n\n');
  let truncated = false;
  if (message.length > MAX_MESSAGE_LEN) {
    message = message.slice(0, MAX_MESSAGE_LEN);
    truncated = true;
  }
  if (truncated) {
    message += '\n\n(recortado por espacio — corré el script localmente para ver el detalle completo)';
  }

  const title =
    withNews.length === 1
      ? `Novedad en ${withNews[0].courseFullname}`
      : `Novedades en ${withNews.length} materias`;

  return { title, message };
}

function parseTopicUrl(topicUrl) {
  const url = new URL(topicUrl);
  const topic = url.pathname.replace(/^\/+/, '');
  if (!topic) throw new Error(`NTFY_TOPIC_URL inválida (sin topic): ${topicUrl}`);
  return { base: `${url.protocol}//${url.host}`, topic };
}

/**
 * Publica una notificación en ntfy.sh (o un server ntfy self-hosted) vía su API JSON
 * (evita problemas de encoding con headers no-ASCII).
 * `priority` es opcional: si se pasa, debe ser numérica 1 (min) a 5 (max) — ntfy rechaza
 * strings como "default" con un error de "JSON inválido" engañoso. Si no se pasa, se omite
 * y ntfy usa su propio default (3).
 */
export async function sendNtfyMessage({ topicUrl, title, message, priority }) {
  const { base, topic } = parseTopicUrl(topicUrl);
  const payload = { topic, title, message };
  if (priority !== undefined) payload.priority = priority;

  let res;
  try {
    res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`ntfy: error de red (${err.message})`);
  }

  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`ntfy: HTTP ${res.status} ${res.statusText}${bodyText ? ` — ${bodyText}` : ''}`);
  }
}

export async function sendNtfySummary({ topicUrl, courseDiffs, noNewsMessage }) {
  const { title, message } = buildNtfySummary(courseDiffs, { noNewsMessage });
  await sendNtfyMessage({ topicUrl, title, message });
}
