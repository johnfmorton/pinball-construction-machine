.PHONY: dev install build migrate fresh test

# Open the site and run Vite (HMR for TS, Svelte, CSS, and Blade) inside ddev.
dev:
	ddev launch > /dev/null 2>&1 &
	ddev npm run dev

# First-time setup.
install:
	ddev start
	ddev exec 'test -f .env || cp .env.example .env'
	ddev composer install
	ddev npm install
	ddev artisan key:generate
	ddev artisan migrate
	ddev npm run build

build:
	ddev npm run build

migrate:
	ddev artisan migrate

# Wipe and reseed the database.
fresh:
	ddev artisan migrate:fresh --seed

test:
	ddev npm test
	ddev artisan test
