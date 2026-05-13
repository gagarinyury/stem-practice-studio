from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import auth


def main() -> None:
    email = os.environ.get("ADMIN_EMAIL", "yury@vitai.pro").strip()
    if not email:
        raise SystemExit("ADMIN_EMAIL is empty")

    password = os.environ.get("ADMIN_PASSWORD")
    if password is None:
        password = getpass.getpass(f"Admin password for {email}: ")
        confirm = getpass.getpass("Repeat password: ")
        if password != confirm:
            raise SystemExit("passwords do not match")

    auth.init_db()
    user = auth.create_or_update_admin(email, password)
    print(f"admin ready: {user['email']} ({user['role']})")


if __name__ == "__main__":
    main()
