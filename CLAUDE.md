# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Dependencies are managed with **uv**. `uv run` syncs the environment from `uv.lock`
before executing, so there is no activate step and no manual install.

```bash
# Run dev server
uv run python manage.py runserver

# Apply migrations
uv run python manage.py migrate

# Create a new migration after model changes
uv run python manage.py makemigrations

# Run tests
uv run python manage.py test

# Run a single test
uv run python manage.py test portfolio.tests.TestClassName.test_method_name

# Collect static files (production)
uv run python manage.py collectstatic --noinput

# Format and lint
make format   # uv run black .
make lint     # uv run ruff check .
```

Dependency changes go in `pyproject.toml`, then `uv lock` to update `uv.lock`. Commit both.
Dev-only tools live in the `dev` dependency group and are excluded from production by `--no-dev`.

Tool config also lives in `pyproject.toml`: black targets `py313`; ruff rules are pinned to
`E4, E7, E9, F, I` with migrations excluded.

## Environment variables

All have sensible dev defaults; only `DATABASE_URL` and production secrets need explicit values.

| Variable | Default | Notes |
|---|---|---|
| `SECRET_KEY` | insecure dev key | Must be changed in production |
| `DEBUG` | `True` | Controls security headers, SSL redirect, secure cookies |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated |
| `CSRF_TRUSTED_ORIGINS` | `http://localhost:8000,...` | Comma-separated |
| `DATABASE_URL` | SQLite | Set to postgres:// to switch to PostgreSQL via dj-database-url |
| `REGISTRATION_ENABLED` | `True` | Set to `False` to lock down signups |
| `EMAIL_BACKEND` | console | Prints emails to terminal in dev; set a real SMTP backend in prod |
| `EMAIL_HOST` | — | SMTP host (e.g. `smtp.sendgrid.net`) |
| `EMAIL_PORT` | `587` | SMTP port |
| `EMAIL_USE_TLS` | `True` | |
| `EMAIL_HOST_USER` | — | SMTP username |
| `EMAIL_HOST_PASSWORD` | — | SMTP password |
| `DEFAULT_FROM_EMAIL` | `noreply@marketvault.app` | Sender address for verification emails |

## Architecture

### Backend

Single Django app (`portfolio/`) with all models, views, and services in one place.

**Models** (`portfolio/models.py`):
- `User` — extends `AbstractUser`. `AUTH_USER_MODEL = "portfolio.User"`. On `main` this is a bare subclass with no extra fields.
  ⚠️ The `email_verified` / `email_verification_token` fields and the partial unique constraint on `email` live on the unmerged **`feature/registration`** branch. Everything below tagged *(feature/registration)* describes that branch, not `main` — do not write code on `main` that assumes it.
- `Asset` — unique per user on `(user, ticker, exchange)` and `(user, data_symbol)`. Also carries `prices_covered_from` / `prices_fetched_at`, the price-cache freshness markers (see `prices_cache.py`).
- `Transaction` — field-level validation: dividend txns use only `div_amount`; buy/sell use `quantity` + `unit_price` (mutually exclusive). `Transaction.save()` calls `full_clean()`, so validation always runs — never bypass with `update()` to skip it intentionally.
- `PricePoint` — persistent price cache, one row per `(asset, date)`. Indexed on `(asset, date)` and `(date)`.

**Views** (`portfolio/views.py`): All endpoints in one file. Rate limiting via django-ratelimit: login (20/min by IP, 8/min by username), register (10/min by IP), password change (10/min), and on feature/registration resend-verification (5/min by IP). Analytics views are wrapped with Django's cache framework (5-min TTL, key: `analytics:{user_id}:{endpoint}`). `invalidate_analytics_cache(user)` is called on every transaction/asset write — **must be called after any data mutation that affects analytics**.

**Registration/email verification flow** *(feature/registration — NOT on `main`; on `main`, `register` logs the user straight in and there are no verification routes)*: `register` creates the user with `email_verified=False`, sends a verification email, and redirects to `verify_pending.html` — it does **not** log the user in. `login_view` blocks login for unverified accounts. `verify_email` validates the UUID token, marks the user verified, and logs them in. `resend_verification` regenerates the token and resends the email without revealing whether the address exists.

**Services**:
- `portfolio/services/analytics.py` — six public functions: `growth_payload`, `allocation_payload`, `asset_growth_payload`, `dividends_monthly_payload`, `winners_losers_payload`, `details_payload`. Each builds a pandas DataFrame from transactions, computes holdings/invested time series, fetches prices, and returns a plain dict for JSON serialisation.
- `portfolio/services/prices_cache.py` — `get_close_prices_cached()` is the **only** entry point for price data. Loads from `PricePoint` DB first, then decides per asset whether to fetch.
  **Freshness is tracked by when a download was last *attempted*, not by how recent the newest close is** (`Asset.prices_fetched_at` + `PRICE_FRESHNESS`, 1 hour). A market-calendar test can never pass on weekends or holidays and re-downloads forever.
  `Asset.prices_covered_from` records how far back that attempt reached, so a 30-day caller cannot mask a gap for a 5-year one. An asset that already has deep history only tops up the tail from its newest cached date.
  Symbols sharing a window are downloaded in **one** batched request. Attempts are recorded even when they fail, so a delisted symbol costs one request per hour rather than one per page load.
  `refresh_asset_price_history()` force-clears, resets both markers, and re-downloads for one asset — this is the way to bypass the freshness gate.
- `portfolio/services/prices_yahoo.py` — thin wrapper around yfinance. Do not call yfinance directly anywhere else.

**Caching**: Two layers. Django cache (in-memory for dev, file-based at `/tmp/marketvault_cache` for prod) caches analytics JSON for 5 minutes. `PricePoint` table is persistent price history that survives restarts.

**Excel import/export**: handled in views.py using openpyxl. Import validates `.xlsx` only, expects a unix timestamp column, and auto-creates missing assets. Rows are saved individually and are **not** wrapped in a transaction: a failing row is collected into `row_errors` and reported, while the rows that succeeded stay committed. Export mirrors the same schema.

### Frontend

Single-page app — one Django template (`portfolio/templates/portfolio/index.html`) with all view containers present in the DOM, shown/hidden by JS.

**Static files**:
- CSS: `portfolio/static/portfolio/styles.css` — single stylesheet, dark mode via `[data-theme="dark"]` selectors
- JS: `portfolio/static/portfolio/js/` — all files loaded globally via `layout.html`, no bundler

**JS modules**:
- `common.js` — `getElement`, `show`, `hide`, `hide_all_views`, `setActiveNav`, `navigate(viewId, navId, onEnter)`, `apiRequest` (handles CSRF automatically)
- `app.js` — DOMContentLoaded bootstrap: wires all click handlers, calls `view_dashboard()` on load
- `dashboard.js` — all chart rendering. Key functions: `getBaseChartLayout()` (shared Plotly layout), `getChartThemeColors()` (dark/light aware), `buildColoredPortfolioTraces()` (splits portfolio line into green/red segments at interpolated crossovers)
- `assets.js`, `transactions.js`, `imports.js`, `profile.js` — per-view logic, each exports a `view_*()` function

**Navigation pattern**: Every view switch calls `navigate(viewId, navId, onEnter)` from `common.js`. This hides all `[id^="view-"]` elements, sets the active nav link, shows the target view, then calls the optional `onEnter` callback (used to trigger data loads).

**Dark mode**: Set via `data-theme="dark"` on `<html>`. A flash-prevention inline script in `<head>` reads `localStorage` and sets the attribute before first paint. Toggle lives in the profile view.

**Charts**: Loaded from the **plotly-basic** CDN bundle (`index.html`), which ships only `scatter`, `bar` and `pie` — a third the size of full Plotly. Any other trace type (`scattergl`, `heatmap`, …) will silently fail to render; switch the bundle back if you need one. All charts use `getBaseChartLayout()` — transparent backgrounds, y-axis on the right, horizontal gridlines only, no axis lines. Portfolio and asset growth charts use `buildColoredPortfolioTraces()` for the coloured line; invested capital is a dotted grey line. Dividend bars use `rgba(0, 150, 255, 0.7)`.

### URL structure

```
/                        → index (SPA shell, login required)
/login, /logout          → auth
/register                → only mounted when REGISTRATION_ENABLED=True
/verify-email/<uuid>     → (feature/registration) email verification token handler
/resend-verification     → (feature/registration) POST, resends verification email
/assets                  → GET list, POST create
/assets/<id>             → PUT update, DELETE delete
/assets/<id>/refresh-prices → POST
/transactions            → GET list, POST create
/transactions/<id>       → PUT update, DELETE delete
/import                  → POST xlsx upload
/export                  → GET xlsx download
/profile                 → GET/PUT
/profile/password        → PUT
/analytics/growth        → GET (cached)
/analytics/allocation    → GET (cached)
/analytics/asset-growth  → GET (cached)
/analytics/dividends-monthly → GET (cached)
/analytics/winners-losers    → GET (cached, period param)
/analytics/details           → GET (cached)
```

## Deployment (Railway)

Builder is **Railpack**. `railway.json` defines the build, pre-deploy and start behaviour, and **config in code overrides the dashboard** — the Railway UI will keep displaying whatever command was set there before, so do not trust it.

- build: `uv sync --locked --no-dev && uv run --no-dev python manage.py collectstatic --noinput`
- pre-deploy: `uv run --no-dev python manage.py migrate --noinput` (a failure here aborts the deploy)
- start: `Procfile` → `uv run --no-dev gunicorn marketvault.wsgi`

`--no-dev` is required on every one of them: plain `uv run` re-syncs and pulls the dev group back into the image.
If the runtime container ever cannot find `uv`, change the Procfile to call `.venv/bin/gunicorn` directly.

`yfinance[repair]` — the extra matters. `prices_yahoo.py` downloads with `repair=True`, which yfinance implements via scikit-learn. Dropping the extra brings back a runtime `ModuleNotFoundError` that silently yields no prices for affected symbols.

## Key invariants — do not break these

- **Always call `invalidate_analytics_cache(user)` after mutating transactions or assets.** It's already wired into all existing write paths — don't forget it in new ones.
- **`get_close_prices_cached()` is the only entry point for price data.** Never call yfinance directly.
- **`Transaction.save()` runs `full_clean()`** — validation is automatic on every save. Don't use bulk `update()` to bypass validation unless you explicitly intend to.
- **All analytics logic stays in `portfolio/services/analytics.py`.** Views must not build DataFrames or compute holdings directly.
- **Record the fetch attempt whenever `get_close_prices_cached()` runs a fetch job**, success or failure. Skipping it on failure makes dead symbols retry on every request.
- **`refreshDashboardCharts()` must `await` the growth call before firing the other four.** They all need the same prices; running them together makes each one download the same symbols concurrently. This is load-bearing, not stylistic.

## Do not

- Add a bundler, transpiler, or npm build step — JS is loaded globally as plain files, no modules
- Split `views.py` into multiple files — all endpoints stay in one file by design
- Add a second Django app — everything lives in `portfolio/`
- Call yfinance or any price source except through `get_close_prices_cached()`
- Add docstrings, comments, or type annotations to code you didn't change

## Tests

- Location: `portfolio/tests.py`
- Covers price cache deduplication (`PriceCacheGuardTests`) and fetch scheduling — freshness gating, wider-window refetch, tail-only fetches, failed-attempt recording, batched downloads (`PriceFetchSchedulingTests`)
- Tests use `unittest.mock.patch` on `_download_with_retries` — no network calls in tests
- Fixtures are created inline in `setUp()`, no fixture files
