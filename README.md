# gif urself

Record a three-second, 4:3 reaction GIF without an account. Download it immediately, or sign in with an emailed code to keep it in a private library and share it with selected groups. A group has one reusable, renewable invite link and equal managers. Members can browse by reaction tag and person, or pick a random match.

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

Open the Vite URL. Codes go to `data/mail-outbox.jsonl` in local file mode. This mode is unavailable in production. The camera needs localhost or HTTPS. `npm run build` checks TypeScript and builds the client. `python -m unittest discover -s tests` checks the server flows. `npm run test:e2e` runs a browser flow after installing Playwright Chromium.

## Production

`compose.yaml` builds the client and API into one image. SQLite and GIF files live in the `gifs-data` Docker volume at `/data`; the web server never serves this directory directly. Caddy routes `gifs.frank.dev` to the `gifs:8000` service on the external `web` network. `/api/health` checks database access. The app migrates the database before starting Gunicorn; later numbered migrations create a SQLite backup in `/data/backups` first. Back up the whole `gifs-data` volume, including SQLite and media files, before major changes.

Create `/opt/homelab/apps/gifs/.env` with `APP_ENV=production` and a random `APP_SECRET` of at least 32 characters. Set mode 600. For email sign-in, add `SMTP_HOST`, `SMTP_FROM`, and optionally `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`. Until a relay is configured, sign-in is visibly disabled; anonymous recording and downloading still work. The deployment workflow syncs source, preserves `.env` and the Docker volume, builds, migrates, starts, and verifies health after tests pass. Caddy is maintained in the separate homelab repo.

To roll back, revert the app commit on `main` and let CI redeploy, after checking that the earlier code supports the current database version. The deployment sync does not remove the database volume. For schema rollback, restore a consistent volume backup.
