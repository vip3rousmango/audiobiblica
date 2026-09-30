"""HTTP adapters for the app's built-in LLM providers and Nanobot gateway."""

from __future__ import annotations

import os
from typing import Any

import httpx


class AssistantError(RuntimeError):
    """A configured assistant runtime could not complete the request."""


class AssistantTransportError(AssistantError):
    """The assistant service dropped or refused the connection before answering."""


def _timeout() -> httpx.Timeout:
    try:
        read = float(os.getenv("ASSISTANT_TIMEOUT", "180"))
    except ValueError:
        read = 180.0
    return httpx.Timeout(read, connect=8.0)


async def _post_json(url: str, *, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise AssistantError(
            f"The assistant service at {url} did not answer in time ({type(exc).__name__}). "
            "A large local model can take a minute to load; otherwise raise ASSISTANT_TIMEOUT or choose a smaller model."
        ) from exc
    except httpx.HTTPError as exc:
        detail = str(exc) or type(exc).__name__
        raise AssistantTransportError(f"Could not connect to the configured assistant service: {detail}") from exc
    if not response.is_success:
        try:
            detail = response.json().get("error", {}).get("message") or response.json().get("detail")
        except (ValueError, AttributeError):
            detail = response.text[:500]
        raise AssistantError(f"Assistant service returned HTTP {response.status_code}: {detail or 'request failed'}")
    try:
        return response.json()
    except ValueError as exc:
        raise AssistantError("Assistant service returned invalid JSON") from exc


def _bearer(key: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"} if key else {}


async def chat_completion(
    *,
    runtime: str,
    provider: str,
    model: str,
    api_key: str | None,
    local_base_url: str,
    nanobot_url: str,
    nanobot_api_key: str | None,
    messages: list[dict[str, str]],
    session_id: str,
) -> str:
    """Generate one assistant response without exposing configured credentials."""
    if runtime == "nanobot":
        url = f"{nanobot_url.rstrip('/')}/v1/chat/completions"
        result = await _post_json(
            url,
            headers=_bearer(nanobot_api_key),
            payload={"model": "nanobot", "messages": messages, "session_id": session_id, "stream": False},
        )
        try:
            return result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AssistantError("Nanobot returned no assistant message") from exc

    if runtime != "builtin":
        raise AssistantError("Choose either the built-in provider or Nanobot runtime")

    if provider == "OpenAI":
        if not api_key:
            raise AssistantError("Add an OpenAI API key in Settings before using the built-in assistant")
        result = await _post_json(
            "https://api.openai.com/v1/chat/completions",
            headers={**_bearer(api_key), "Content-Type": "application/json"},
            payload={"model": model, "messages": messages, "stream": False, "max_completion_tokens": 1200},
        )
        try:
            return result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AssistantError("OpenAI returned no assistant message") from exc

    if provider == "Anthropic":
        if not api_key:
            raise AssistantError("Add an Anthropic API key in Settings before using the built-in assistant")
        system = "\n\n".join(item["content"] for item in messages if item["role"] == "system")
        conversation = [item for item in messages if item["role"] in {"user", "assistant"}]
        result = await _post_json(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
            payload={"model": model, "system": system, "messages": conversation, "max_tokens": 1200},
        )
        text = "\n".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
        if not text:
            raise AssistantError("Anthropic returned no assistant message")
        return text

    if provider == "Local":
        base_url = local_base_url.rstrip("/") or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        payload = {"model": model, "messages": messages, "stream": False, "options": {"num_predict": 1200}}
        # Ollama drops the connection while loading a cold model; a local retry costs nothing.
        result = None
        for attempt in range(2):
            try:
                result = await _post_json(f"{base_url}/api/chat", headers={"Content-Type": "application/json"}, payload=payload)
                break
            except AssistantTransportError:
                if attempt == 1:
                    raise
        if result is None:
            raise AssistantError("Local model did not return a response")
        try:
            return result["message"]["content"]
        except (KeyError, TypeError) as exc:
            raise AssistantError("Local model returned no assistant message") from exc

    raise AssistantError(f"Unsupported assistant provider: {provider}")


async def check_runtime(
    *,
    runtime: str,
    provider: str,
    api_key: str | None,
    local_base_url: str,
    nanobot_url: str,
    nanobot_api_key: str | None,
) -> str:
    """Check provider reachability without starting a billable generation."""
    if runtime == "nanobot":
        url = f"{nanobot_url.rstrip('/')}/v1/models"
        headers = _bearer(nanobot_api_key)
    elif runtime == "builtin" and provider == "OpenAI":
        if not api_key:
            raise AssistantError("Add an OpenAI API key in Settings first")
        url = "https://api.openai.com/v1/models"
        headers = _bearer(api_key)
    elif runtime == "builtin" and provider == "Anthropic":
        if not api_key:
            raise AssistantError("Add an Anthropic API key in Settings first")
        url = "https://api.anthropic.com/v1/models"
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    elif runtime == "builtin" and provider == "Local":
        url = f"{local_base_url.rstrip('/') or os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')}/api/tags"
        headers = {}
    else:
        raise AssistantError("Choose a supported assistant runtime and provider")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AssistantError(f"Could not connect to the configured assistant service: {exc}") from exc
    if not response.is_success:
        raise AssistantError(f"Assistant service returned HTTP {response.status_code}")
    return "Assistant service is reachable."


async def list_models(
    *,
    runtime: str,
    provider: str,
    api_key: str | None,
    local_base_url: str,
    nanobot_url: str,
    nanobot_api_key: str | None,
) -> list[str]:
    """List the model identifiers the configured runtime actually serves."""
    if runtime == "nanobot":
        url = f"{nanobot_url.rstrip('/')}/v1/models"
        headers = _bearer(nanobot_api_key)
    elif runtime == "builtin" and provider == "OpenAI":
        if not api_key:
            raise AssistantError("Add an OpenAI API key in Settings first")
        url = "https://api.openai.com/v1/models"
        headers = _bearer(api_key)
    elif runtime == "builtin" and provider == "Anthropic":
        if not api_key:
            raise AssistantError("Add an Anthropic API key in Settings first")
        url = "https://api.anthropic.com/v1/models"
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    elif runtime == "builtin" and provider == "Local":
        base_url = local_base_url.rstrip("/") or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        url = f"{base_url.rstrip('/')}/api/tags"
        headers = {}
    else:
        raise AssistantError("Choose a supported assistant runtime and provider")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AssistantError(f"Could not connect to the configured assistant service: {exc}") from exc
    if not response.is_success:
        raise AssistantError(f"Assistant service returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise AssistantError("Assistant service returned invalid JSON") from exc

    if provider == "Local" and runtime == "builtin":
        names = [str(item.get("name") or item.get("model") or "") for item in payload.get("models", [])]
    else:
        names = [str(item.get("id") or "") for item in payload.get("data", payload.get("models", []))]
    return sorted({name for name in names if name})
