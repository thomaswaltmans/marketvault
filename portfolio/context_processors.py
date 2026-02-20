from django.conf import settings


def feature_flags(request):
    return {
        "REGISTRATION_ENABLED": getattr(settings, "REGISTRATION_ENABLED", False),
    }
