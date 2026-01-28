from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("login", views.login_view, name="login"),
    path("logout", views.logout_view, name="logout"),
    path("register", views.register, name="register"),

    # API Routes
    path("transactions", views.transactions, name="transactions"),
    path("transactions/<int:transaction_id>", views.transaction, name="transaction"),
    path("import", views.import_data, name="import"),

    path("assets", views.assets, name="assets"), 
    path("assets/<int:asset_id>", views.asset, name="asset"), 

    path("profile", views.profile, name="profile"),

    path("analytics/growth", views.analytics_growth, name="analytics-growth"),
    path("analytics/allocation", views.analytics_allocation, name="analytics-allocation"),
]
