from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""

    allowed_origins: str = "http://localhost:3000"

    max_music_bytes: int = 25 * 1024 * 1024
    max_music_seconds: int = 480

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash-exp"
    # When enabled, the video analyzer runs a dedicated Gemini call that
    # asks ONLY about the pattern timeline, then feeds the result into
    # the main scoring call as context. Per wcs-analyzer's docs, this
    # consistently outperforms asking the main prompt to enumerate
    # patterns while also scoring the dance. Costs one extra Gemini
    # call per analysis (~doubles Gemini spend).
    enable_pattern_prepass: bool = True
    max_video_bytes: int = 100 * 1024 * 1024  # 100 MB
    free_monthly_video: int = 1
    free_max_video_seconds: int = 120
    basic_monthly_video: int = 10
    basic_max_video_seconds: int = 300

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
