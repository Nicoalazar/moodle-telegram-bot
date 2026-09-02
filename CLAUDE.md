# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A no-framework Node.js (18+, ESM, `type: module`) script that checks a Moodle instance
(`aulasvirtuales.bue.edu.ar`) for genuinely new activity across selected courses — new content,
assignments, upcoming due dates, forum posts, grades — and sends a summary via Telegram. Runs
either locally (manual/cron) or as a scheduled Routine. No test suite, no build step, no
external HTTP dependencies (uses native `fetch`).

## Commands

```bash
npm run setup:moodle-token      # interactive: prompts Moodle user/pass, writes MOODLE_BASE_URL + MOODLE_TOKEN to .env (password never persisted)
npm run setup:telegram-chat-id  # interactive: prompts Telegram bot token, detects TELEGRAM_CHAT_ID, writes to .env
npm run list-courses            # prints your Moodle courses with their IDs, to populate MOODLE_COURSE_IDS
npm run dry-run                 # node index.js --dry-run — prints the summary that would be sent, touches neither Telegram nor data/state.json
npm start                       # node index.js — sends the real message and updates data/state.json, only if the send succeeds
```

There are no lint or test scripts. Always sanity-check changes with `npm run dry-run` before `npm start`.

## Architecture

Everything flows through `index.js` as a single linear `main()`:

1. `src/env.js` `loadEnv()` reads `.env` into `process.env` **without overwriting** anything
   already set in the environment — this is what lets the same code run locally (via `.env`)
   and as a Routine (via real env vars) unchanged.
2. `src/moodleClient.js` `createMoodleClient()` wraps Moodle's REST web service
   (`/webservice/rest/server.php`, `moodlewsrestformat=json`). Every call goes through
   `callFunction(wsfunction, params)`, which flattens nested params into Moodle's
   `key[0]=a&key[nested]=b` query format and throws `MoodleApiError` on Moodle's
   HTTP-200-with-`exception`-body error convention. Per-course/per-forum calls
   (`getAllCourseContents`, `getManyForumDiscussions`, `getAllCourseGrades`) are sequential
   loops with a `rateLimitMs` sleep between calls (default 400ms) — never parallelized, to
   avoid hammering the Moodle instance.
3. `index.js` fetches, per tracked course: contents, assignments, upcoming calendar events,
   forum discussions (for `forum`-type modules whose name doesn't match
   `FORUM_IGNORE_PATTERN`), and grade items. Each fetch category is independently
   try/caught and warns rather than aborting — a single failing API call (e.g. grades
   disabled for a course) shouldn't kill the whole run.
4. `src/state.js` `diffCourse()` is the core "what's new" logic: compares the current API
   snapshot against `data/state.json` (untracked, gitignored) per course and returns a diff
   object plus internal `_*` fields. **It never mutates state.** `applyCourseDiff()` computes
   the next persisted state from a diff result and must only be called after a confirmed
   Telegram send — this ordering (diff → send → apply → save) is what prevents losing
   novedades if the Telegram send fails.
   - **First run per course** is treated as a baseline: existing modules/assignments are not
     reported as "new" (to avoid dumping entire course history), but upcoming due dates
     still are, since those are time-sensitive rather than novelty-sensitive.
   - Forums and grades each track their own independent "first run" flag
     (`prev.forums === undefined` / `prev.grades === undefined`), separate from the
     course-level `isFirstRun`, so that adding these features later doesn't retroactively
     treat existing courses as first-run for content/assignments.
   - Items without a due date (quizzes with no `timeclose`, assignments with no `duedate`)
     would otherwise never surface (never "due soon", and baselined away on first run if
     already existing) — `noDueDatePending` handles this via a separate
     `notifiedNoDueDateIds` set so each such item is flagged exactly once.
   - Note the calendar-event quirk documented inline in `state.js`: an upcoming event's
     `instance` field equals the course-module id (cmid), not the activity's own id.
5. `src/telegram.js` builds one or more HTML-formatted messages from the diffs (grouped by
   course, courses with the soonest deadline first, chunked under Telegram's 4096-char limit)
   and sends them sequentially with a small delay between messages.

## Environment variables

See the table in [README.md](README.md) and [.env.example](.env.example) for the full list
(`MOODLE_BASE_URL`, `MOODLE_TOKEN`, `MOODLE_COURSE_IDS`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `DUE_SOON_DAYS`, `MOODLE_RATE_LIMIT_MS`, `FORUM_IGNORE_PATTERN`).
`.env` is gitignored and must never be committed. `data/state.json` is deliberately **not**
gitignored (see Scheduling below) — never put secrets in it, it's just tracking state
(module/assignment/discussion ids, grades).

## Scheduling

Runs daily via `.github/workflows/moodle-check.yml` (GitHub Actions `schedule`), not a local
cron/Task Scheduler job or a cloud Routine — both were tried and blocked (the Routine
sandbox's outbound proxy 403s on `aulasvirtuales.bue.edu.ar`; Windows Task Scheduler was
broken on the machine this was developed on). Because each Actions run is a fresh VM,
`data/state.json` is committed back to the repo by the workflow after a successful real run
(`contents: write` permission, default `GITHUB_TOKEN`) — this is why it's tracked in git
instead of gitignored. Secrets live in the repo's Actions secrets, not `.env`. The workflow
also accepts `workflow_dispatch` with a `dry_run` input for manual testing.

## Conventions

- Code and comments are written in Spanish (Argentina), matching the target user; keep new
  code consistent with this.
- No external dependencies for the core logic — deliberate choice, keep it that way unless
  there's a strong reason to add one.
