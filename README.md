# Portfolio Tracker (CS50W Final Project)

This project is a single-page Django web application for tracking personal investments across multiple assets. Users can register, log in, create and manage assets, add transactions (BUY, SELL, DIV), import historical transactions from Excel, and view analytics dashboards with interactive charts.

The product goal was to build a practical “portfolio cockpit,” not just a CRUD app. The interface uses a compact desktop sidebar layout, dashboard cards, an allocation donut chart with a full legend, a total portfolio growth chart, and a per-asset growth chart with time-window filters. The application is intended for normal investors who want a cleaner overview of value, invested capital, ROI, and dividend information.

## Distinctiveness and Complexity

I believe this project satisfies CS50W distinctiveness and complexity requirements for these reasons:

1. It combines multiple areas of web development in one project: authentication, relational modeling, API endpoints, spreadsheet import, data transformation, and interactive visualization.
2. The business logic is non-trivial: transaction cashflows are transformed into time-series holdings, invested capital curves, allocation breakdowns, ROI metrics, and dividend yield insights.
3. It uses a modular frontend architecture (`app.js` + per-view modules) to coordinate a dynamic single-page interface where views and charts update without full page refreshes.
4. It includes service-layer code (`portfolio/services/analytics.py`, `prices_cache.py`, `prices_yahoo.py`) to separate analytics and price-fetching concerns from views.
5. It handles user-specific data isolation in the model and API layer (assets and transactions scoped per user), including dedicated migration work for evolving from shared to per-user assets.
6. It implements flexible import processing from `.xlsx` with header normalization, row-level validation, numeric cleaning, and robust error reporting for malformed lines.

Overall, the complexity is in the combination of full-stack architecture + finance-oriented data processing + user-focused UX iteration.

## File Overview

- `manage.py`: Django management entrypoint.
- `marketvault/__init__.py`: Marks the Django project package.
- `marketvault/settings.py`: Django configuration (apps, middleware, DB, static files, auth model).
- `marketvault/urls.py`: Root URL configuration.
- `marketvault/asgi.py`: ASGI entrypoint.
- `marketvault/wsgi.py`: WSGI entrypoint.
- `portfolio/__init__.py`: Marks the app package.
- `portfolio/admin.py`: Admin registrations (currently minimal).
- `portfolio/apps.py`: App configuration class.
- `portfolio/models.py`: Core models (`User`, `Asset`, `Transaction`, `PricePoint`) and validation logic.
- `portfolio/views.py`: All web/API endpoints (auth, assets, transactions, profile, import, analytics).
- `portfolio/urls.py`: App-level route mapping.
- `portfolio/services/__init__.py`: Service package marker.
- `portfolio/services/analytics.py`: Portfolio/allocation/asset-growth payload generation.
- `portfolio/services/prices_cache.py`: Caching wrapper for historical price requests.
- `portfolio/services/prices_yahoo.py`: Yahoo Finance data download helper.
- `portfolio/templates/portfolio/layout.html`: Base layout + sidebar + script includes.
- `portfolio/templates/portfolio/index.html`: Main SPA view containers and dashboard/import markup.
- `portfolio/templates/portfolio/login.html`: Login page template.
- `portfolio/templates/portfolio/register.html`: Registration page template.
- `portfolio/static/portfolio/styles.css`: Global styling for layout, cards, forms, charts, nav, and import table.
- `portfolio/static/portfolio/js/app.js`: SPA bootstrap, navigation, and shared app state.
- `portfolio/static/portfolio/js/common.js`: Shared frontend helpers (DOM, API, formatting).
- `portfolio/static/portfolio/js/dashboard.js`: Dashboard and analytics chart rendering logic.
- `portfolio/static/portfolio/js/assets.js`: Assets view behavior (list/search/create/edit/delete).
- `portfolio/static/portfolio/js/transactions.js`: Transactions view behavior and form handlers.
- `portfolio/static/portfolio/js/imports.js`: Import page behavior and upload workflow.
- `portfolio/static/portfolio/js/profile.js`: Profile details and password update behavior.
- `portfolio/migrations/0001_initial.py` to `0006_asset_user_scope_finalize.py`: Database schema and data migrations.
- `portfolio/tests.py`: Placeholder for Django tests.

## How to Run

1. Clone the project and move into the project directory.
2. Create and activate a virtual environment.
3. Install dependencies:
   - `pip install -r requirements.txt`
4. Apply migrations:
   - `python manage.py migrate`
5. (Optional) Create admin user:
   - `python manage.py createsuperuser`
6. Start development server:
   - `python manage.py runserver`
7. Open the local URL shown by Django (typically `http://127.0.0.1:8000/`).

Typical usage flow:
- Register a user and log in.
- Create assets (ticker, type, symbol).
- Add transactions or import from Excel.
- Open dashboard to review allocation and growth metrics.

## Additional Notes

- Import expects an `.xlsx` file and requires these columns: `data_symbol`, `txn_type`, `timestamp` (Unix seconds). Optional: `quantity`, `unit_price`, `div_amount`.
- `txn_type` values must be one of `BUY`, `SELL`, `DIV`.
- Analytics require historical market data via Yahoo Finance; internet access is needed for fresh pricing.
- Asset and transaction endpoints are authenticated and intended to be user-specific.
- Asset type categories used in charts are `ETF`, `STOCK`, `ETC`, `CRYPTO`.
- If data-symbol price history is unavailable, some charts may show reduced output until valid market data is available.

## Packages

Python dependencies are listed in `requirements.txt`:

- `Django`
- `pandas`
- `yfinance`
- `openpyxl`

These are required for the web app, analytics processing, market data retrieval, and Excel import support.
