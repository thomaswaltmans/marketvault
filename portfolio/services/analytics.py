# portfolio/services/analytics.py
import pandas as pd
from django.utils import timezone

from portfolio.models import Transaction
from portfolio.services.prices_yahoo import download_close_prices
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


def growth_payload(user):
    """
    Returns dict for Plotly.js line chart:
    - dates
    - portfolio_value
    - invested
    """
    df = _transactions_dataframe(user)
    if df.empty:
        return {"dates": [], "portfolio_value": [], "invested": []}

    holdings = _holdings_timeseries(df)
    if holdings.empty:
        return {"dates": [], "portfolio_value": [], "invested": []}

    start_date = holdings.index.min().strftime("%Y-%m-%d")
    end_date = (timezone.now().date() + timezone.timedelta(days=1)).strftime("%Y-%m-%d")

    prices = get_close_prices_cached(
        data_symbols=holdings.columns.tolist(),
        start_date=start_date,
        end_date=end_date
    )
    
    if prices.empty:
        # no price data => return empty series (or you could return holdings-only)
        return {"dates": [], "portfolio_value": [], "invested": []}

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

    dates = [d.strftime("%Y-%m-%d") for d in total.index]
    return {
        "dates": dates,
        "portfolio_value": [float(x) for x in total.values],
        "invested": [float(x) for x in invested.values],
    }


def allocation_payload(user):
    """
    Returns dict for Plotly.js pie chart:
    - labels: data_symbols
    - values: current position value (holdings * latest price)
    """
    df = _transactions_dataframe(user)
    if df.empty:
        return {"labels": [], "values": []}

    holdings = _holdings_timeseries(df)
    if holdings.empty:
        return {"labels": [], "values": []}

    last_holdings = holdings.iloc[-1]
    last_holdings = last_holdings[last_holdings > 0]

    if last_holdings.empty:
        return {"labels": [], "values": []}

    # pull prices for a small recent window and use last available
    start_date = (timezone.now().date() - timezone.timedelta(days=30)).strftime("%Y-%m-%d")
    end_date = (timezone.now().date() + timezone.timedelta(days=1)).strftime("%Y-%m-%d")

    prices = download_close_prices(
        data_symbols=last_holdings.index.tolist(),
        start_date=start_date,
        end_date=end_date
    )

    if prices.empty:
        return {"labels": [], "values": []}

    # latest prices
    prices.index = pd.to_datetime(prices.index.date)
    latest = prices.ffill().iloc[-1].reindex(last_holdings.index).fillna(0)

    current_values = (last_holdings * latest).sort_values(ascending=False)
    current_values = current_values[current_values > 0]

    return {
        "labels": current_values.index.tolist(),
        "values": [float(x) for x in current_values.values],
    }
