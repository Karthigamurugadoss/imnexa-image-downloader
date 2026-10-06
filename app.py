from flask import Flask, render_template, request, jsonify, send_file
from dotenv import load_dotenv
import requests
import os
import threading
import time
from io import BytesIO
from urllib.parse import urlparse

load_dotenv()

app = Flask(__name__)

PIXABAY_API_KEY = os.getenv("PIXABAY_API_KEY")
PIXABAY_URL = "https://pixabay.com/api/"

PER_PAGE = 20
MAX_QUERY_LENGTH = 100                      # Pixabay rejects longer queries
MAX_PAGE = 500 // PER_PAGE                  # Pixabay only serves the first 500 hits
MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024       # refuse to proxy anything bigger than 30 MB

# Pixabay's API terms require search requests to be cached for 24 hours.
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_ENTRIES = 500
_search_cache = {}                          # key -> (expires_at, payload)
_cache_lock = threading.Lock()


def cache_get(key):
    with _cache_lock:
        entry = _search_cache.get(key)
        if entry and entry[0] > time.time():
            return entry[1]
        _search_cache.pop(key, None)
        return None


def cache_set(key, payload):
    with _cache_lock:
        if len(_search_cache) >= CACHE_MAX_ENTRIES:
            now = time.time()
            for stale in [k for k, (expires, _) in _search_cache.items() if expires <= now]:
                del _search_cache[stale]
            if len(_search_cache) >= CACHE_MAX_ENTRIES:
                # still full: drop the entry that expires soonest (the oldest)
                del _search_cache[min(_search_cache, key=lambda k: _search_cache[k][0])]
        _search_cache[key] = (time.time() + CACHE_TTL_SECONDS, payload)

# Everything the page loads: own files, Google Fonts, and Pixabay images.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://pixabay.com https://*.pixabay.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


@app.after_request
def add_security_headers(response):
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/search")
def search():
    query = request.args.get("q", "").strip()[:MAX_QUERY_LENGTH]
    page = min(max(request.args.get("page", 1, type=int), 1), MAX_PAGE)

    if not query:
        return jsonify({
            "success": False,
            "message": "Please enter a search term."
        })

    if not PIXABAY_API_KEY:
        return jsonify({
            "success": False,
            "message": "Pixabay API key is missing. Check your .env file."
        })

    image_type = request.args.get("type", "photo")
    if image_type not in ("all", "photo", "illustration", "vector"):
        image_type = "photo"

    orientation = request.args.get("orientation", "all")
    if orientation not in ("all", "horizontal", "vertical"):
        orientation = "all"

    params = {
        "key": PIXABAY_API_KEY,
        "q": query,
        "image_type": image_type,
        "orientation": orientation,
        "safesearch": "true",
        "per_page": PER_PAGE,
        "page": page
    }

    # The cache key leaves out the API key on purpose
    cache_key = (query.lower(), image_type, orientation, page)
    cached = cache_get(cache_key)
    if cached is not None:
        return jsonify(cached)

    try:
        response = requests.get(
            PIXABAY_URL,
            params=params,
            timeout=20
        )

        print("Pixabay Status:", response.status_code)

        if response.status_code == 429:
            return jsonify({
                "success": False,
                "message": "Pixabay rate limit reached. Wait a minute and try again."
            })

        if response.status_code != 200:
            return jsonify({
                "success": False,
                "message": f"Pixabay API Error {response.status_code}: {response.text[:200]}"
            })

        data = response.json()

        images = []

        for image in data.get("hits", []):
            images.append({
                "id": image.get("id"),
                "previewURL": image.get("previewURL"),
                "webformatURL": image.get("webformatURL"),
                "largeImageURL": image.get("largeImageURL"),
                "width": image.get("webformatWidth"),
                "height": image.get("webformatHeight"),
                "fullWidth": image.get("imageWidth"),
                "fullHeight": image.get("imageHeight"),
                "pageURL": image.get("pageURL"),
                "tags": image.get("tags"),
                "user": image.get("user"),
                "likes": image.get("likes"),
                "views": image.get("views"),
                "downloads": image.get("downloads")
            })

        payload = {
            "success": True,
            "total": data.get("total", 0),
            "images": images
        }

        cache_set(cache_key, payload)

        return jsonify(payload)

    except requests.exceptions.RequestException as e:
        # Don't echo the exception text: it contains the request URL, including the API key
        print("Request Error:", type(e).__name__)

        return jsonify({
            "success": False,
            "message": "Couldn't reach Pixabay. Check your connection and try again."
        })


@app.route("/download")
def download():
    image_url = request.args.get("url")

    if not image_url:
        return "Image URL is missing.", 400

    parsed = urlparse(image_url)
    host = parsed.hostname or ""

    # Only proxy images hosted by Pixabay (prevents use as an open proxy / SSRF)
    if parsed.scheme != "https" or not (host == "pixabay.com" or host.endswith(".pixabay.com")):
        return "Invalid image URL.", 400

    try:
        # No redirects: a redirect could otherwise leave the Pixabay host check behind
        with requests.get(image_url, timeout=20, allow_redirects=False, stream=True) as response:

            if response.status_code != 200:
                return "Unable to download image.", 400

            content_type = response.headers.get("Content-Type", "")
            if not content_type.startswith("image/"):
                return "Unable to download image.", 400

            # Read in chunks so an oversized file is abandoned instead of loaded into memory
            body = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                body.extend(chunk)
                if len(body) > MAX_DOWNLOAD_BYTES:
                    return "Image is too large.", 413

        extension = os.path.splitext(parsed.path)[1].lower()
        if extension not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
            extension = ".jpg"

        image_id = request.args.get("id", "")
        if not image_id.isdigit():
            image_id = "download"

        return send_file(
            BytesIO(bytes(body)),
            mimetype=content_type,
            as_attachment=True,
            download_name=f"imnexa-{image_id}{extension}"
        )

    except requests.exceptions.RequestException as e:
        print("Download Error:", type(e).__name__)
        return "Unable to download image.", 500


if __name__ == "__main__":
    # The Werkzeug debugger allows code execution, so it is opt-in: set FLASK_DEBUG=1 for development.
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", 5000)),
        debug=os.getenv("FLASK_DEBUG") == "1"
    )