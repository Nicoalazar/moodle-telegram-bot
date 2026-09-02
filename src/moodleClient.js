// Cliente para el REST endpoint de Moodle (/webservice/rest/server.php, formato json).
// Docs: https://docs.moodle.org/dev/Web_service_API_functions

export class MoodleApiError extends Error {
  constructor(message, { errorcode, exception, wsfunction } = {}) {
    super(`[Moodle:${wsfunction ?? '?'}] ${message}${errorcode ? ` (${errorcode})` : ''}`);
    this.name = 'MoodleApiError';
    this.errorcode = errorcode;
    this.exception = exception;
    this.wsfunction = wsfunction;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convierte objetos/arrays anidados al formato de query params que espera Moodle: key[0]=a&key[1]=b, filtro[campo]=valor, etc. */
function flattenParams(obj) {
  const params = new URLSearchParams();
  function walk(value, key) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${key}[${i}]`));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(v, `${key}[${k}]`));
    } else {
      params.append(key, String(value));
    }
  }
  Object.entries(obj).forEach(([k, v]) => walk(v, k));
  return params;
}

/**
 * Crea un cliente de Moodle.
 * @param {object} opts
 * @param {string} opts.baseUrl - ej: https://aulasvirtuales.bue.edu.ar
 * @param {string} opts.token - MOODLE_TOKEN
 * @param {number} [opts.rateLimitMs] - pausa mínima entre llamadas por-curso (default 400ms)
 */
export function createMoodleClient({ baseUrl, token, rateLimitMs = 400 }) {
  if (!baseUrl) throw new Error('createMoodleClient: falta baseUrl');
  if (!token) throw new Error('createMoodleClient: falta token');

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/webservice/rest/server.php`;

  async function callFunction(wsfunction, params = {}) {
    const body = flattenParams(params);
    body.set('wstoken', token);
    body.set('wsfunction', wsfunction);
    body.set('moodlewsrestformat', 'json');

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new MoodleApiError(`Error de red: ${err.message}`, { wsfunction });
    }

    if (!res.ok) {
      throw new MoodleApiError(`HTTP ${res.status} ${res.statusText}`, { wsfunction });
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new MoodleApiError(`Respuesta no-JSON: ${err.message}`, { wsfunction });
    }

    // Moodle devuelve HTTP 200 con un objeto {exception, errorcode, message} en errores.
    if (data && typeof data === 'object' && !Array.isArray(data) && data.exception) {
      throw new MoodleApiError(data.message ?? data.exception, {
        errorcode: data.errorcode,
        exception: data.exception,
        wsfunction,
      });
    }

    return data;
  }

  async function getSiteInfo() {
    return callFunction('core_webservice_get_site_info');
  }

  async function getUserCourses(userid) {
    return callFunction('core_enrol_get_users_courses', { userid });
  }

  async function getCourseContents(courseid) {
    return callFunction('core_course_get_contents', { courseid });
  }

  /** Llama core_course_get_contents para varios cursos, con una pausa entre cada llamada. */
  async function getAllCourseContents(courseIds) {
    const results = new Map();
    for (const courseid of courseIds) {
      try {
        results.set(courseid, await getCourseContents(courseid));
      } catch (err) {
        results.set(courseid, { error: err });
      }
      await sleep(rateLimitMs);
    }
    return results;
  }

  async function getAssignments(courseIds) {
    return callFunction('mod_assign_get_assignments', { courseids: courseIds });
  }

  async function getUpcomingEvents() {
    return callFunction('core_calendar_get_calendar_upcoming_view', {
      courseid: 0,
      categoryid: 0,
    });
  }

  async function getForumDiscussions(forumid) {
    return callFunction('mod_forum_get_forum_discussions', { forumid });
  }

  /** Llama mod_forum_get_forum_discussions para varios foros, con una pausa entre cada llamada. */
  async function getManyForumDiscussions(forumIds) {
    const results = new Map();
    for (const forumid of forumIds) {
      try {
        results.set(forumid, await getForumDiscussions(forumid));
      } catch (err) {
        results.set(forumid, { error: err });
      }
      await sleep(rateLimitMs);
    }
    return results;
  }

  async function getCourseGrades(courseid, userid) {
    return callFunction('gradereport_user_get_grade_items', { courseid, userid });
  }

  /** Llama gradereport_user_get_grade_items para varios cursos, con una pausa entre cada llamada. */
  async function getAllCourseGrades(courseIds, userid) {
    const results = new Map();
    for (const courseid of courseIds) {
      try {
        results.set(courseid, await getCourseGrades(courseid, userid));
      } catch (err) {
        results.set(courseid, { error: err });
      }
      await sleep(rateLimitMs);
    }
    return results;
  }

  return {
    callFunction,
    getSiteInfo,
    getUserCourses,
    getCourseContents,
    getAllCourseContents,
    getAssignments,
    getUpcomingEvents,
    getForumDiscussions,
    getManyForumDiscussions,
    getCourseGrades,
    getAllCourseGrades,
  };
}
