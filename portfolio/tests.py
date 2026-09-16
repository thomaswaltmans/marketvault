from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from portfolio.models import Asset, PricePoint
from portfolio.services.prices_cache import get_close_prices_cached


class PriceCacheGuardTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="alice",
            password="password123",
        )
        self.asset_a = Asset.objects.create(
            user=self.user,
            ticker="AAA",
            name="Asset A",
            asset_type=Asset.AssetType.STOCK,
            currency="EUR",
            exchange="Euronext",
            data_symbol="AAA.AS",
        )
        self.asset_b = Asset.objects.create(
            user=self.user,
            ticker="BBB",
            name="Asset B",
            asset_type=Asset.AssetType.STOCK,
            currency="EUR",
            exchange="Euronext",
            data_symbol="BBB.AS",
        )

        self.index = pd.to_datetime(
            [
                "2026-03-10",
                "2026-03-11",
                "2026-03-12",
                "2026-03-13",
                "2026-03-16",
            ]
        )

        for dt, close in zip(self.index, [10, 11, 12, 13, 14]):
            PricePoint.objects.create(
                asset=self.asset_a,
                date=dt.date(),
                close=close,
            )

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_skips_download_that_matches_other_cached_symbol(self, mock_download):
        mock_download.return_value = pd.DataFrame(
            {"BBB.AS": [10, 11, 12, 13, 14]},
            index=self.index,
        )

        df = get_close_prices_cached(
            data_symbols=["BBB.AS"],
            start_date="2026-03-10",
            end_date="2026-03-18",
            user=self.user,
            force_refresh_symbols={"BBB.AS"},
        )

        self.assertEqual(PricePoint.objects.filter(asset=self.asset_b).count(), 0)
        self.assertNotIn("BBB.AS", df.columns)

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_caches_distinct_download(self, mock_download):
        mock_download.return_value = pd.DataFrame(
            {"BBB.AS": [20, 21, 22, 23, 24]},
            index=self.index,
        )

        df = get_close_prices_cached(
            data_symbols=["BBB.AS"],
            start_date="2026-03-10",
            end_date="2026-03-18",
            user=self.user,
            force_refresh_symbols={"BBB.AS"},
        )

        self.assertEqual(PricePoint.objects.filter(asset=self.asset_b).count(), 5)
        self.assertIn("BBB.AS", df.columns)
        self.assertEqual(float(df["BBB.AS"].dropna().iloc[-1]), 24.0)


class PriceFetchSchedulingTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="bob",
            password="password123",
        )
        self.asset = Asset.objects.create(
            user=self.user,
            ticker="AAA",
            name="Asset A",
            asset_type=Asset.AssetType.STOCK,
            currency="EUR",
            exchange="Euronext",
            data_symbol="AAA.AS",
        )

        self.index = pd.to_datetime(
            [
                "2026-03-10",
                "2026-03-11",
                "2026-03-12",
                "2026-03-13",
                "2026-03-16",
            ]
        )
        for dt, close in zip(self.index, [10, 11, 12, 13, 14]):
            PricePoint.objects.create(asset=self.asset, date=dt.date(), close=close)

    def _downloaded(self):
        return pd.DataFrame({"AAA.AS": [10, 11, 12, 13, 14]}, index=self.index)

    def _fetch(self, start_date="2026-03-10", end_date="2026-03-18"):
        return get_close_prices_cached(
            data_symbols=["AAA.AS"],
            start_date=start_date,
            end_date=end_date,
            user=self.user,
        )

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_second_call_within_freshness_window_skips_download(self, mock_download):
        mock_download.return_value = self._downloaded()

        self._fetch()
        self._fetch()

        self.assertEqual(mock_download.call_count, 1)

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_wider_window_refetches_even_when_recently_fetched(self, mock_download):
        mock_download.return_value = self._downloaded()

        self._fetch(start_date="2026-03-13")
        self._fetch(start_date="2026-03-10")

        self.assertEqual(mock_download.call_count, 2)

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_stale_asset_fetches_only_the_tail(self, mock_download):
        mock_download.return_value = self._downloaded()
        Asset.objects.filter(pk=self.asset.pk).update(
            prices_covered_from=date(2026, 3, 10),
            prices_fetched_at=timezone.now() - timedelta(hours=2),
        )

        self._fetch()

        self.assertEqual(mock_download.call_count, 1)
        self.assertEqual(str(mock_download.call_args.args[1]), "2026-03-16")

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_failed_download_still_records_the_attempt(self, mock_download):
        mock_download.return_value = pd.DataFrame()

        self._fetch()
        self._fetch()

        self.assertEqual(mock_download.call_count, 1)

    @patch("portfolio.services.prices_cache._download_with_retries")
    def test_symbols_sharing_a_window_download_together(self, mock_download):
        other = Asset.objects.create(
            user=self.user,
            ticker="BBB",
            name="Asset B",
            asset_type=Asset.AssetType.STOCK,
            currency="EUR",
            exchange="Euronext",
            data_symbol="BBB.AS",
        )
        mock_download.return_value = pd.DataFrame(
            {"AAA.AS": [10, 11, 12, 13, 14], "BBB.AS": [20, 21, 22, 23, 24]},
            index=self.index,
        )

        get_close_prices_cached(
            data_symbols=[self.asset.data_symbol, other.data_symbol],
            start_date="2026-03-10",
            end_date="2026-03-18",
            user=self.user,
        )

        self.assertEqual(mock_download.call_count, 1)
        self.assertCountEqual(mock_download.call_args.args[0], ["AAA.AS", "BBB.AS"])
