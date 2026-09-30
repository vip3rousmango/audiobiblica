"""Backend configuration management for AudioBiblica."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from src.backend.services.paths import config_path as default_config_path


class Config:
    """Application configuration with persistence."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or default_config_path()
        self._data: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if self.config_path.exists():
            try:
                with self.config_path.open("r") as f:
                    self._data = json.load(f)
            except Exception:
                self._data = {}
        else:
            self._data = {}

    def _save(self) -> None:
        self.config_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temp_path = self.config_path.with_suffix(self.config_path.suffix + ".tmp")
        descriptor = os.open(temp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w") as output:
                json.dump(self._data, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, self.config_path)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
    def get(self, key: str, default: Any = None) -> Any:
        # Reload from file on each get to pick up changes
        self._load()
        # Check saved config first (user settings take priority)
        if key in self._data:
            return self._data[key]
        # Fallback to environment variable (for container/deployment scenarios)
        env_key = key.upper().replace(".", "_")
        env_value = os.getenv(env_key)
        if env_value is not None:
            return env_value
        return default

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self._save()

    def delete(self, key: str) -> None:
        if key in self._data:
            del self._data[key]
            self._save()

    @property
    def firecrawl_api_key(self) -> Optional[str]:
        return self.get("firecrawl.api_key")

    @firecrawl_api_key.setter
    def firecrawl_api_key(self, value: Optional[str]) -> None:
        if value:
            self.set("firecrawl.api_key", value)
        else:
            self.delete("firecrawl.api_key")

    @property
    def firecrawl_api_url(self) -> Optional[str]:
        return self.get("firecrawl.api_url")

    @firecrawl_api_url.setter
    def firecrawl_api_url(self, value: Optional[str]) -> None:
        if value:
            self.set("firecrawl.api_url", value)
        else:
            self.delete("firecrawl.api_url")

    @property
    def database_url(self) -> str:
        return self.get("database.url", "sqlite:///audiobiblica.db")

    @database_url.setter
    def database_url(self, value: str) -> None:
        self.set("database.url", value)


_config: Optional[Config] = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
    return _config