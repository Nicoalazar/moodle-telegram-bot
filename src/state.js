import fs from 'node:fs';
import path from 'node:path';

const STATE_PATH = path.resolve(process.cwd(), 'data', 'state.json');

export function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { version: 1, courses: {} };
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!parsed.courses) parsed.courses = {};
    return parsed;
  } catch (err) {
    console.error(`No se pudo leer ${STATE_PATH}, arranco de estado vacío: ${err.message}`);
    return { version: 1, courses: {} };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function emptyCourseState() {
  return {
    seenModuleIds: [],
    seenAssignmentIds: [],
    notifiedDueSoonEventIds: [],
    notifiedNoDueDateIds: [],
    forums: {},
    grades: {},
  };
}

/** Lee timeclose de quiz.customdata (JSON string). Devuelve 0 si no tiene fecha de cierre. */
function quizTimeClose(mod) {
  try {
    return Number(JSON.parse(mod.customdata ?? '{}').timeclose ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function isModuleVisible(mod) {
  if (typeof mod.uservisible === 'boolean') return mod.uservisible;
  if (typeof mod.visible === 'number') return mod.visible !== 0;
  return true;
}

function stripHtml(str) {
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSectionVisible(section) {
  if (typeof section.uservisible === 'boolean') return section.uservisible;
  if (typeof section.visible === 'number') return section.visible !== 0;
  return true;
}

/**
 * Compara la respuesta de la API contra el estado previo de un curso y arma
 * la lista de "novedades". No toca el estado guardado — eso lo hace
 * applyCourseDiff, y solo después de confirmar el envío a Telegram.
 *
 * En el primer run de un curso (no hay estado previo) se toma como línea de
 * base: no se listan sus módulos/tareas existentes como "nuevos" (para no
 * spamear con todo el contenido histórico), pero sí se avisan los
 * vencimientos próximos, porque son sensibles al tiempo y no a la novedad.
 */
export function diffCourse({
  courseId,
  courseFullname,
  prevCourseState,
  contents,
  assignmentsForCourse,
  upcomingEventsForCourse,
  forumsForCourse,
  gradeItemsForCourse,
  dueSoonMs,
  now = Date.now(),
}) {
  const prev = prevCourseState ?? emptyCourseState();
  const isFirstRun = !prevCourseState;
  const seenModuleIds = new Set(prev.seenModuleIds ?? []);
  const seenAssignmentIds = new Set(prev.seenAssignmentIds ?? []);
  const notifiedDueSoonEventIds = new Set(prev.notifiedDueSoonEventIds ?? []);

  const currentModuleIds = new Set();
  const newModules = [];
  const completedModuleIds = new Set();
  const quizzesWithoutCloseDate = [];
  for (const section of contents ?? []) {
    if (!isSectionVisible(section)) continue;
    for (const mod of section.modules ?? []) {
      if (!isModuleVisible(mod)) continue;
      currentModuleIds.add(mod.id);
      if (!seenModuleIds.has(mod.id) && !isFirstRun) {
        newModules.push({
          id: mod.id,
          name: mod.name,
          modname: mod.modname,
          sectionName: section.name || null,
        });
      }
      // completiondata.state: 0 = pendiente, 1/2/3 = completado (hecho / aprobado / desaprobado).
      if (mod.completiondata?.hascompletion && mod.completiondata.state !== 0) {
        completedModuleIds.add(mod.id);
      }
      if (mod.modname === 'quiz' && quizTimeClose(mod) === 0) {
        quizzesWithoutCloseDate.push({ cmid: mod.id, name: mod.name, modname: 'quiz' });
      }
    }
  }

  const currentAssignmentIds = new Set();
  const newAssignments = [];
  for (const a of assignmentsForCourse ?? []) {
    currentAssignmentIds.add(a.id);
    if (!seenAssignmentIds.has(a.id) && !isFirstRun) {
      newAssignments.push({
        id: a.id,
        cmid: a.cmid,
        name: a.name,
        duedate: a.duedate ? a.duedate * 1000 : null,
      });
    }
  }
  // Ojo: pese al nombre, el campo `instance` de los eventos de calendario de Moodle
  // coincide con el course-module id (cmid), no con el id de la actividad (assignment.id).
  const newAssignmentCmids = new Set(newAssignments.map((a) => a.cmid));

  const dueSoonEvents = [];
  for (const ev of upcomingEventsForCourse ?? []) {
    const startMs = ev.timestart * 1000;
    if (startMs < now || startMs > now + dueSoonMs) continue;
    if (notifiedDueSoonEventIds.has(ev.id)) continue;
    // Si ya se muestra como "tarea nueva", no lo repitas como recordatorio de vencimiento.
    if (ev.modulename === 'assign' && newAssignmentCmids.has(ev.instance)) continue;
    // Si el módulo asociado ya está marcado como completado, no molestar con el recordatorio.
    if (ev.modulename && completedModuleIds.has(ev.instance)) continue;
    dueSoonEvents.push({
      id: ev.id,
      name: ev.name,
      timestart: startMs,
      modulename: ev.modulename ?? null,
    });
  }

  // --- Pendientes sin fecha de entrega/cierre ---
  // Cuestionarios y tareas sin fecha nunca aparecen en "vencimientos próximos" (no hay
  // fecha) y, si ya existían en la primera corrida, tampoco como "contenido nuevo" (quedan
  // en la línea base). Sin este chequeo quedarían invisibles para siempre. Se avisan
  // independientemente de isFirstRun, pero solo una vez por ítem (vía notifiedNoDueDateIds).
  const notifiedNoDueDateIds = new Set(prev.notifiedNoDueDateIds ?? []);
  const noDueDatePending = [];
  for (const q of quizzesWithoutCloseDate) {
    if (completedModuleIds.has(q.cmid) || notifiedNoDueDateIds.has(q.cmid)) continue;
    noDueDatePending.push(q);
  }
  for (const a of assignmentsForCourse ?? []) {
    if (a.duedate) continue;
    if (completedModuleIds.has(a.cmid) || notifiedNoDueDateIds.has(a.cmid)) continue;
    noDueDatePending.push({ cmid: a.cmid, name: a.name, modname: 'assign' });
  }

  // --- Foros: temas nuevos y respuestas nuevas en discusiones ya vistas ---
  // Baseline independiente: si el estado previo del curso no tenía `forums` (versión
  // anterior de este script, sin esta funcionalidad), tratamos esta materia como
  // "primera vez" SOLO para foros, para no volcar de golpe todo el historial.
  const isFirstRunForums = isFirstRun || prev.forums === undefined;
  const prevForums = prev.forums ?? {};
  const nextForums = {};
  const newForumActivity = [];
  for (const forum of forumsForCourse ?? []) {
    const prevForum = prevForums[forum.forumId] ?? { seenDiscussionIds: [], discussionSignatures: {} };
    const seenDiscussionIds = new Set(prevForum.seenDiscussionIds ?? []);
    const signatures = { ...(prevForum.discussionSignatures ?? {}) };
    const currentDiscussionIds = new Set();

    for (const d of forum.discussions ?? []) {
      currentDiscussionIds.add(d.id);
      const signature = `${d.numreplies ?? 0}:${d.timemodified ?? 0}`;
      if (!seenDiscussionIds.has(d.id)) {
        if (!isFirstRunForums) {
          newForumActivity.push({ forumName: forum.forumName, discussionName: d.name ?? d.subject, kind: 'tema' });
        }
      } else if (signatures[d.id] !== signature && !isFirstRunForums) {
        newForumActivity.push({ forumName: forum.forumName, discussionName: d.name ?? d.subject, kind: 'respuesta' });
      }
      signatures[d.id] = signature;
    }

    nextForums[forum.forumId] = {
      seenDiscussionIds: [...currentDiscussionIds],
      discussionSignatures: signatures,
    };
  }

  // --- Notas: ítems que pasaron a tener nota, o cuya nota cambió ---
  // Misma lógica de baseline independiente que los foros (ver comentario arriba).
  const isFirstRunGrades = isFirstRun || prev.grades === undefined;
  const prevGrades = prev.grades ?? {};
  const nextGrades = {};
  const newGrades = [];
  for (const item of gradeItemsForCourse ?? []) {
    if (item.gradeishidden) continue;
    const hasGrade = item.graderaw !== null && item.graderaw !== undefined;
    if (hasGrade) {
      const prevItem = prevGrades[item.id];
      const changed = !prevItem || prevItem.graderaw !== item.graderaw;
      if (changed && !isFirstRunGrades) {
        const label =
          item.itemname ||
          (item.itemtype === 'course' ? 'Nota final del curso' : item.itemtype === 'category' ? 'Subtotal de categoría' : 'Ítem sin nombre');
        const formatted = stripHtml(item.gradeformatted ?? String(item.graderaw));
        newGrades.push({ itemName: label, gradeFormatted: formatted });
      }
    }
    nextGrades[item.id] = { graderaw: hasGrade ? item.graderaw : null };
  }

  return {
    courseId,
    courseFullname,
    isFirstRun,
    newModules,
    newAssignments,
    dueSoonEvents,
    newForumActivity,
    newGrades,
    noDueDatePending,
    hasNews:
      newModules.length > 0 ||
      newAssignments.length > 0 ||
      dueSoonEvents.length > 0 ||
      newForumActivity.length > 0 ||
      newGrades.length > 0 ||
      noDueDatePending.length > 0,
    _currentModuleIds: currentModuleIds,
    _currentAssignmentIds: currentAssignmentIds,
    _prevNotifiedDueSoonEventIds: notifiedDueSoonEventIds,
    _prevNotifiedNoDueDateIds: notifiedNoDueDateIds,
    _nextForums: nextForums,
    _nextGrades: nextGrades,
  };
}

/** Construye el próximo estado de un curso a partir del resultado de diffCourse. Llamar SOLO tras un envío exitoso. */
export function applyCourseDiff(diffResult, prevCourseState, now = Date.now()) {
  const prev = prevCourseState ?? emptyCourseState();
  const seenModuleIds = new Set([...(prev.seenModuleIds ?? []), ...diffResult._currentModuleIds]);
  const seenAssignmentIds = new Set([...(prev.seenAssignmentIds ?? []), ...diffResult._currentAssignmentIds]);
  const notifiedDueSoonEventIds = new Set(diffResult._prevNotifiedDueSoonEventIds);
  for (const ev of diffResult.dueSoonEvents) notifiedDueSoonEventIds.add(ev.id);
  const notifiedNoDueDateIds = new Set(diffResult._prevNotifiedNoDueDateIds);
  for (const item of diffResult.noDueDatePending) notifiedNoDueDateIds.add(item.cmid);

  return {
    seenModuleIds: [...seenModuleIds],
    seenAssignmentIds: [...seenAssignmentIds],
    notifiedDueSoonEventIds: [...notifiedDueSoonEventIds],
    notifiedNoDueDateIds: [...notifiedNoDueDateIds],
    forums: diffResult._nextForums,
    grades: diffResult._nextGrades,
    lastRunAt: new Date(now).toISOString(),
  };
}
