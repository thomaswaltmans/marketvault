# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Activate virtualenv first — always required
source .venv/bin/activate

# Run dev server
python3 manage.py runserver

# Apply migrations
python3 manage.py migrate

# Create a new migration after model changes
python3 manage.py makemigrations

# Run tests
python3 manage.py test

# Run a single test
python3 manage.py test portfolio.tests.TestClassName.test_method_name

# Collect static files (production)
python3 manage.py collectstatic --noinput
```

There is no linter or formatter configured.

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
- `User` — extends `AbstractUser`. Extra fields: `email_verified` (bool, default False) and `email_verification_token` (UUID, nullable). Partial unique constraint on `email` (non-empty only). `AUTH_USER_MODEL = "portfolio.User"`.
- `Asset` — unique per user on `(user, ticker, exchange)` and `(user, data_symbol)`.
- `Transaction` — field-level validation: dividend txns use only `div_amount`; buy/sell use `quantity` + `unit_price` (mutually exclusive). `Transaction.save()` calls `full_clean()`, so validation always runs — never bypass with `update()` to skip it intentionally.
- `PricePoint` — persistent price cache, one row per `(asset, date)`. Indexed on `(asset, date)` and `(date)`.

**Views** (`portfolio/views.py`): All endpoints in one file. Rate limiting via django-ratelimit: login (20/min by IP, 8/min by username), register (10/min by IP), resend-verification (5/min by IP), password change (10/min). Analytics views are wrapped with Django's cache framework (5-min TTL, key: `analytics:{user_id}:{endpoint}`). `invalidate_analytics_cache(user)` is called on every transaction/asset write — **must be called after any data mutation that affects analytics**.

**Registration/email verification flow**: `register` creates the user with `email_verified=False`, sends a verification email, and redirects to `verify_pending.html` — it does **not** log the user in. `login_view` blocks login for unverified accounts. `verify_email` validates the UUID token, marks the user verified, and logs them in. `resend_verification` regenerates the token and resends the email without revealing whether the address exists.

**Services**:
- `portfolio/services/analytics.py` — five public functions: `growth_payload`, `allocation_payload`, `asset_growth_payload`, `dividends_monthly_payload`, `winners_losers_payload`. Each builds a pandas DataFrame from transactions, computes holdings/invested time series, fetches prices, and returns a plain dict for JSON serialisation.
- `portfolio/services/prices_cache.py` — `get_close_prices_cached()` is the **only** entry point for price data. Loads from `PricePoint` DB first, fetches missing/stale data from Yahoo Finance with 3-retry backoff (0.5s / 1s / 2s), deduplicates by comparing downloaded series to detect Yahoo ticker collisions, and saves back to DB. `refresh_asset_price_history()` force-clears and re-downloads for one asset.
- `portfolio/services/prices_yahoo.py` — thin wrapper around yfinance. Do not call yfinance directly anywhere else.

**Caching**: Two layers. Django cache (in-memory for dev, file-based at `/tmp/marketvault_cache` for prod) caches analytics JSON for 5 minutes. `PricePoint` table is persistent price history that survives restarts.

**Excel import/export**: handled in views.py using openpyxl. Import validates `.xlsx` only, expects a unix timestamp column, auto-creates missing assets, and wraps the whole operation in `db_transaction`. Export mirrors the same schema.

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

**Charts**: All use Plotly.js with `getBaseChartLayout()` — transparent backgrounds, y-axis on the right, horizontal gridlines only, no axis lines. Portfolio and asset growth charts use `buildColoredPortfolioTraces()` for the coloured line; invested capital is a dotted grey line. Dividend bars use `rgba(0, 150, 255, 0.7)`.

### URL structure

```
/                        → index (SPA shell, login required)
/login, /logout          → auth
/register                → only mounted when REGISTRATION_ENABLED=True
/verify-email/<uuid>     → email verification token handler (always mounted)
/resend-verification     → POST, resends verification email (always mounted)
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
```

## Key invariants — do not break these

- **Always call `invalidate_analytics_cache(user)` after mutating transactions or assets.** It's already wired into all existing write paths — don't forget it in new ones.
- **`get_close_prices_cached()` is the only entry point for price data.** Never call yfinance directly.
- **`Transaction.save()` runs `full_clean()`** — validation is automatic on every save. Don't use bulk `update()` to bypass validation unless you explicitly intend to.
- **All analytics logic stays in `portfolio/services/analytics.py`.** Views must not build DataFrames or compute holdings directly.

## Do not

- Add a bundler, transpiler, or npm build step — JS is loaded globally as plain files, no modules
- Split `views.py` into multiple files — all endpoints stay in one file by design
- Add a second Django app — everything lives in `portfolio/`
- Call yfinance or any price source except through `get_close_prices_cached()`
- Add docstrings, comments, or type annotations to code you didn't change

## Tests

- Location: `portfolio/tests.py`
- Currently covers price cache deduplication logic (`PriceCacheGuardTests`)
- Tests use `unittest.mock.patch` on `_download_with_retries` — no network calls in tests
- Fixtures are created inline in `setUp()`, no fixture files
