import os
import secrets

from fastapi import Header, HTTPException, status


def _allowed_agent_keys() -> list[str]:
    configured = [
        key.strip()
        for key in os.getenv("AGENT_ACCESS_KEYS", "").split(",")
        if key.strip()
    ]
    if os.getenv("ALLOW_DEV_MEMBER_TOKEN", "false").lower() == "true":
        configured.append("dev-member-token")
    return configured


async def require_member_credential(
    authorization: str | None = Header(default=None),
) -> str:
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if token and any(
        secrets.compare_digest(token, allowed)
        for allowed in _allowed_agent_keys()
    ):
        return "agent-user"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Agent 访问 Key 无效或已过期，请联系管理员。",
    )
