# Moodle → Telegram: aviso de novedades del aula virtual

Chequea las materias indicadas en tu Moodle (`https://aulasvirtuales.bue.edu.ar`), detecta
qué es genuinamente nuevo desde la última corrida (contenido, tareas, vencimientos próximos)
y te manda un resumen por Telegram. Sin frameworks: Node.js 18+ con `fetch` nativo.

## Estructura

```
index.js                      orquestación completa (Fase 5)
src/env.js                    lee/escribe .env (sin dependencias externas)
src/moodleClient.js           cliente REST de Moodle (Fase 2)
src/state.js                  lectura/escritura de estado + cálculo de "qué es nuevo" (Fase 3)
src/telegram.js               armado del resumen + envío por Telegram (Fase 4)
scripts/get-moodle-token.mjs  setup interactivo: obtiene MOODLE_TOKEN (Fase 1)
scripts/get-telegram-chat-id.mjs  setup interactivo: obtiene TELEGRAM_CHAT_ID (Fase 1)
scripts/list-courses.mjs      utilidad: lista tus cursos con su ID (para armar MOODLE_COURSE_IDS)
data/state.json               estado persistido entre corridas (generado; SE versiona, ver sección de GitHub Actions)
.env                           credenciales locales (generado, no se versiona)
.github/workflows/moodle-check.yml  corrida diaria automática vía GitHub Actions
```

## Cómo se corrió esto localmente

1. **Setup inicial** (una sola vez, interactivo, en tu propia terminal):

   ```bash
   node scripts/get-moodle-token.mjs
   node scripts/get-telegram-chat-id.mjs
   ```

   El primero pide usuario/contraseña de Moodle (la contraseña se enmascara y **nunca se
   guarda en ningún archivo**) y guarda `MOODLE_BASE_URL` + `MOODLE_TOKEN` en `.env`. El
   segundo pide el token del bot de Telegram (creado antes con `@BotFather`) y detecta tu
   `chat_id` automáticamente.

2. **Elegir qué materias monitorear**: correr `npm run list-courses` para ver todos tus
   cursos con su ID, y guardar los que te interesen en `.env` como `MOODLE_COURSE_IDS`
   (separados por coma).

3. **Probar sin mandar nada real**:

   ```bash
   npm run dry-run
   ```

   Imprime por consola el resumen que se mandaría, sin tocar Telegram ni `data/state.json`.

4. **Correr de verdad** (manda el mensaje y actualiza el estado, solo si el envío fue exitoso):

   ```bash
   npm start
   ```

> Nota sobre la primera corrida: la primera vez que se procesa una materia se toma como
> "línea base" — no se listan sus módulos/tareas existentes como si fueran nuevos (para no
> spamear con todo el contenido histórico), pero sí se avisan los vencimientos próximos,
> porque son sensibles al tiempo. De ahí en adelante, cada corrida solo reporta novedades
> reales.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `MOODLE_BASE_URL` | Sí | URL base del aula virtual, ej. `https://aulasvirtuales.bue.edu.ar` |
| `MOODLE_TOKEN` | Sí | Token del Web Service API (servicio `moodle_mobile_app`) |
| `MOODLE_COURSE_IDS` | Sí | IDs de curso a monitorear, separados por coma |
| `NOTIFY_CHANNELS` | No (default `telegram`) | `telegram`, `ntfy`, o `telegram,ntfy` para ambos |
| `TELEGRAM_BOT_TOKEN` | Sí si `NOTIFY_CHANNELS` incluye `telegram` (salvo `--dry-run`) | Token del bot, de `@BotFather` |
| `TELEGRAM_CHAT_ID` | Sí si `NOTIFY_CHANNELS` incluye `telegram` (salvo `--dry-run`) | Chat al que se manda el resumen |
| `NTFY_TOPIC_URL` | Sí si `NOTIFY_CHANNELS` incluye `ntfy` (salvo `--dry-run`) | URL de tu topic en ntfy.sh, ej. `https://ntfy.sh/tu-topic-unico` |
| `DUE_SOON_DAYS` | No (default `3`) | Ventana en días para avisar "vence pronto" |
| `MOODLE_RATE_LIMIT_MS` | No (default `400`) | Pausa entre llamadas por-curso a la API de Moodle |

### Alternativa experimental: ntfy.sh (rama `feature/ntfy-notifications`)

[ntfy.sh](https://ntfy.sh) es un canal de notificaciones push que no requiere cuenta ni
token: elegís un nombre de "topic" único (ej. `https://ntfy.sh/aula-tunombre-1234`, no
adivinable por otros), lo poner en `NTFY_TOPIC_URL`, y te suscribís desde la
[app](https://ntfy.sh/docs/subscribe/phone/) o el navegador. Poné `NOTIFY_CHANNELS=ntfy` (o
`telegram,ntfy` para mandar por los dos) en `.env`. Implementado en `src/ntfy.js`, en paralelo
a `telegram.js` — no reemplaza nada de lo existente en `master`.

`index.js` lee estas variables de `process.env` (vía `.env` en local, o directamente del
entorno cuando corre como Routine — `src/env.js` nunca pisa una variable que ya esté seteada
en el entorno).

## Corrida automática (GitHub Actions)

El chequeo corre como GitHub Actions workflow
(`.github/workflows/moodle-check.yml`), no como Routine ni como tarea programada local —
ambas alternativas resultaron bloqueadas en este entorno (el proxy de salida del sandbox
rechaza la conexión a `aulasvirtuales.bue.edu.ar`, y el Task Scheduler de Windows está roto
en la PC donde se probó). Los runners de GitHub Actions corren en una red distinta, sin ese
bloqueo.

Como `data/state.json` ya no está en `.gitignore`: tras cada corrida real (no dry-run) el
workflow comitea el estado actualizado de vuelta al repo con el token por defecto
(`GITHUB_TOKEN`, con permiso `contents: write`). Es la forma elegida de persistirlo entre
corridas (alternativa descartada: `actions/cache`, que es best-effort y puede evictarse).

**Estado: en producción.** Se probó a mano con `dry_run` en `true` (confirmó que la red de
GitHub Actions llega a Moodle) y después con `dry_run` en `false` (llegó el mensaje real por
Telegram y quedó commiteado `data/state.json`). Desde ahí corre solo lunes y viernes a las
08:00 (Argentina) vía el `schedule` del workflow (cron `0 11 * * 1,5`, en UTC) — no hace falta
tocar nada más.

### Setup (referencia, ya hecho en este repo)

1. Repository secrets en GitHub → Settings → Secrets and variables → Actions (mismos valores
   que tu `.env` local): `MOODLE_BASE_URL`, `MOODLE_TOKEN`, `MOODLE_COURSE_IDS`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y, opcionalmente, `DUE_SOON_DAYS`,
   `MOODLE_RATE_LIMIT_MS`, `FORUM_IGNORE_PATTERN`.
2. Settings → Actions → General → "Workflow permissions" en **"Read and write permissions"**
   (necesario para que el workflow pueda commitear `data/state.json` de vuelta al repo).

Si en algún momento hay que rotar `MOODLE_TOKEN` o `TELEGRAM_BOT_TOKEN`, o cambiar
`MOODLE_COURSE_IDS`, se actualiza el secret correspondiente y ya — no requiere tocar el
workflow.
