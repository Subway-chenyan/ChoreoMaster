import multiprocessing
import os

import uvicorn

from app.main import app


def main() -> None:
    uvicorn.run(
        app,
        host=os.getenv("APP_HOST", "127.0.0.1"),
        port=int(os.getenv("BACKEND_PORT", "8000")),
        log_level=os.getenv("AGENT_LOG_LEVEL", "info"),
        access_log=False,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
