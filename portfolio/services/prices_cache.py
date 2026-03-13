import pandas as pd
from datetime import timedelta
import time
from django.db import transaction as db_transaction
from django.utils import timezone

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


def _has_suspicious_jump(cached_dates_to_close):
    """
    Detect obviously broken cached history, typically caused by mixing differently
    adjusted Yahoo series across refreshes. Real overnight moves of this size are
    rare for the assets in this app, so a large ratio is a good repair trigger.
    """
    if not cached_dates_to_close or len(cached_dates_to_close) < 2:
        return False

    dates = sorted(cached_dates_to_close.keys())
    prev_close = None
    for dt in dates:
        close = float(cached_dates_to_close[dt])
        if prev_close and prev_close > 0:
            ratio = close / prev_close
            if ratio >= 1.8 or ratio <= 0.55:
                return True
        prev_close = close

    return False


def get_close_prices_cached(data_symbols, start_date, end_date, user=None, force_refresh_symbols=None):
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

    force_refresh_symbols = set(force_refresh_symbols or [])

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
        if a.data_symbol in force_refresh_symbols:
            fetch_jobs.append((a.data_symbol, start_date, end_date))
            continue

        if not have_dates:
            fetch_jobs.append((a.data_symbol, start_date, end_date))
            continue

        latest = have_dates[-1]
        if _has_suspicious_jump(cached_map.get(a.id, {})):
            fetch_jobs.append((a.data_symbol, start_date, end_date))
            continue

        if latest < refresh_if_older_than:
            # Refresh the full requested window so cached rows remain on one
            # consistent price basis instead of mixing old and new downloads.
            fetch_jobs.append((a.data_symbol, start_date, end_date))

    # ---- 3) Fetch missing/stale symbols and save
    if fetch_jobs:
        rows_to_create = []
        delete_ranges = []
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

            delete_ranges.append((asset, pd.to_datetime(job_start).date(), pd.to_datetime(job_end).date()))

            for dt, close in series.items():
                d = pd.to_datetime(dt).date()
                if d < start or d >= end:
                    continue
                rows_to_create.append(PricePoint(asset=asset, date=d, close=close))

        # bulk insert ignoring duplicates (fast + safe)
        if rows_to_create:
            with db_transaction.atomic():
                for asset, delete_start, delete_end in delete_ranges:
                    PricePoint.objects.filter(
                        asset=asset,
                        date__gte=delete_start,
                        date__lt=delete_end,
                    ).delete()
                PricePoint.objects.bulk_create(
                    rows_to_create,
                    update_conflicts=True,
                    update_fields=["close"],
                    unique_fields=["asset", "date"],
                )

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


def purge_asset_price_history(asset):
    deleted_count, _ = PricePoint.objects.filter(asset=asset).delete()
    return deleted_count


def refresh_asset_price_history(asset, user=None, lookback_years=10):
    """
    Force a clean re-download for a single asset by clearing its cached rows first.
    The refresh window starts at the first known transaction for the asset, or a
    reasonable historical fallback when no transactions exist yet.
    """
    first_txn = asset.transactions.order_by("timestamp").values_list("timestamp", flat=True).first()
    if first_txn is not None:
        start_date = (first_txn.date() - timedelta(days=7))
    else:
        start_date = (timezone.now().date() - timedelta(days=365 * lookback_years))

    end_date = timezone.now().date() + timedelta(days=1)
    purged_rows = purge_asset_price_history(asset)
    refreshed = get_close_prices_cached(
        data_symbols=[asset.data_symbol],
        start_date=start_date,
        end_date=end_date,
        user=user,
        force_refresh_symbols={asset.data_symbol},
    )
    fetched_points = 0
    if asset.data_symbol in refreshed.columns:
        fetched_points = int(refreshed[asset.data_symbol].dropna().shape[0])

    return {
        "purged_rows": purged_rows,
        "fetched_points": fetched_points,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }
