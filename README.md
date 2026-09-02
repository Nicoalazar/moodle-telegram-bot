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
data/state.json               estado persistido entre corridas (generado, no se versiona)
.env                           credenciales locales (generado, no se versiona)
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
| `TELEGRAM_BOT_TOKEN` | Sí (salvo `--dry-run`) | Token del bot, de `@BotFather` |
| `TELEGRAM_CHAT_ID` | Sí (salvo `--dry-run`) | Chat al que se manda el resumen |
| `DUE_SOON_DAYS` | No (default `3`) | Ventana en días para avisar "vence pronto" |
| `MOODLE_RATE_LIMIT_MS` | No (default `400`) | Pausa entre llamadas por-curso a la API de Moodle |

`index.js` lee estas variables de `process.env` (vía `.env` en local, o directamente del
entorno cuando corre como Routine — `src/env.js` nunca pisa una variable que ya esté seteada
en el entorno).

## Preparar la Routine (cron diario)

La Routine necesita, como variables de entorno propias (no un archivo `.env`, ya que ese
archivo es local y está en `.gitignore`):

- `MOODLE_BASE_URL`
- `MOODLE_TOKEN`
- `MOODLE_COURSE_IDS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- (opcional) `DUE_SOON_DAYS`, `MOODLE_RATE_LIMIT_MS`

Copiá los valores actuales de tu `.env` local a la configuración de variables de entorno de
la Routine — nunca subas `.env` a un repositorio.

### Pasos para crear la Routine

1. Confirmá que `npm run dry-run` te sigue dando un resumen sensato (ya lo probamos juntos).
2. Si la Routine requiere que el código esté en un repositorio Git (este directorio hoy
   **no** es un repo git), avisame y lo inicializamos — asegurándonos de que `.env` y
   `data/state.json` queden fuera del repo (ya están en `.gitignore`).
3. Invocá el skill de scheduling (`/schedule` en Claude Code) y pedí crear una Routine con:
   - **Comando**: `node index.js`
   - **Directorio de trabajo**: esta carpeta del proyecto
   - **Cron**: diario, por ejemplo `0 8 * * *` (8:00 AM) — ajustá el horario a tu gusto
   - **Variables de entorno**: las listadas arriba
4. Después de crearla, pedile una corrida manual (no programada) para confirmar que en ese
   entorno también funciona antes de dejarla en piloto automático.

Cuando quieras, te ayudo a ejecutar el paso 3 directamente.
