# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/Karthigamurugadoss/pixabay-image-downloader/security/advisories/new)
rather than opening a public issue. You can expect a reply within a few days.

## What the app does to stay safe

- **API key stays on the server.** The Pixabay key is read from `.env` and is only used in server-side requests. It is never sent to the browser, and error messages never include request URLs (which would contain the key).
- **`/download` is not an open proxy.** It only fetches `https` URLs on `pixabay.com` and its subdomains, does not follow redirects, accepts only `image/*` responses, and refuses files over 30 MB.
- **Strict Content-Security-Policy** plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` headers on every response.
- **No HTML injection.** Results are rendered with DOM APIs (`textContent`), not by concatenating untrusted strings into HTML.
- **Inputs are validated.** Filters are checked against allow-lists, the query is capped at 100 characters and the page number is bounded.
- **Debug mode is off by default.** The Werkzeug debugger allows code execution, so it only runs when you set `FLASK_DEBUG=1`.
- **Dependencies are audited** with `pip-audit` (no known vulnerabilities at release time).

## Running it safely

- Never commit your `.env` file. It is listed in `.gitignore`; use `.env.example` as the template.
- The built-in Flask server is meant for local use and binds to `127.0.0.1`. If you deploy it publicly, run it behind a production WSGI server (for example `gunicorn`) with HTTPS and add rate limiting.
