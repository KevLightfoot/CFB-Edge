"""Small CFBD API client with on-disk caching.

Completed seasons are cached forever (they never change), so a full
training run only costs API calls the first time. The current season is
re-fetched when its cache is older than `current_season_cache_hours`.
"""
import json
import os
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

BASE_URL = os.environ.get("CFBD_BASE_URL", "https://api.collegefootballdata.com")


class CFBDError(RuntimeError):
    pass


class CFBDClient:
    def __init__(self, api_key, cache_dir, current_season, cache_hours=6, mock=None):
        self.api_key = api_key
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.current_season = current_season
        self.cache_hours = cache_hours
        self.mock = mock  # MockCFBD instance when running with --mock
        self.calls_made = 0

    def _cache_path(self, path, params):
        key = path + "?" + urllib.parse.urlencode(sorted(params.items()))
        digest = hashlib.sha1(key.encode()).hexdigest()[:16]
        safe = path.strip("/").replace("/", "_")
        return self.cache_dir / f"{safe}_{params.get('year', 'x')}_{digest}.json"

    def get(self, path, params, season=None, optional=False):
        """GET an endpoint. Returns parsed JSON (list/dict) or None if optional and it fails."""
        if self.mock is not None:
            return self.mock.get(path, params)

        cache_file = self._cache_path(path, params)
        is_current = season is not None and season >= self.current_season
        if cache_file.exists():
            age_h = (time.time() - cache_file.stat().st_mtime) / 3600
            if not is_current or age_h < self.cache_hours:
                return json.loads(cache_file.read_text())

        if not self.api_key:
            raise CFBDError(
                "CFBD_API_KEY is not set. Put it in a .env file at the project root "
                "(see .env.example) or run with --mock to use sample data."
            )

        url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
            self.calls_made += 1
        except urllib.error.HTTPError as e:
            if optional:
                print(f"  (optional endpoint {path} unavailable: HTTP {e.code}, skipping)")
                return None
            body = e.read().decode(errors="ignore")[:300]
            raise CFBDError(f"CFBD {path} failed with HTTP {e.code}: {body}") from e
        except urllib.error.URLError as e:
            if optional:
                return None
            raise CFBDError(f"Could not reach CFBD ({e.reason}).") from e

        cache_file.write_text(json.dumps(data))
        return data
