# portfolio/services/analytics.py
import pandas as pd
from django.utils import timezone

from portfolio.models import Asset, Transaction
from portfolio.services.prices_cache import get_close_prices_cached


def _transactions_dataframe(user):
    """
    Build a DataFrame from DB transactions.
    Columns: timestamp, date, data_symbol, txn_type, quantity, unit_price, div_amount
    """
    transactions = (
        Transaction.objects
        .filter(user=user)
        .select_related("asset")
        .order_by("timestamp")
    )

    rows = []
    for transaction in transactions:
        rows.append({
            "timestamp": transaction.timestamp,
            "date": transaction.timestamp.date(),
            "data_symbol": transaction.asset.data_symbol,
            "txn_type": transaction.txn_type,
            "quantity": float(transaction.quantity) if transaction.quantity is not None else None,
            "unit_price": float(transaction.unit_price) if transaction.unit_price is not None else None,
            "div_amount": float(transaction.div_amount) if transaction.div_amount is not None else None,
        })

    if not rows:
        return pd.DataFrame(columns=["timestamp", "date", "data_symbol", "txn_type", "quantity", "unit_price", "div_amount"])

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df


def _holdings_timeseries(df):
    """
    Inspired by your notebook: pivot by ticker, fillna(0), cumsum().

    BUY  -> +quantity
    SELL -> -quantity
    DIV  -> ignored for holdings
    """
    if df.empty:
        return pd.DataFrame()

    trades = df[df["txn_type"].isin(["BUY", "SELL"])].copy()
    if trades.empty:
        return pd.DataFrame()

    trades["signed_qty"] = trades["quantity"]
    trades.loc[trades["txn_type"] == "SELL", "signed_qty"] *= -1

    holdings = (
        trades.pivot_table(
            index="date",
            columns="data_symbol",
            values="signed_qty",
            aggfunc="sum"
        )
        .fillna(0)
        .cumsum()
        .sort_index()
    )

    # Reindex to daily dates so price-multiplication is easy
    start = holdings.index.min()
    end = pd.to_datetime(timezone.now().date())
    full_index = pd.date_range(start, end, freq="D")

    holdings = holdings.reindex(full_index).ffill().fillna(0)
    holdings.index.name = "date"

    return holdings


def _invested_timeseries(df):
    """
    "Net invested" curve (like your 'inleg' idea).
    Convention:
      BUY: cash outflow  -> invested increases (+)
      SELL: cash inflow  -> invested decreases (-)
      DIV: cash inflow   -> invested decreases (-)

    Returns a daily Series named 'invested'.
    """
    if df.empty:
        return pd.Series(dtype=float)

    df = df.copy()
    df["cashflow"] = 0.0

    is_buy = df["txn_type"] == "BUY"
    is_sell = df["txn_type"] == "SELL"
    is_div = df["txn_type"] == "DIV"

    df.loc[is_buy, "cashflow"] = df.loc[is_buy, "quantity"] * df.loc[is_buy, "unit_price"]
    df.loc[is_sell, "cashflow"] = -1 * df.loc[is_sell, "quantity"] * df.loc[is_sell, "unit_price"]
    df.loc[is_div, "cashflow"] = -1 * df.loc[is_div, "div_amount"]

    daily = df.groupby("date")["cashflow"].sum().sort_index().cumsum()

    # daily index fill
    start = daily.index.min()
    end = pd.to_datetime(timezone.now().date())
    full_index = pd.date_range(start, end, freq="D")

    daily = daily.reindex(full_index).ffill()
    daily.name = "invested"

    return daily


def _asset_insights(df, holdings, prices):
    if df.empty or holdings.empty or prices.empty:
        return {"best_performer": None, "worst_performer": None, "top_dividend_asset": None}

    latest_holdings = holdings.iloc[-1]
    latest_prices = prices.ffill().iloc[-1].reindex(latest_holdings.index).fillna(0)

    open_holdings = latest_holdings[latest_holdings > 0]
    if open_holdings.empty:
        return {"best_performer": None, "worst_performer": None, "top_dividend_asset": None}

    open_symbols = open_holdings.index.tolist()
    open_values = (open_holdings * latest_prices.reindex(open_symbols).fillna(0)).fillna(0)

    df_open = df[df["data_symbol"].isin(open_symbols)].copy()
    if df_open.empty:
        return {"best_performer": None, "worst_performer": None, "top_dividend_asset": None}

    df_open["cashflow_asset"] = 0.0
    is_buy = df_open["txn_type"] == "BUY"
    is_sell = df_open["txn_type"] == "SELL"
    is_div = df_open["txn_type"] == "DIV"

    df_open.loc[is_buy, "cashflow_asset"] = df_open.loc[is_buy, "quantity"] * df_open.loc[is_buy, "unit_price"]
    df_open.loc[is_sell, "cashflow_asset"] = -1 * df_open.loc[is_sell, "quantity"] * df_open.loc[is_sell, "unit_price"]
    df_open.loc[is_div, "cashflow_asset"] = -1 * df_open.loc[is_div, "div_amount"]

    net_invested = df_open.groupby("data_symbol")["cashflow_asset"].sum().reindex(open_symbols).fillna(0)
    roi_by_asset = pd.Series(index=open_symbols, dtype=float)

    valid_roi_mask = (net_invested > 0) & (open_values > 0)
    roi_by_asset.loc[valid_roi_mask] = (
        (open_values.loc[valid_roi_mask] - net_invested.loc[valid_roi_mask]) / net_invested.loc[valid_roi_mask]
    ) * 100

    best = None
    worst = None
    roi_clean = roi_by_asset.dropna()
    if not roi_clean.empty:
        best_symbol = roi_clean.idxmax()
        worst_symbol = roi_clean.idxmin()
        best = {"symbol": best_symbol, "roi_pct": float(roi_clean.loc[best_symbol])}
        worst = {"symbol": worst_symbol, "roi_pct": float(roi_clean.loc[worst_symbol])}

    cutoff = pd.to_datetime((timezone.now() - timezone.timedelta(days=365)).date())
    ttm_div = (
        df_open[(df_open["txn_type"] == "DIV") & (df_open["date"] >= cutoff)]
        .groupby("data_symbol")["div_amount"]
        .sum()
        .reindex(open_symbols)
        .fillna(0)
    )

    div_yield_by_asset = pd.Series(index=open_symbols, dtype=float)
    valid_yield_mask = open_values > 0
    div_yield_by_asset.loc[valid_yield_mask] = (
        ttm_div.loc[valid_yield_mask] / open_values.loc[valid_yield_mask]
    ) * 100

    top_dividend_asset = None
    div_clean = div_yield_by_asset.dropna()
    if not div_clean.empty:
        top_symbol = div_clean.idxmax()
        top_dividend_asset = {
            "symbol": top_symbol,
            "dividend_yield_ttm_pct": float(div_clean.loc[top_symbol]),
        }

    return {
        "best_performer": best,
        "worst_performer": worst,
        "top_dividend_asset": top_dividend_asset,
    }


def growth_payload(user):
    """
    Returns dict for Plotly.js line chart:
    - dates
    - portfolio_value
    - invested
    """
    df = _transactions_dataframe(user)
    if df.empty:
        return {
            "dates": [],
            "portfolio_value": [],
            "invested": [],
            "dividends_ttm": 0.0,
            "dividend_yield_ttm": None,
            "best_performer": None,
            "worst_performer": None,
            "top_dividend_asset": None,
        }

    holdings = _holdings_timeseries(df)
    if holdings.empty:
        return {
            "dates": [],
            "portfolio_value": [],
            "invested": [],
            "dividends_ttm": 0.0,
            "dividend_yield_ttm": None,
            "best_performer": None,
            "worst_performer": None,
            "top_dividend_asset": None,
        }

    start_date = holdings.index.min().strftime("%Y-%m-%d")
    end_date = (timezone.now().date() + timezone.timedelta(days=1)).strftime("%Y-%m-%d")

    prices = get_close_prices_cached(
        data_symbols=holdings.columns.tolist(),
        start_date=start_date,
        end_date=end_date
    )
    
    if prices.empty:
        # no price data => return empty series (or you could return holdings-only)
        return {
            "dates": [],
            "portfolio_value": [],
            "invested": [],
            "dividends_ttm": 0.0,
            "dividend_yield_ttm": None,
            "best_performer": None,
            "worst_performer": None,
            "top_dividend_asset": None,
        }

    # Align on dates
    prices.index = pd.to_datetime(prices.index.date)
    prices = prices.reindex(holdings.index)
    prices = prices.ffill().bfill()

    # Drop symbols with no data at all
    prices = prices.dropna(axis=1, how="all")

    # Keep holdings only for symbols we have prices for
    holdings = holdings.reindex(columns=prices.columns).fillna(0)

    values = holdings * prices
    total = values.sum(axis=1)

    invested = _invested_timeseries(df)
    invested = invested.reindex(total.index).ffill()

    cutoff = pd.to_datetime((timezone.now() - timezone.timedelta(days=365)).date())
    ttm_dividends = (
        df[(df["txn_type"] == "DIV") & (df["date"] >= cutoff)]["div_amount"]
        .fillna(0)
        .sum()
    )
    latest_value = float(total.iloc[-1]) if len(total) else 0.0
    dividend_yield_ttm = ((float(ttm_dividends) / latest_value) * 100) if latest_value > 0 else None
    insights = _asset_insights(df, holdings, prices)

    dates = [d.strftime("%Y-%m-%d") for d in total.index]
    return {
        "dates": dates,
        "portfolio_value": [float(x) for x in total.values],
        "invested": [float(x) for x in invested.values],
        "dividends_ttm": float(ttm_dividends),
        "dividend_yield_ttm": dividend_yield_ttm,
        "best_performer": insights["best_performer"],
        "worst_performer": insights["worst_performer"],
        "top_dividend_asset": insights["top_dividend_asset"],
    }


def allocation_payload(user):
    """
    Returns dict for Plotly.js pie chart:
    - labels: data_symbols
    - values: current position value (holdings * latest price)
    """
    df = _transactions_dataframe(user)
    if df.empty:
        return {"labels": [], "values": [], "asset_types": []}

    holdings = _holdings_timeseries(df)
    if holdings.empty:
        return {"labels": [], "values": [], "asset_types": []}

    last_holdings = holdings.iloc[-1]
    last_holdings = last_holdings[last_holdings > 0]

    if last_holdings.empty:
        return {"labels": [], "values": [], "asset_types": []}

    # pull prices for a small recent window and use last available
    start_date = (timezone.now().date() - timezone.timedelta(days=30)).strftime("%Y-%m-%d")
    end_date = (timezone.now().date() + timezone.timedelta(days=1)).strftime("%Y-%m-%d")

    prices = get_close_prices_cached(
        data_symbols=last_holdings.index.tolist(),
        start_date=start_date,
        end_date=end_date
    )

    if prices.empty:
        return {"labels": [], "values": [], "asset_types": []}

    # latest prices
    prices.index = pd.to_datetime(prices.index.date)
    latest = prices.ffill().iloc[-1].reindex(last_holdings.index).fillna(0)

    current_values = (last_holdings * latest)
    current_values = current_values[current_values > 0]

    if current_values.empty:
        return {"labels": [], "values": [], "asset_types": []}

    type_priority = {"ETF": 0, "STOCK": 1, "ETC": 2, "CRYPTO": 3}
    type_map = {
        asset.data_symbol: asset.asset_type
        for asset in Asset.objects.filter(user=user, data_symbol__in=current_values.index.tolist())
    }

    allocation_rows = pd.DataFrame({
        "data_symbol": current_values.index.tolist(),
        "value": current_values.values,
    })
    allocation_rows["asset_type"] = allocation_rows["data_symbol"].map(type_map).fillna("STOCK")
    allocation_rows["type_rank"] = allocation_rows["asset_type"].map(type_priority).fillna(99)

    allocation_rows = allocation_rows.sort_values(
        by=["type_rank", "value"],
        ascending=[True, False],
    )

    return {
        "labels": allocation_rows["data_symbol"].tolist(),
        "values": [float(x) for x in allocation_rows["value"].tolist()],
        "asset_types": allocation_rows["asset_type"].tolist(),
    }


def asset_growth_payload(user):
    """
    Returns per-asset growth series for dropdown-driven chart:
    - dates: shared date index
    - series: [{symbol, asset_type, value, invested}, ...]
    """
    df = _transactions_dataframe(user)
    if df.empty:
        return {"dates": [], "series": []}

    holdings = _holdings_timeseries(df)
    if holdings.empty:
        return {"dates": [], "series": []}

    start_date = holdings.index.min().strftime("%Y-%m-%d")
    end_date = (timezone.now().date() + timezone.timedelta(days=1)).strftime("%Y-%m-%d")

    prices = get_close_prices_cached(
        data_symbols=holdings.columns.tolist(),
        start_date=start_date,
        end_date=end_date
    )
    if prices.empty:
        return {"dates": [], "series": []}

    prices.index = pd.to_datetime(prices.index.date)
    prices = prices.reindex(holdings.index).ffill().bfill()
    prices = prices.dropna(axis=1, how="all")
    holdings = holdings.reindex(columns=prices.columns).fillna(0)
    if holdings.empty:
        return {"dates": [], "series": []}

    values = holdings * prices

    df_cash = df.copy()
    df_cash["cashflow_asset"] = 0.0
    is_buy = df_cash["txn_type"] == "BUY"
    is_sell = df_cash["txn_type"] == "SELL"
    is_div = df_cash["txn_type"] == "DIV"
    df_cash.loc[is_buy, "cashflow_asset"] = df_cash.loc[is_buy, "quantity"] * df_cash.loc[is_buy, "unit_price"]
    df_cash.loc[is_sell, "cashflow_asset"] = -1 * df_cash.loc[is_sell, "quantity"] * df_cash.loc[is_sell, "unit_price"]
    df_cash.loc[is_div, "cashflow_asset"] = -1 * df_cash.loc[is_div, "div_amount"]

    invested_by_asset = (
        df_cash.groupby(["date", "data_symbol"])["cashflow_asset"]
        .sum()
        .unstack(fill_value=0)
        .sort_index()
        .cumsum()
    )
    invested_by_asset = invested_by_asset.reindex(holdings.index).ffill().fillna(0)
    invested_by_asset = invested_by_asset.reindex(columns=values.columns, fill_value=0)

    type_map = {
        asset.data_symbol: asset.asset_type
        for asset in Asset.objects.filter(user=user, data_symbol__in=values.columns.tolist())
    }

    type_priority = {"ETF": 0, "STOCK": 1, "ETC": 2, "CRYPTO": 3}
    series = []
    for symbol in values.columns:
        symbol_values = values[symbol]
        symbol_invested = invested_by_asset[symbol]
        if float(symbol_values.max()) <= 0 and float(symbol_invested.max()) <= 0:
            continue

        series.append({
            "symbol": symbol,
            "asset_type": type_map.get(symbol, "STOCK"),
            "value": [float(x) for x in symbol_values.values],
            "invested": [float(x) for x in symbol_invested.values],
        })

    series.sort(
        key=lambda item: (
            type_priority.get(item["asset_type"], 99),
            -item["value"][-1] if item["value"] else 0,
        )
    )

    dates = [d.strftime("%Y-%m-%d") for d in values.index]
    return {"dates": dates, "series": series}
