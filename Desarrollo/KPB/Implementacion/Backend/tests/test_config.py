from app.config import normalize_cors_origins


def test_normalize_cors_origins_strips_whitespace_and_trailing_slashes() -> None:
    assert normalize_cors_origins(
        "https://x.vercel.app/, http://localhost:5173"
    ) == ["https://x.vercel.app", "http://localhost:5173"]
