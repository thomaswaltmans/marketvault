# portfolio/services/prices_yahoo.py
import pandas as pd
import yfinance as yf

def download_close_prices(data_symbols, start_date, end_date):
    """
    Returns a DataFrame:
    - index: datetime (daily)
    - columns: data_symbol
    - values: adjusted close prices (float)
    """
    if not data_symbols:
        return pd.DataFrame()

    prices = yf.download(
        tickers=list(data_symbols),
        start=start_date,
        end=end_date,
        auto_adjust=True,
        progress=False,
        group_by="column"
    )

    if prices is None or len(prices) == 0:
        return pd.DataFrame()

    close = prices["Close"].copy()

    # If only 1 ticker is requested, yfinance sometimes returns a Series
    if isinstance(close, pd.Series):
        close = close.to_frame(name=list(data_symbols)[0])

    close.index = pd.to_datetime(close.index)
    close = close.sort_index().ffill()

    return close
