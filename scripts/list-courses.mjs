#!/usr/bin/env node
// Utilidad: lista tus cursos de Moodle con su ID, para armar/actualizar
// MOODLE_COURSE_IDS en .env (útil al cambiar de cuatrimestre).
import { loadEnv } from '../src/env.js';
import { createMoodleClient } from '../src/moodleClient.js';

loadEnv();

const client = createMoodleClient({
  baseUrl: process.env.MOODLE_BASE_URL,
  token: process.env.MOODLE_TOKEN,
});

const site = await client.getSiteInfo();
const courses = await client.getUserCourses(site.userid);

console.log(`${courses.length} cursos encontrados para ${site.username}:\n`);
for (const c of courses) {
  console.log(`  [${c.id}] ${c.fullname}`);
}
