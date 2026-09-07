from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"
    database_url: str = "postgresql+asyncpg://hadlaan:hadlaan_dev_password@localhost:5432/hadlaan"

    jwt_secret: str = "dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    cors_origins: str = "http://localhost:5173"

    # Base URL the frontend is served from — embedded in generated QR codes
    # (see app/api/v1/facilities.py's qr-code endpoint) so scanning one with
    # a phone camera routes straight into the patrol check-in flow.
    app_base_url: str = "http://localhost:5173"

    s3_bucket: str = ""
    s3_region: str = "eu-central-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
