# gif urself

Record a three-second, 4:3 reaction GIF without an account. Download it immediately, or sign in through auth.frank.dev with an emailed code to keep it in a private library.

## Local development

Requires Node 24 and Python 3.13.

```sh
npm ci
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.txt
MAIL_MODE=file .venv/bin/python server.py migrate
MAIL_MODE=file .venv/bin/python server.py serve
npm run dev
```

Open the Vite URL. To use sign-in locally, run the separate `auth.frank.dev` service and set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` in this app's environment. Register the local callback `http://127.0.0.1:8000/api/auth/oidc/callback` as a native development client. The camera needs localhost or HTTPS. `npm run build` checks TypeScript and builds the client. `python -m unittest discover -s tests` checks the server flows. `npm run test:e2e` runs a browser flow after installing Playwright Chromium; it uses the development-only legacy code API to set up test accounts.

The local callback returns to Vite at `http://127.0.0.1:5173` so a recording held in browser storage survives sign-in. Set `FRONTEND_ORIGIN` if Vite uses another origin. In production, the callback returns to the app's own origin.

## Production

`compose.yaml` builds the client and API into one image. SQLite and GIF files live in the `gifs-data` Docker volume at `/data`; the web server never serves this directory directly. Caddy routes `gifs.frank.dev` to the `gifs:8000` service on the external `web` network. `/api/health` checks database access. The app migrates the database before starting Gunicorn; later numbered migrations create a SQLite backup in `/data/backups` first. Back up the whole `gifs-data` volume, including SQLite and media files, before major changes.

- [ ] Work out automated off-host backups for `gifs-data` (SQLite and GIF media) and the production `.env`, including retention, monitoring, and a documented restore test. Migration-time SQLite backups alone do not cover media or host loss.

Create `/opt/homelab/apps/gifs/.env` with `APP_ENV=production`, a random `APP_SECRET` of at least 32 characters, `OIDC_ISSUER=https://auth.frank.dev/api/auth`, and the GIF app's OIDC client ID and secret. Set mode 600. The verified email from Better Auth links to an existing GIF account without changing its saved GIFs or local user ID. Anonymous recording and downloading remain available. The deployment workflow syncs source, preserves `.env` and the Docker volume, builds, migrates, starts, and verifies health after tests pass. Caddy is maintained in the separate homelab repo.

Older databases may contain group and sharing rows. They remain stored for now, but group endpoints are gone and GIFs are accessible only to their owners. No migration deletes existing data.

To roll back, revert the app commit on `main` and let CI redeploy, after checking that the earlier code supports the current database version. The deployment sync does not remove the database volume. For schema rollback, restore a consistent volume backup.
