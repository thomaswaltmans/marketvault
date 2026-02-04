# Portfolio Tracker (CS50W Final Project)

This project is a single-page Django web application for tracking personal investments across multiple assets. Users can register, log in, create assets, record transactions (BUY, SELL, DIV), import transactions from Excel, and view analytics dashboards with interactive charts.

The app is designed to feel like a practical portfolio cockpit: a compact sidebar layout, dashboard cards, allocation donut chart with legend, portfolio growth chart, and per-asset growth chart with time-window filtering.

## Distinctiveness and Complexity

I believe this project satisfies CS50W distinctiveness and complexity requirements for these reasons:

1. It is not a small CRUD clone. It combines account management, user-scoped domain modeling, data import pipelines, cached market data retrieval, and interactive analytics.
2. The project includes financial logic (net invested cashflow, holdings over time, ROI, dividend metrics, asset-type allocation), not just direct database rendering.
3. It uses a modular frontend architecture (`app.js` plus per-view modules) to manage a dynamic single-page UI with multiple views and reusable helpers.
4. It includes non-trivial backend services (`portfolio/services/analytics.py`, `prices_cache.py`, `prices_yahoo.py`) that transform transaction history into time-series data for charts.
5. It supports user-specific ownership of assets and transactions, including migration work to scope data correctly per user.

## File Overview

- `manage.py`: Django management entrypoint.
- `finalproject/settings.py`: Django configuration (apps, middleware, DB, static files, auth model).
- `finalproject/urls.py`: Root URL configuration.
- `finalproject/asgi.py`, `finalproject/wsgi.py`: Deployment interfaces.
- `portfolio/models.py`: Core models (`User`, `Asset`, `Transaction`, `PricePoint`) and validation logic.
- `portfolio/views.py`: All view/API endpoints (auth, assets, transactions, profile, import, analytics).
- `portfolio/urls.py`: App-level route mapping.
- `portfolio/services/analytics.py`: Portfolio/allocation/asset-growth payload generation.
- `portfolio/services/prices_cache.py`: Caching wrapper for historical price requests.
- `portfolio/services/prices_yahoo.py`: Yahoo Finance data download helper.
- `portfolio/templates/portfolio/layout.html`: Base layout and sidebar shell.
- `portfolio/templates/portfolio/index.html`: Main SPA view containers and UI sections.
- `portfolio/templates/portfolio/login.html`, `register.html`: Authentication pages.
- `portfolio/static/portfolio/styles.css`: Global styling for layout, cards, forms, charts, and import help.
- `portfolio/static/portfolio/js/app.js`: App bootstrap, navigation, and shared view wiring.
- `portfolio/static/portfolio/js/common.js`: Shared frontend helpers (formatters, DOM/API utilities).
- `portfolio/static/portfolio/js/dashboard.js`: Dashboard rendering and chart logic.
- `portfolio/static/portfolio/js/assets.js`: Assets view behavior (list/search/create/edit/delete).
- `portfolio/static/portfolio/js/transactions.js`: Transactions view behavior and forms.
- `portfolio/static/portfolio/js/imports.js`: Import-from-Excel UX and submission flow.
- `portfolio/static/portfolio/js/profile.js`: Profile update and password-change UI logic.
- `portfolio/migrations/*.py`: Schema/data migrations, including user-scoped asset migration steps.

## How to Run

1. Create and activate a virtual environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Apply migrations:
   - `python manage.py migrate`
4. (Optional) Create admin user:
   - `python manage.py createsuperuser`
5. Start development server:
   - `python manage.py runserver`
6. Open the local URL shown by Django (typically `http://127.0.0.1:8000/`).

## Additional Notes

- Import expects an `.xlsx` file and requires these columns: `data_symbol`, `txn_type`, `timestamp` (Unix seconds). Optional: `quantity`, `unit_price`, `div_amount`.
- `txn_type` values must be one of `BUY`, `SELL`, `DIV`.
- Analytics require historical market data via Yahoo Finance; internet access is needed for fresh pricing.
- Asset and transaction endpoints are authenticated and intended to be user-specific.
