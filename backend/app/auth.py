from fastapi import Header, HTTPException, status


async def require_member_credential(
    authorization: str | None = Header(default=None),
) -> str:
    """Placeholder for the real member credential system.

    The production version should validate the membership token here and return
    a user or tenant id. Tests use the stable "dev-member-token" credential.
    """
    if authorization == "Bearer dev-member-token":
        return "dev-user"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid member credential.",
    )
