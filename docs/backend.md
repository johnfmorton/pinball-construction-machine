# Backend plan

Status: **step 1 done** (Laravel, ddev, Makefile, Vite, Blade pages, the Lab flag). This is the plan for accounts and saved tables, and the base that Phase 3 (verified scores) and Phase 4 (community) build on.

The backend is Laravel, set up the same way as John's other Laravel projects (`poll-worker-planner` is the reference): ddev locally, Laravel Forge in production, and a Makefile so `make dev` starts everything, including the Vite dev server for hot-reloading CSS and TS.

## Goals

- People can register, log in, and save their tables to their account.
- The editor still works logged out. The localStorage draft (`pcm.editor.draft` in `src/shared/tables.ts`) stays as the offline, anonymous working copy.
- The game pages stay fast. Laravel serves a thin HTML shell and adds no JavaScript to the play, editor, or lab pages beyond what they load today.
- `src/core/` stays pure TypeScript. The server runs it under Node instead of porting it to PHP, so the server and the browser can never disagree about the rules.

Out of scope for now: leaderboards, ratings, browsing other people's tables, profiles, moderation. The data model below leaves room for them.

## Repository layout

Laravel lives at the repo root, alongside the existing frontend:

```
app/ bootstrap/ config/ database/ routes/ storage/   Laravel (new)
public/                                              docroot (new); Vite builds into public/build
resources/views/                                     Blade shells for each page (new)
resources/css/                                       auth pages' CSS (new)
src/ tables/ scripts/ docs/                          unchanged
tests/*.test.ts                                      Vitest, unchanged
tests/Feature/ tests/Unit/                           PHPUnit (new)
.ddev/ Makefile composer.json artisan                (new)
```

`index.html`, `editor.html`, and `lab.html` are now Blade views (`play`, `editor`, `lab`) that load their entries with `@vite`. There's no standalone (Laravel-free) dev server any more. The Vitest glob (`tests/**/*.test.ts`) doesn't match PHPUnit's `*Test.php` files, so both test suites can live under `tests/`.

## Local development

### ddev

`.ddev/config.yaml`, matching the other projects:

```yaml
name: pinball-construction-machine
type: laravel
docroot: public
php_version: "8.4"
webserver_type: nginx-fpm
database:
  type: mysql
  version: "8.0"
nodejs_version: "22"
web_extra_exposed_ports:
  - name: vite
    container_port: 5280
    http_port: 5279
    https_port: 5280
```

The site is at `https://pinball-construction-machine.ddev.site`.

### Vite

`vite.config.ts` adds `laravel-vite-plugin`, with the three page entries as its inputs. The Svelte plugin, `worker: { format: 'es' }`, and the Vitest block don't change. The dev server moves inside the ddev web container:

```ts
laravel({
  input: ['src/play/main.ts', 'src/editor/main.ts', 'src/debug/main.ts', 'resources/css/app.css'],
  refresh: ['resources/views/**', 'routes/**'],
}),
// …
server: {
  host: '0.0.0.0',
  port: 5280,
  strictPort: true,
  origin: 'https://pinball-construction-machine.ddev.site:5280',
  cors: true,
},
```

It keeps port 5280 rather than the usual 5173, for the same reason as before: the ddev router already claims 5173 for other projects.

**Workers in dev.** The pages come from `https://pinball-construction-machine.ddev.site` and the scripts from port 5280, and browsers refuse to start a worker from another origin. `src/shared/dev-worker.ts` (imported first by the play and lab pages) wraps a cross-origin module worker in a same-origin blob that imports it. It's dev-only and compiled out of production builds, where pages and scripts share an origin. Keep worker call sites in the literal `new Worker(new URL('…', import.meta.url), { type: 'module' })` form, which is what Vite looks for to bundle the worker.

**`svelte.config.js`** is an empty file on purpose: without it, svelte-check goes looking for a config and trips over the Vite configs inside `vendor/laravel/`.

### Makefile

```make
.PHONY: dev install build migrate fresh test

dev:            # open the site, run Vite with HMR inside ddev
	ddev launch > /dev/null 2>&1 &
	ddev npm run dev

install:        # first-time setup
	ddev start
	ddev composer install
	ddev npm install
	ddev artisan key:generate
	ddev artisan migrate
	ddev npm run build

build:
	ddev npm run build

migrate:
	ddev artisan migrate

fresh:          # wipe and reseed the database
	ddev artisan migrate:fresh --seed

test:           # both suites
	ddev npm test
	ddev artisan test
```

`npm test`, `npm run typecheck`, `npm run check`, and the `tsx` scripts don't need Laravel and keep working outside ddev.

## Pages and routes

| Route | What | Auth |
| --- | --- | --- |
| `/` | 3D player | public |
| `/editor` | table editor | public (saving to an account needs login) |
| `/lab` | Physics Lab | public |
| `/tables` | my saved tables | login |
| `/login`, `/register`, `/forgot-password`, … | Fortify auth pages | guest |

The old `/editor.html` and `/lab.html` URLs redirect (301) to the new routes and keep their `?table=` query.

### The Physics Lab flag

The Lab is public. `PCM_LAB_PUBLIC=false` in `.env` (read as `config('pcm.lab_public')`) closes it: `/lab` returns 404, and the pages hide their Lab links. Blade hides the play page's link, and the editor reads `features.lab` from the session JSON. Once tables are saved on the server (step 3), each table also gets a `lab_enabled` setting, so its owner can keep it out of the Lab. The env flag still overrides it for every table.

The Blade shell passes the logged-in user to the page as inline JSON, so the page doesn't need an extra request on load:

```html
<script type="application/json" id="pcm-session">{"features":{"lab":true},"user":{"id":1,"username":"jfm"},"csrf":"…"}</script>
```

Step 1 sends only `features`; `user` and `csrf` arrive with auth. `src/shared/session.ts` reads it. A helper next to it wraps `fetch` (it sends the CSRF header and handles 401/419 errors). The editor's Svelte chrome adds a Save button and an account menu.

## Authentication

Laravel Fortify (headless) with plain Blade views for login, registration, password reset, and email verification. Registration asks for a **username**: a unique public handle shown as the table's author, separate from the person's `name`. It's 3–30 characters (letters, digits, `-`, `_`), case-insensitive unique, and some names are reserved (`admin`, `lab`, `editor`, …) so profile URLs can be `/@username` later. Login uses session cookies on the same domain, so there are no API tokens, no Sanctum SPA setup, and no Inertia. That fits an app whose pages are separate Vite entries with Svelte used only for panels and toolbars.

- The JSON endpoints live in `routes/web.php` under an `/api` prefix, so they get the session and CSRF middleware. They are not in `routes/api.php`, which is stateless.
- Login and registration use Fortify's built-in rate limiting.
- Saving a private table needs only an account. Making a table public (Phase 4) also needs a verified email.
- Two-factor and social login can come later if they're wanted.

## Data model

```
users            id, name, username (unique), email, password, email_verified_at, timestamps

tables           id, public_id (ULID), user_id → users, title,
                 draft (JSON, longText), draft_format_version (int),
                 lab_enabled (bool, default true),
                 published_version_id → table_versions (nullable, Phase 3),
                 timestamps, soft deletes

table_versions   id, table_id → tables, number (1, 2, 3 … per table),
                 definition (JSON, longText), format_version (int),
                 sha256 (char 64), created_at
                 unique (table_id, number); never updated after insert
```

- **`tables`** is the user's working copy. Saving replaces `draft` with the whole document, the same way the editor already replaces the table immutably on every edit. Only the latest draft is kept on the server: undo history stays in the browser.
- **`table_versions`** is for Phase 3. Publishing freezes the current draft as the next version. Scores and replays will point at a specific version, so a published table's layout and physics can never change under a high score. That's the "immutable published versions" promise in [`table-format.md`](table-format.md).
- `format_version` stores `TABLE_VERSION` at save time, so migrations can find old documents. Old tables are still migrated on load in TypeScript, as they are today. PHP never rewrites table JSON.
- `public_id` is a ULID so URLs (`/tables/01J…`) don't expose row counts.
- Later tables: `replays` and `scores` (Phase 3), and `ratings` (Phase 4).

## API

All endpoints are JSON, need a login, and use session auth. Each user sees only their own tables.

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/tables` | list: `public_id`, `title`, `updated_at` (paginated; never returns the JSON) |
| `POST` | `/api/tables` | `{ definition }` creates a table and returns `{ public_id }` |
| `GET` | `/api/tables/{public_id}` | `{ title, definition, updated_at }` |
| `PUT` | `/api/tables/{public_id}` | `{ definition, updated_at }` replaces the draft |
| `DELETE` | `/api/tables/{public_id}` | soft delete |

- **Lost-update guard.** `PUT` sends back the `updated_at` the client last saw. If it doesn't match, the server returns 409 Conflict, so an older tab can't silently overwrite work saved from a newer one.
- **Size limit.** Request bodies are capped (512 KB to start; a full table today is a few tens of KB). PHP checks that the JSON is well formed and that `format` is `"pcm-table"`. Full validation runs in Node (next section).
- **Saving.** The editor saves when the user clicks Save, and also autosaves, debounced, while the table has unsaved changes and the user is logged in. A drag already commits one history entry, so autosave runs at most once per edit, not once per frame.
- The title is copied from `definition.meta.name` on save, so the table list never has to parse JSON.

## Running `src/core` on the server

PHP can't run the physics or `validateTable`, so the server calls Node:

- **A command-line entry point.** A new script, `scripts/server/pcm.ts`, takes a JSON request on stdin and writes a JSON result to stdout. It has two commands: `validate` (runs `validateTable` and `playabilityIssues`) and `verify-replay` (runs `runReplay`, the same check as `scripts/verify-replay.ts`).
- **Build step.** `npm run build` also bundles that script into one file, `build/server/pcm.mjs`, so production runs plain `node` and doesn't need `tsx` or the `node_modules` dev dependencies.
- **Calling it from Laravel.** Through `Illuminate\Support\Facades\Process` with a timeout. `validate` takes milliseconds and runs during the request. `verify-replay` runs in a queued job (Phase 3), because long replays take a noticeable fraction of a second.
- **Same Node version everywhere.** The simulation's determinism doesn't depend on the Node version (it uses `dsin`, `dcos`, and `Rng`, not `Math.*`; see [`physics.md`](physics.md)), but ddev and Forge both pin Node 22 to keep things predictable.

For Phase 2, the server runs `validate` on save only to reject garbage. An unfinished table is still saved, so `playable: false` is allowed.

## Deployment (Forge)

- **Site:** PHP 8.4, MySQL 8, Node 22, docroot `public/`.
- **Deploy script:** Forge's Laravel default, plus `npm ci && npm run build`, before `php artisan migrate --force` and `php artisan optimize`.
- **Queue:** database driver, with a Forge daemon running `php artisan queue:work`. It's only needed once replay verification arrives in Phase 3.
- **Caching:** Vite's hashed assets in `public/build/` get long-lived cache headers (`Cache-Control: public, max-age=31536000, immutable`) in the Forge nginx config.
- **Email:** Google Workspace SMTP for now (`smtp.gmail.com:587` with an app password). Laravel's `smtp` mailer covers it, so moving to Mailgun or Mailjet later is a `.env` change, plus `symfony/mailgun-mailer` if the Mailgun API is used instead of its SMTP. Locally, ddev's Mailpit catches everything (`ddev mailpit`). Gmail caps sending at about 2,000 messages a day, which is fine for verification and password resets but not for any bulk email.

## Performance notes

- No new JavaScript on the game pages: the session data is a few hundred bytes of inline JSON. The fetch helper is loaded only when the user saves or opens their table list.
- The table list never selects the `draft` or `definition` columns.
- The 3D player loads a saved table with one `GET`, and the response is gzipped by nginx (table JSON compresses well).

## Build order

**Phase 2, at the end of the editor work**

1. ~~Scaffold Laravel 13, ddev, the Makefile, and the Vite plugin. Turn the three pages into Blade views and confirm HMR and CSS reload work through ddev.~~ Done.
2. Fortify auth with Blade views, usernames, and email verification. Write PHPUnit feature tests for registration, login, and logout.
3. The `tables` migration, model, and policy, plus the `/api/tables` endpoints, with feature tests covering ownership, the 409 conflict, and the size limit.
4. The Node `validate` command and its build step, called on save.
5. Editor UI: Save and autosave, an account menu, and the "My tables" page. Open a server table into the editor and the player.

**Phase 3:** publishing (`table_versions`), replay upload, the queued `verify-replay` job, and scores.

**Phase 4:** public tables, browsing, ratings, profiles, and moderation.

## Decisions

- **No standalone dev server.** Everything runs through ddev; the TypeScript tools (`npm test`, the `tsx` scripts) still don't need it.
- **Email:** Google SMTP now, a transactional service (Mailgun or Mailjet) later, swapped through `.env`.
- **Usernames:** unique public handles, separate from `name`, collected at registration.
- **Physics Lab:** public, closable with `PCM_LAB_PUBLIC`, and per table via `lab_enabled`.
