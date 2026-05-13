from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import auth, invites


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Stem Studio invite codes")
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add", help="create or update a readable invite code")
    add.add_argument("code")
    add.add_argument("label")

    gen = sub.add_parser("generate", help="generate and create a code from a label")
    gen.add_argument("label")
    gen.add_argument("--prefix", default="stem")

    disable = sub.add_parser("disable", help="disable a code")
    disable.add_argument("code")

    sub.add_parser("list", help="list invite codes and user counts")

    args = parser.parse_args()
    auth.init_db()
    invites.init_db()

    if args.cmd == "add":
        row = invites.create_or_update(args.code, args.label)
        print(f"{row['code']}\t{row['label']}\tactive={row['active']}")
    elif args.cmd == "generate":
        code = invites.generated_code(args.label, args.prefix)
        row = invites.create_or_update(code, args.label)
        print(f"{row['code']}\t{row['label']}\tactive={row['active']}")
    elif args.cmd == "disable":
        row = invites.disable(args.code)
        print(f"{row['code']}\t{row['label']}\tactive={row['active']}")
    elif args.cmd == "list":
        list_invites()


def list_invites() -> None:
    with auth.connect() as con:
        rows = con.execute("""
            SELECT
                invite_codes.code,
                invite_codes.label,
                invite_codes.active,
                invite_codes.created_at,
                COUNT(users.id) AS users
            FROM invite_codes
            LEFT JOIN users ON users.invite_code = invite_codes.code
            GROUP BY invite_codes.code
            ORDER BY invite_codes.created_at DESC
        """).fetchall()
    for row in rows:
        print(
            "\t".join([
                row["code"],
                row["label"],
                "active" if row["active"] else "disabled",
                f"users={row['users']}",
            ])
        )


if __name__ == "__main__":
    main()
