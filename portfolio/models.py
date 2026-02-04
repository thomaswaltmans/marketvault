from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils import timezone
from django.core.exceptions import ValidationError

# Create your models here.
class User(AbstractUser):
    pass

class Asset(models.Model):
    class AssetType(models.TextChoices):
        STOCK = "STOCK", "Stock"
        ETF = "ETF", "ETF"
        ETC = "ETC", "ETC"
        CRYPTO = "CRYPTO", "Crypto"

    user = models.ForeignKey("User", on_delete=models.CASCADE, related_name="assets")
    ticker = models.CharField(max_length=20)
    name = models.CharField(max_length=120, blank=True)
    asset_type = models.CharField(max_length=10, choices=AssetType.choices, default=AssetType.STOCK)
    currency = models.CharField(max_length=10, default="EUR")
    exchange = models.CharField(max_length=40, blank=True)
    data_symbol = models.CharField(max_length=30)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "ticker", "exchange"], name="unique_user_ticker_exchange"),
            models.UniqueConstraint(fields=["user", "data_symbol"], name="unique_user_data_symbol"),
        ]

    def __str__(self):
        return f"{self.ticker} ({self.exchange})"

class Transaction(models.Model):
    class TransactionType(models.TextChoices):
        BUY = "BUY", "Buy"
        SELL = "SELL", "Sell"
        DIVIDEND = "DIV", "Dividend"
    user = models.ForeignKey("User", on_delete=models.CASCADE, related_name="transactions")
    txn_type = models.CharField(max_length=4, choices=TransactionType.choices)
    asset = models.ForeignKey("Asset", on_delete=models.PROTECT, related_name="transactions")
    quantity = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True)
    unit_price = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True)
    div_amount = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)

    def serialize(self):
        return {
            "id": self.id,
            "user": self.user.username,
            "txn_type": self.txn_type,
            "asset": self.asset.ticker,
            "quantity": str(self.quantity) if self.quantity is not None else None,
            "unit_price": str(self.unit_price) if self.unit_price is not None else None,
            "div_amount": str(self.div_amount) if self.div_amount is not None else None,
            "timestamp": self.timestamp.isoformat(),
        }
    
    def clean(self):
        super().clean()

        is_div = self.txn_type == self.TransactionType.DIVIDEND

        trade_fields_filled = (self.quantity is not None) or (self.unit_price is not None)
        div_field_filled = self.div_amount is not None

        if is_div:
            if not div_field_filled:
                raise ValidationError({"div_amount": "Dividend transactions require a dividend amount."})
            if trade_fields_filled:
                raise ValidationError("Dividend transactions cannot include quantity or unit price.")
        else:
            if self.quantity is None:
                raise ValidationError({"quantity": "Buy/Sell transactions require quantity."})
            if self.unit_price is None:
                raise ValidationError({"unit_price": "Buy/Sell transactions require unit price."})
            if div_field_filled:
                raise ValidationError({"div_amount": "Buy/Sell transactions cannot include a dividend amount."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

class PricePoint(models.Model):
    asset = models.ForeignKey("Asset", on_delete=models.CASCADE, related_name="price_points")
    date = models.DateField()
    close = models.DecimalField(max_digits=20, decimal_places=8)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "date"], name="unique_asset_date")
        ]
        indexes = [
            models.Index(fields=["asset", "date"]),
            models.Index(fields=["date"]),
        ]

    def __str__(self):
        return f"{self.asset.ticker} {self.date} {self.close}"
