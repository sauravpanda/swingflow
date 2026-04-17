from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""

    allowed_origins: str = "http://localhost:3000"
    admin_emails: str = "saurav@browser-use.com"

    max_music_bytes: int = 25 * 1024 * 1024
    max_music_seconds: int = 480

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""

    gemini_api_key: str = ""
    # Default matches sibling `wcs-analyzer` project. Requires Google
    # AI paid billing — on the free tier this model returns a 429 with
    # `limit: 0`. Production can override to `gemini-2.5-flash` via
    # the `GEMINI_MODEL` env var on Railway until billing is enabled.
    gemini_model: str = "gemini-3.1-pro-preview"
    # Dedicated Gemini pass focused only on pattern identification.
    # Enabled by default — users were reporting "everything defaults
    # to sugar push / basic," and a focused pre-pass with thinking_
    # level=high + detailed pattern reference materially improves
    # pattern distinction (whip vs side pass, tuck vs underarm,
    # etc.). Roughly doubles per-analysis Gemini cost.
    enable_pattern_prepass: bool = True
    max_video_bytes: int = 500 * 1024 * 1024  # 500 MB — we upload direct to R2 now, no proxy
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "swingflow-uploads"
    r2_upload_ttl_seconds: int = 3600
    free_monthly_video: int = 2
    free_max_video_seconds: int = 120
    basic_monthly_video: int = 10
    basic_max_video_seconds: int = 300

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
