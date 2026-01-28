import pandas as pd
from datetime import timedelta
import time
from django.utils import timezone
from django.db import transaction as db_transaction

from portfolio.models import Asset, PricePoint
from portfolio.services.prices_yahoo import download_close_prices


def _chunks(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i+size]


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


def get_close_prices_cached(data_symbols, start_date, end_date):
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

    # assets in DB for these symbols
    assets = list(Asset.objects.filter(data_symbol__in=list(data_symbols)))
    if not assets:
        return pd.DataFrame()

    symbol_to_asset = {a.data_symbol: a for a in assets}

    # expected daily date range (inclusive of start, exclusive of end)
    expected_dates = pd.date_range(start, end - timedelta(days=1), freq="D").date

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
    # We'll fetch for symbols where we are missing ANY dates in the requested range
    symbols_to_fetch = []
    for a in assets:
        have = cached_map.get(a.id, {})
        # if missing any date in expected range => fetch
        if any(d not in have for d in expected_dates):
            symbols_to_fetch.append(a.data_symbol)

    # ---- 3) Fetch missing and save
    if symbols_to_fetch:
        downloaded_parts = []

        for group in _chunks(symbols_to_fetch, 8):  # 5–10 is a good range
            df_part = _download_with_retries(group, start_date, end_date, retries=3)
            if df_part is not None and not df_part.empty:
                downloaded_parts.append(df_part)

        if downloaded_parts:
            downloaded = pd.concat(downloaded_parts, axis=1)
        else:
            downloaded = pd.DataFrame()

        if not downloaded.empty:
            downloaded.index = pd.to_datetime(downloaded.index.date)

            rows_to_create = []
            for symbol in downloaded.columns:
                asset = symbol_to_asset.get(symbol)
                if not asset:
                    continue

                series = downloaded[symbol].dropna()
                for dt, close in series.items():
                    d = pd.to_datetime(dt).date()
                    if d < start or d >= end:
                        continue

                    rows_to_create.append(
                        PricePoint(asset=asset, date=d, close=close)
                    )

            # bulk insert ignoring duplicates (fast + safe)
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
