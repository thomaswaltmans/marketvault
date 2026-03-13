# portfolio/services/prices_yahoo.py
import pandas as pd
import yfinance as yf

SYMBOL_FALLBACKS = {
    # WisdomTree Physical Silver ETC: Yahoo support is inconsistent across venues.
    # Prefer EUR listings first so portfolio values stay on a compatible basis.
    "VZLC.DE": ["PHAG.MI", "PHAG.AS", "PHAG.L"],
    "PHAG.AS": ["PHAG.MI", "PHAG.L"],
}


def _repair_leading_plateau_series(series, min_plateau_days=20):
    """
    Repair a vendor anomaly where a symbol is reported at the exact same close
    for a long stretch and then abruptly jumps into a realistic price regime.
    This happens for some Yahoo Euronext ETC histories even with repair=True.
    """
    clean = series.dropna().copy()
    if len(clean) < (min_plateau_days + 5):
        return series

    values = clean.astype(float).tolist()
    plateau_value = values[0]
    plateau_end = 0

    for idx, value in enumerate(values):
        if abs(value - plateau_value) < 1e-9:
            plateau_end = idx
        else:
            break

    plateau_len = plateau_end + 1
    if plateau_len < min_plateau_days or plateau_end >= len(values) - 5 or plateau_value <= 0:
        return series

    future_median = None
    for start_idx in range(plateau_end + 1, len(values) - 4):
        future_window = values[start_idx:start_idx + 5]
        moved_count = sum(1 for value in future_window if abs(value - plateau_value) / plateau_value > 0.2)
        if moved_count < 3:
            continue

        candidate = float(pd.Series(future_window).median())
        ratio = candidate / plateau_value if plateau_value else 1.0
        if ratio >= 1.8 or ratio <= 0.55:
            future_median = candidate
            break

    if future_median is None:
        return series

    repaired = clean.copy()
    repaired.iloc[:plateau_len] = future_median

    result = series.copy()
    result.loc[repaired.index] = repaired
    return result


def _repair_constant_plateau_runs(series, min_plateau_days=20):
    clean = series.dropna().copy()
    if len(clean) < (min_plateau_days + 5):
        return series

    values = clean.astype(float).tolist()
    repaired = clean.copy()
    run_start = 0

    for idx in range(1, len(values) + 1):
        is_same = idx < len(values) and abs(values[idx] - values[run_start]) < 1e-9
        if is_same:
            continue

        run_end = idx - 1
        run_len = run_end - run_start + 1
        plateau_value = values[run_start]

        if run_len >= min_plateau_days and plateau_value > 0 and run_end < len(values) - 5:
            future_median = None
            for future_start in range(run_end + 1, len(values) - 4):
                future_window = values[future_start:future_start + 5]
                moved_count = sum(
                    1 for value in future_window
                    if abs(value - plateau_value) / plateau_value > 0.2
                )
                if moved_count < 3:
                    continue

                candidate = float(pd.Series(future_window).median())
                ratio = candidate / plateau_value if plateau_value else 1.0
                if ratio >= 1.8 or ratio <= 0.55:
                    future_median = candidate
                    break

            if future_median is not None:
                repaired.iloc[run_start:run_end + 1] = future_median

        run_start = idx

    result = series.copy()
    result.loc[repaired.index] = repaired
    return result


def _repair_vendor_anomalies(close_df):
    if close_df is None or close_df.empty:
        return close_df

    repaired = close_df.copy()
    for column in repaired.columns:
        repaired[column] = _repair_constant_plateau_runs(
            _repair_leading_plateau_series(repaired[column])
        )
    return repaired


def _symbol_candidates(symbol):
    seen = set()
    candidates = [symbol]
    candidates.extend(SYMBOL_FALLBACKS.get(str(symbol).upper(), []))

    ordered = []
    for candidate in candidates:
        normalized = str(candidate).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _extract_close_series(prices, requested_symbol, downloaded_symbol):
    if prices is None or len(prices) == 0:
        return pd.Series(name=requested_symbol, dtype=float)

    close = prices["Close"].copy()
    if isinstance(close, pd.Series):
        close = close.to_frame(name=downloaded_symbol)

    if downloaded_symbol in close.columns:
        series = close[downloaded_symbol].copy()
    elif len(close.columns) == 1:
        series = close.iloc[:, 0].copy()
    else:
        return pd.Series(name=requested_symbol, dtype=float)

    series.index = pd.to_datetime(series.index)
    series = series.sort_index().ffill()
    series.name = requested_symbol
    return series


def _download_single_symbol(symbol, start_date, end_date):
    for candidate in _symbol_candidates(symbol):
        prices = yf.download(
            tickers=candidate,
            start=start_date,
            end=end_date,
            auto_adjust=False,
            repair=True,
            progress=False,
            group_by="column",
        )
        series = _extract_close_series(prices, requested_symbol=symbol, downloaded_symbol=candidate).dropna()
        if series.empty:
            continue
        return series

    return pd.Series(name=symbol, dtype=float)

def download_close_prices(data_symbols, start_date, end_date):
    """
    Returns a DataFrame:
    - index: datetime (daily)
    - columns: data_symbol
    - values: raw close prices (float)
    """
    if not data_symbols:
        return pd.DataFrame()

    frames = []
    for symbol in data_symbols:
        series = _download_single_symbol(symbol, start_date, end_date)
        if series.empty:
            continue
        frames.append(series.to_frame())

    if not frames:
        return pd.DataFrame()

    close = pd.concat(frames, axis=1).sort_index().ffill()
    close = _repair_vendor_anomalies(close)
    return close
