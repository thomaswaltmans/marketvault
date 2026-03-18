from unittest.mock import patch

import pandas as pd
from django.contrib.auth import get_user_model
from django.test import TestCase

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

        self.index = pd.to_datetime([
            "2026-03-10",
            "2026-03-11",
            "2026-03-12",
            "2026-03-13",
            "2026-03-16",
        ])

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
