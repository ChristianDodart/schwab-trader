"""One-time Schwab login. Run:  python -m app.schwab.authorize

Opens (prints) the Schwab auth URL, you log in, then paste the redirected
https://127.0.0.1/... URL back in. Writes token.json for the service to use.
"""
from __future__ import annotations

from .auth import interactive_login


def main() -> None:
    print("Starting Schwab manual OAuth flow...")
    interactive_login()
    print("\nSuccess. token.json written. You can now start the server.")


if __name__ == "__main__":
    main()
