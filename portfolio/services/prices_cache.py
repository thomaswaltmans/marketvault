import pandas as pd
from datetime import timedelta
import time
from django.db import transaction as db_transaction

from portfolio.models import Asset, PricePoint
from portfolio.services.prices_yahoo import download_close_prices


def _download_with_retries(symbols, start_date, end_date, retries=3):
    last = pd.DataFrame()

    for attempt in range(retries):
        try:
            df = download_close_prices(symbols, start_date=start_date, end_date=end_date)
            if df is not None and not df.empty:
                return df
            last = df
        except Exception:
            pass

        # backoff: 0.5s, 1s, 2s ...
        time.sleep(0.5 * (2 ** attempt))

    return last


def get_close_prices_cached(data_symbols, start_date, end_date, user=None):
    """
    Returns DataFrame with:
      index: daily dates (datetime64)
      columns: data_symbol
      values: float close prices

    Strategy:
      1) Load cached PricePoints from DB for assets in data_symbols within [start_date, end_date)
      2) Find missing dates per asset
      3) Download missing via yfinance (batched by symbols), save to DB
      4) Re-load all and return as a complete dataframe
    """
    if not data_symbols:
        return pd.DataFrame()

    start = pd.to_datetime(start_date).date()
    end = pd.to_datetime(end_date).date()

    # assets in DB for these symbols (optionally scoped to the requesting user)
    assets_qs = Asset.objects.filter(data_symbol__in=list(data_symbols))
    if user is not None:
        assets_qs = assets_qs.filter(user=user)
    assets = list(assets_qs)
    if not assets:
        return pd.DataFrame()

    symbol_to_asset = {a.data_symbol: a for a in assets}

    # ---- 1) Load cached points
    cached_points = (
        PricePoint.objects
        .filter(asset__in=assets, date__gte=start, date__lt=end)
        .select_related("asset")
    )

    cached_map = {}
    for p in cached_points:
        cached_map.setdefault(p.asset_id, {})[p.date] = float(p.close)

    # ---- 2) Determine if we need to fetch anything
    # Never require "all calendar dates" because markets are closed on many days.
    # Instead, fetch only when symbol has no cache or its latest cached close is stale.
    fetch_jobs = []
    refresh_if_older_than = end - timedelta(days=2)
    for a in assets:
        have_dates = sorted(cached_map.get(a.id, {}).keys())
        if not have_dates:
            fetch_jobs.append((a.data_symbol, start_date, end_date))
            continue

        latest = have_dates[-1]
        if latest < refresh_if_older_than:
            # Incremental refresh window avoids expensive full-history re-downloads.
            fetch_start = max(start, latest - timedelta(days=7))
            fetch_jobs.append((a.data_symbol, fetch_start.strftime("%Y-%m-%d"), end_date))

    # ---- 3) Fetch missing/stale symbols and save
    if fetch_jobs:
        rows_to_create = []
        for symbol, job_start, job_end in fetch_jobs:
            downloaded = _download_with_retries([symbol], job_start, job_end, retries=3)
            if downloaded is None or downloaded.empty:
                continue

            downloaded.index = pd.to_datetime(downloaded.index.date)
            if symbol not in downloaded.columns:
                continue

            series = downloaded[symbol].dropna()
            asset = symbol_to_asset.get(symbol)
            if not asset:
                continue

            for dt, close in series.items():
                d = pd.to_datetime(dt).date()
                if d < start or d >= end:
                    continue
                rows_to_create.append(PricePoint(asset=asset, date=d, close=close))

        # bulk insert ignoring duplicates (fast + safe)
        if rows_to_create:
            with db_transaction.atomic():
                PricePoint.objects.bulk_create(rows_to_create, ignore_conflicts=True)

    # ---- 4) Re-load everything from DB and build the final DF
    final_points = (
        PricePoint.objects
        .filter(asset__in=assets, date__gte=start, date__lt=end)
        .select_related("asset")
    )

    data = {}
    for p in final_points:
        data.setdefault(p.asset.data_symbol, {})[p.date] = float(p.close)

    # build df on expected index for stability
    expected_dates = pd.date_range(start, end - timedelta(days=1), freq="D").date
    index = pd.to_datetime(list(expected_dates))
    df = pd.DataFrame(index=index)

    for symbol in data_symbols:
        if symbol in data:
            s = pd.Series(data[symbol])
            s.index = pd.to_datetime(s.index)
            df[symbol] = s.reindex(index)

    # fill weekends/holidays + leading gaps
    df = df.ffill().bfill()

    # drop all-NaN columns (bad symbols)
    df = df.dropna(axis=1, how="all")

    return df
