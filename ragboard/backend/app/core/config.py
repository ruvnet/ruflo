"""
Application configuration management using Pydantic Settings.
"""

from typing import List, Optional, Union
from pathlib import Path
from pydantic import field_validator, AnyHttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
import warnings


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"  # Ignore extra fields in .env file
    )
    
    # Application Settings
    app_name: str = "RAGBOARD"
    app_version: str = "1.0.0"
    debug: bool = False
    environment: str = "production"
    api_v1_prefix: str = "/api/v1"
    
    # Server Configuration
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    workers: int = 4
    
    # Security
    secret_key: str = "dev-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    
    # Database
    database_url: str = "sqlite+aiosqlite:///./ragboard.db"
    redis_url: Optional[str] = None  # Optional for local development
    
    # Vector Database
    chroma_persist_directory: str = "./chroma_db"
    chroma_collection_name: str = "ragboard_vectors"
    
    # AI Providers (Optional for initial startup)
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    default_ai_model: str = "gpt-4-turbo-preview"
    
    # Feature flags for optional services
    enable_ai_features: bool = True  # Can be disabled if no API keys
    enable_pinecone: bool = False  # Disabled by default, use ChromaDB
    pinecone_api_key: Optional[str] = None
    pinecone_environment: Optional[str] = None
    
    # File Upload Settings
    max_upload_size: int = 104857600  # 100MB
    allowed_extensions: List[str] = [
        "pdf", "docx", "txt", "jpg", "jpeg", "png", 
        "mp3", "mp4", "wav", "webm"
    ]
    upload_dir: Path = Path("./uploads")
    
    # Transcription Settings
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    
    # OCR Settings
    tesseract_path: str = "/usr/bin/tesseract"
    ocr_languages: str = "eng"
    
    # WebSocket Settings
    ws_message_queue_size: int = 100
    ws_heartbeat_interval: int = 30
    
    # Monitoring
    enable_metrics: bool = True
    metrics_port: int = 9090
    
    # Logging
    log_level: str = "INFO"
    log_format: str = "json"
    log_file: Optional[str] = "./logs/ragboard.log"
    
    # CORS Settings
    cors_origins: List[AnyHttpUrl] = []
    cors_allow_credentials: bool = True
    cors_allow_methods: List[str] = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    cors_allow_headers: List[str] = ["*"]
    
    # Rate Limiting
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 60
    rate_limit_per_hour: int = 1000
    
    @field_validator("allowed_extensions", mode="before")
    @classmethod
    def parse_allowed_extensions(cls, v: Union[str, List[str]]) -> List[str]:
        """Parse comma-separated extensions string or list."""
        if isinstance(v, str):
            return [ext.strip() for ext in v.split(",")]
        return v
    
    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        """Parse comma-separated CORS origins."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v
    
    @field_validator("upload_dir")
    @classmethod
    def create_upload_dir(cls, v: Path) -> Path:
        """Ensure upload directory exists."""
        v = Path(v)
        v.mkdir(parents=True, exist_ok=True)
        return v
    
    @property
    def chroma_persist_path(self) -> Path:
        """Get Chroma persistence directory as Path object."""
        path = Path(self.chroma_persist_directory)
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    @property
    def log_file_path(self) -> Optional[Path]:
        """Get log file path and ensure directory exists."""
        if self.log_file:
            path = Path(self.log_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            return path
        return None
    
    @model_validator(mode='after')
    def validate_ai_features(self) -> 'Settings':
        """Validate AI features configuration."""
        if self.enable_ai_features:
            if not self.openai_api_key and not self.anthropic_api_key:
                warnings.warn(
                    "AI features enabled but no API keys provided. "
                    "Some features will be limited.",
                    UserWarning
                )
        return self
    
    @property
    def has_ai_capabilities(self) -> bool:
        """Check if any AI API keys are configured."""
        return bool(self.openai_api_key or self.anthropic_api_key)
    
    @property
    def database_is_sqlite(self) -> bool:
        """Check if using SQLite database."""
        return "sqlite" in self.database_url.lower()


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Create settings instance
settings = get_settings()