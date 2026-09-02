#!/usr/bin/env node
import { loadEnv } from './src/env.js';
import { createMoodleClient } from './src/moodleClient.js';
import { loadState, saveState, diffCourse, applyCourseDiff, isModuleVisible, isSectionVisible } from './src/state.js';
import { buildSummaryMessages, sendSummary } from './src/telegram.js';

loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta la variable de entorno ${name}`);
    process.exit(1);
  }
  return value;
}

function parseCourseIds(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

async function main() {
  const baseUrl = requireEnv('MOODLE_BASE_URL');
  const token = requireEnv('MOODLE_TOKEN');
  const courseIds = parseCourseIds(requireEnv('MOODLE_COURSE_IDS'));

  // En dry-run no hace falta tener credenciales de Telegram configuradas.
  const botToken = DRY_RUN ? process.env.TELEGRAM_BOT_TOKEN : requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = DRY_RUN ? process.env.TELEGRAM_CHAT_ID : requireEnv('TELEGRAM_CHAT_ID');

  const dueSoonDays = Number(process.env.DUE_SOON_DAYS ?? '7');
  const dueSoonMs = dueSoonDays * 24 * 60 * 60 * 1000;
  const rateLimitMs = Number(process.env.MOODLE_RATE_LIMIT_MS ?? '400');
  // Foros a ignorar (p.ej. "Oficina - Grupo 12" de grupos ajenos): patrón case-insensitive.
  const forumIgnorePattern = new RegExp(process.env.FORUM_IGNORE_PATTERN ?? 'oficina|grupo\\s*\\d+', 'i');

  const client = createMoodleClient({ baseUrl, token, rateLimitMs });
  const state = loadState();

  console.log(
    `[${new Date().toISOString()}] Chequeando ${courseIds.length} materia(s)${DRY_RUN ? ' (--dry-run)' : ''}...`,
  );

  let site;
  try {
    site = await client.getSiteInfo();
  } catch (err) {
    console.error('No se pudo conectar a Moodle:', err.message);
    process.exit(1);
  }

  let userCourses;
  try {
    userCourses = await client.getUserCourses(site.userid);
  } catch (err) {
    console.error('No se pudo obtener la lista de materias:', err.message);
    process.exit(1);
  }
  const courseNameById = new Map(userCourses.map((c) => [c.id, c.fullname]));

  const trackedCourseIds = [];
  for (const id of courseIds) {
    if (!courseNameById.has(id)) {
      console.warn(`Aviso: MOODLE_COURSE_IDS incluye ${id} pero no aparece entre tus cursos actuales. Se lo salta.`);
      continue;
    }
    trackedCourseIds.push(id);
  }
  if (trackedCourseIds.length === 0) {
    console.error('Ninguno de los MOODLE_COURSE_IDS configurados es válido. Abortando.');
    process.exit(1);
  }

  console.log('Obteniendo contenidos de cada materia...');
  const contentsByCourse = await client.getAllCourseContents(trackedCourseIds);

  console.log('Obteniendo tareas...');
  const assignmentsByCourse = new Map();
  try {
    const assignRes = await client.getAssignments(trackedCourseIds);
    for (const c of assignRes.courses ?? []) {
      assignmentsByCourse.set(c.id, c.assignments ?? []);
    }
  } catch (err) {
    console.warn('Aviso: no se pudieron obtener las tareas (mod_assign_get_assignments):', err.message);
  }

  console.log('Obteniendo próximos vencimientos...');
  const upcomingByCourse = new Map();
  try {
    const upcoming = await client.getUpcomingEvents();
    for (const ev of upcoming.events ?? []) {
      const cid = ev.course?.id;
      if (cid == null) continue;
      if (!upcomingByCourse.has(cid)) upcomingByCourse.set(cid, []);
      upcomingByCourse.get(cid).push(ev);
    }
  } catch (err) {
    console.warn(
      'Aviso: no se pudieron obtener los próximos vencimientos (core_calendar_get_calendar_upcoming_view):',
      err.message,
    );
  }

  // Foros a rastrear por curso: módulos modname='forum' visibles, salvo que matcheen
  // FORUM_IGNORE_PATTERN (por defecto excluye "Oficina - Grupo N" de grupos ajenos).
  console.log('Buscando foros a rastrear...');
  const forumModulesByCourse = new Map();
  const allForumIds = new Set();
  for (const courseId of trackedCourseIds) {
    const contentsResult = contentsByCourse.get(courseId);
    if (contentsResult?.error) continue;
    const forums = [];
    for (const section of contentsResult ?? []) {
      if (!isSectionVisible(section)) continue;
      for (const mod of section.modules ?? []) {
        if (mod.modname !== 'forum' || !isModuleVisible(mod)) continue;
        if (forumIgnorePattern.test(mod.name)) continue;
        forums.push({ forumId: mod.instance, forumName: mod.name });
        allForumIds.add(mod.instance);
      }
    }
    forumModulesByCourse.set(courseId, forums);
  }

  console.log(`Obteniendo discusiones de ${allForumIds.size} foro(s)...`);
  const discussionsByForumId = await client.getManyForumDiscussions([...allForumIds]);

  console.log('Obteniendo calificaciones...');
  const gradesByCourse = await client.getAllCourseGrades(trackedCourseIds, site.userid);

  const diffs = [];
  for (const courseId of trackedCourseIds) {
    const contentsResult = contentsByCourse.get(courseId);
    if (contentsResult?.error) {
      console.warn(`Aviso: no se pudo obtener contenido del curso ${courseId}: ${contentsResult.error.message}`);
    }
    const contents = contentsResult?.error ? [] : contentsResult;

    const forumsForCourse = (forumModulesByCourse.get(courseId) ?? []).map((f) => {
      const res = discussionsByForumId.get(f.forumId);
      if (res?.error) {
        console.warn(`Aviso: no se pudo obtener el foro "${f.forumName}" (${f.forumId}): ${res.error.message}`);
        return { ...f, discussions: [] };
      }
      return { ...f, discussions: res?.discussions ?? [] };
    });

    const gradesResult = gradesByCourse.get(courseId);
    if (gradesResult?.error) {
      console.warn(`Aviso: no se pudieron obtener notas del curso ${courseId}: ${gradesResult.error.message}`);
    }
    const gradeItemsForCourse = gradesResult?.error ? [] : gradesResult?.usergrades?.[0]?.gradeitems ?? [];

    diffs.push(
      diffCourse({
        courseId,
        courseFullname: courseNameById.get(courseId),
        prevCourseState: state.courses[courseId] ?? null,
        contents,
        assignmentsForCourse: assignmentsByCourse.get(courseId) ?? [],
        upcomingEventsForCourse: upcomingByCourse.get(courseId) ?? [],
        forumsForCourse,
        gradeItemsForCourse,
        dueSoonMs,
      }),
    );
  }

  const messages = buildSummaryMessages(diffs, { noNewsMessage: 'No hay nada nuevo, disfrutá la vida' });

  if (DRY_RUN) {
    console.log('\n=== DRY RUN: esto es lo que se mandaría por Telegram ===\n');
    messages.forEach((text, i) => {
      console.log(`--- mensaje ${i + 1}/${messages.length} ---`);
      console.log(text);
      console.log();
    });
    console.log('(No se envió nada a Telegram ni se actualizó data/state.json — es un dry-run)');
    return;
  }

  try {
    await sendSummary({ botToken, chatId, messages });
  } catch (err) {
    console.error('Error enviando a Telegram. NO se actualiza el estado (para no perder novedades):', err.message);
    process.exit(1);
  }

  for (const diff of diffs) {
    state.courses[diff.courseId] = applyCourseDiff(diff, state.courses[diff.courseId] ?? null);
  }
  saveState(state);
  console.log('Listo: resumen enviado por Telegram y estado actualizado.');
}

main().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
