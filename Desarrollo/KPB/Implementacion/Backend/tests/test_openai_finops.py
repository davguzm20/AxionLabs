import json
import sys
import types
import uuid
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.integrations.ai import extractor, vision
from app.integrations.ai.classifier import CategoryClassifier
from app.integrations.ai.transcription import MOCK_TRANSCRIPT, transcribe


def _install_fake_openai(monkeypatch, content: str | None = None, error: Exception | None = None):
    calls: dict[str, object] = {}

    class FakeOpenAI:
        def __init__(self, **kwargs) -> None:
            calls["client"] = kwargs
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self.create)
            )

        def create(self, **kwargs):
            calls["request"] = kwargs
            if error is not None:
                raise error
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    module = types.ModuleType("openai")
    module.OpenAI = FakeOpenAI
    monkeypatch.setitem(sys.modules, "openai", module)
    return calls


def test_text_openai_call_has_hard_cost_limits(monkeypatch) -> None:
    calls = _install_fake_openai(
        monkeypatch,
        json.dumps({
            "type": "EXPENSE", "amount": "12.50", "currency": "PEN",
            "concept": "almuerzo", "merchant": None,
            "transaction_date": "2026-11-14", "confidence": 0.9,
        }),
    )

    result = extractor._extract_with_openai(
        "gasté 12.50", "test-key", "gpt-4o-mini", "2026-11-14", "PEN"
    )

    assert result.amount is not None
    assert calls["client"] == {"api_key": "test-key", "timeout": 10.0, "max_retries": 0}
    assert calls["request"] and calls["request"]["temperature"] == 0.0
    assert calls["request"]["max_tokens"] == 150


def test_classifier_openai_call_has_hard_cost_limits(monkeypatch) -> None:
    category_id = uuid.uuid4()
    calls = _install_fake_openai(
        monkeypatch,
        json.dumps({"category_id": str(category_id), "confidence": 0.9, "reason": "mock"}),
    )
    classifier = object.__new__(CategoryClassifier)
    classifier._settings = SimpleNamespace(openai_api_key="test-key", openai_text_model="gpt-4o-mini")

    result = classifier._classify_with_openai(
        "EXPENSE", "almuerzo", None,
        [{"id": str(category_id), "name": "Alimentación", "type": "EXPENSE"}],
    )

    assert result.category_id == category_id
    assert calls["client"] == {"api_key": "test-key", "timeout": 10.0, "max_retries": 0}
    assert calls["request"] and calls["request"]["temperature"] == 0.0
    assert calls["request"]["max_tokens"] == 150


def test_vision_openai_call_has_hard_cost_limits(monkeypatch) -> None:
    calls = _install_fake_openai(
        monkeypatch,
        json.dumps({"amount": "45.90", "currency": "PEN", "transaction_date": "2026-11-14"}),
    )

    result = vision._extract_with_openai_vision(
        b"not-a-real-image", "image/jpeg", "test-key", "gpt-4o-mini", "2026-11-14", "PEN"
    )

    assert result.amount is not None
    assert calls["client"] == {"api_key": "test-key", "timeout": 30.0, "max_retries": 0}
    assert calls["request"] and calls["request"]["temperature"] == 0.0
    assert calls["request"]["max_tokens"] == 800
    image = calls["request"]["messages"][1]["content"][1]
    assert image["image_url"]["detail"] == "auto"


def test_vision_openai_failure_returns_ocr_unavailable(monkeypatch) -> None:
    _install_fake_openai(monkeypatch, error=RuntimeError("network unavailable"))

    text = extractor._extract_with_openai(
        "gasté 15 soles", "test-key", "gpt-4o-mini", "2026-11-14", "PEN"
    )
    with pytest.raises(AppError) as exc:
        vision._extract_with_openai_vision(
            b"image", "image/jpeg", "test-key", "gpt-4o-mini", "2026-11-14", "PEN"
        )

    assert text.amount is not None
    assert (exc.value.status_code, exc.value.code) == (503, "OCR_UNAVAILABLE")


def test_transcription_is_always_local_mock() -> None:
    assert transcribe(b"audio", "audio/webm").text == MOCK_TRANSCRIPT
