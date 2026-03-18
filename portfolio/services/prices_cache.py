import pandas as pd
from datetime import timedelta
import logging
import time
from django.db import transaction as db_transaction
from django.utils import timezone

from portfolio.models import Asset, PricePoint
from portfolio.services.prices_yahoo import download_close_prices

logger = logging.getLogger(__name__)


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


def _series_from_cached_dates(cached_dates_to_close):
    if not cached_dates_to_close:
        return pd.Series(dtype=float)

    series = pd.Series(cached_dates_to_close, dtype=float)
    series.index = pd.to_datetime(series.index)
    return series.sort_index()


def _series_matches_other_symbol(series, other_series, min_overlap=5, tolerance=1e-6):
    if series is None or other_series is None or series.empty or other_series.empty:
        return False

    common_index = series.index.intersection(other_series.index)
    if len(common_index) < min_overlap:
        return False

    left = series.reindex(common_index).astype(float)
    right = other_series.reindex(common_index).astype(float)
    valid_mask = left.notna() & right.notna()
    if int(valid_mask.sum()) < min_overlap:
        return False

    return bool(((left[valid_mask] - right[valid_mask]).abs() <= tolerance).all())


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
    reference_assets = list(assets)
    if user is not None:
        reference_assets.extend(
            Asset.objects
            .filter(user=user)
            .exclude(id__in=[asset.id for asset in assets])
        )

    # ---- 1) Load cached points
    cached_points = (
        PricePoint.objects
        .filter(asset__in=assets, date__gte=start, date__lt=end)
        .select_related("asset")
    )

    cached_map = {}
    for p in cached_points:
        cached_map.setdefault(p.asset_id, {})[p.date] = float(p.close)

    reference_cached_points = (
        PricePoint.objects
        .filter(asset__in=reference_assets, date__gte=start, date__lt=end)
        .select_related("asset")
    )
    reference_cached_map = {}
    for p in reference_cached_points:
        reference_cached_map.setdefault(p.asset_id, {})[p.date] = float(p.close)

    cached_series_by_symbol = {
        asset.data_symbol: _series_from_cached_dates(reference_cached_map.get(asset.id, {}))
        for asset in reference_assets
    }

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
        downloaded_series = {}
        download_metadata = {}
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

            downloaded_series[symbol] = series.astype(float)
            download_metadata[symbol] = (
                asset,
                pd.to_datetime(job_start).date(),
                pd.to_datetime(job_end).date(),
            )

        invalid_symbols = set()

        for symbol, series in downloaded_series.items():
            for other_symbol, other_series in cached_series_by_symbol.items():
                if other_symbol == symbol:
                    continue
                if _series_matches_other_symbol(series, other_series):
                    invalid_symbols.add(symbol)
                    logger.warning(
                        "Skipping cache refresh for %s because the downloaded series matches cached prices for %s",
                        symbol,
                        other_symbol,
                    )
                    break

        downloaded_symbols = sorted(downloaded_series.keys())
        for idx, symbol in enumerate(downloaded_symbols):
            if symbol in invalid_symbols:
                continue
            for other_symbol in downloaded_symbols[idx + 1:]:
                if other_symbol in invalid_symbols:
                    continue
                if _series_matches_other_symbol(downloaded_series[symbol], downloaded_series[other_symbol]):
                    invalid_symbols.add(symbol)
                    invalid_symbols.add(other_symbol)
                    logger.warning(
                        "Skipping cache refresh for %s and %s because the downloaded series are identical",
                        symbol,
                        other_symbol,
                    )

        for symbol, series in downloaded_series.items():
            if symbol in invalid_symbols:
                continue

            asset, delete_start, delete_end = download_metadata[symbol]
            delete_ranges.append((asset, delete_start, delete_end))

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
