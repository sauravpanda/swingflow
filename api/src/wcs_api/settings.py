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
    # When enabled, runs a dedicated Gemini call asking ONLY about the
    # pattern timeline, then injects the result as context into the
    # main scoring call. wcs-analyzer found this improves scoring
    # quality, but it doubles Gemini spend per video. Since we now ask
    # the main prompt to emit start_time/end_time directly in
    # patterns_identified, the pre-pass is an opt-in precision mode for
    # cases where the main call mis-identifies patterns. Default off.
    enable_pattern_prepass: bool = False
    max_video_bytes: int = 250 * 1024 * 1024  # 250 MB
    free_monthly_video: int = 1
    free_max_video_seconds: int = 120
    basic_monthly_video: int = 10
    basic_max_video_seconds: int = 300

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
