const PIXABAY_CAP = 500;   // Pixabay only serves the first 500 hits of a query
const STARTERS = ["fog", "architecture", "ocean", "autumn", "street", "mountain"];

const state = {
    query: "",
    page: 1,
    type: "photo",
    orientation: "all",
    total: 0,
    images: [],       // everything currently on screen, in order
    token: 0,         // guards against out-of-order responses
    viewerIndex: -1
};

const $ = id => document.getElementById(id);

const els = {
    topbar: $("topbar"),
    heroBg: $("heroBg"),
    form: $("searchForm"),
    input: $("searchInput"),
    miniForm: $("miniForm"),
    miniInput: $("miniInput"),
    grid: $("imageGrid"),
    title: $("resultsTitle"),
    count: $("resultCount"),
    message: $("message"),
    more: $("loadMoreButton"),
    viewer: $("viewer")
};

const DOWNLOAD_ICON =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';


// ───────── Helpers ─────────

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function formatNumber(n) {
    return (n ?? 0).toLocaleString();
}

// Pixabay tags can be long and repetitive; keep the first few unique ones
function headline(tags, max = 4) {
    const unique = [...new Set((tags || "").split(",").map(t => t.trim()).filter(Boolean))];
    return unique.slice(0, max).join(", ");
}

function isPixabayURL(value) {
    try {
        const { protocol, hostname } = new URL(value);
        return protocol === "https:" && (hostname === "pixabay.com" || hostname.endsWith(".pixabay.com"));
    } catch {
        return false;
    }
}

function downloadURL(image) {
    return `/download?url=${encodeURIComponent(image.largeImageURL)}&id=${encodeURIComponent(image.id)}`;
}

function showMessage(text) {
    els.message.textContent = text;
    els.message.hidden = !text;
}


// ───────── Search ─────────

async function fetchPage(page) {
    const params = new URLSearchParams({
        q: state.query,
        page,
        type: state.type,
        orientation: state.orientation
    });

    const response = await fetch(`/search?${params}`);
    return response.json();
}

async function runSearch(query) {
    query = query.trim();

    if (!query) {
        els.input.focus();
        return;
    }

    state.query = query;
    state.page = 1;
    state.images = [];
    state.total = 0;
    const token = ++state.token;

    els.input.value = query;
    els.miniInput.value = query;
    history.replaceState(null, "", `?q=${encodeURIComponent(query)}`);
    els.grid.innerHTML = "";
    els.more.hidden = true;
    els.count.textContent = "";
    showMessage("");
    setTitle(query);
    showSkeletons(12);

    try {
        const data = await fetchPage(1);
        if (token !== state.token) return;

        els.grid.innerHTML = "";

        if (!data.success) {
            showMessage(data.message);
            return;
        }

        if (data.images.length === 0) {
            showMessage("Nothing turned up for that. Try a simpler word.");
            return;
        }

        state.total = data.total;
        appendImages(data.images);
        setHeroBackground(data.images);

        els.count.textContent = `${formatNumber(data.total)} pictures`;
        updateMoreButton();

    } catch (error) {
        if (token !== state.token) return;
        els.grid.innerHTML = "";
        showMessage("Something went wrong. Please try again.");
        console.error(error);
    }
}

async function loadMore() {
    const token = state.token;

    els.more.disabled = true;
    els.more.textContent = "Loading…";

    try {
        const data = await fetchPage(state.page + 1);
        if (token !== state.token) return;

        if (data.success) {
            state.page++;
            appendImages(data.images);
        } else {
            showMessage(data.message);
        }

    } catch (error) {
        console.error(error);
        showMessage("Unable to load more pictures.");

    } finally {
        els.more.disabled = false;
        els.more.textContent = "Show more pictures";
        updateMoreButton();
    }
}

function updateMoreButton() {
    const reachable = Math.min(state.total, PIXABAY_CAP);
    els.more.hidden = state.images.length >= reachable;
}

function setTitle(query) {
    els.title.textContent = "";
    els.title.append("Pictures of ");
    els.title.append(el("em", "", `“${query}”`));
}

// The first wide result becomes a dimmed backdrop behind the hero
function setHeroBackground(images) {
    const wide = images.find(i => i.width > i.height) || images[0];
    const url = wide && (wide.largeImageURL || wide.webformatURL);
    if (!isPixabayURL(url)) return;

    const probe = new Image();

    probe.onload = () => {
        els.heroBg.style.backgroundImage = `url("${encodeURI(url)}")`;
        els.heroBg.classList.add("is-ready");
    };

    probe.src = url;
}


// ───────── Rendering ─────────

function showSkeletons(n) {
    const ratios = [1.5, 0.75, 1, 1.33, 0.8, 1.2, 0.67, 1.4];

    for (let i = 0; i < n; i++) {
        const plate = el("figure", "plate skeleton");
        const frame = el("div", "plate-frame");
        frame.style.aspectRatio = String(ratios[i % ratios.length]);

        plate.append(frame);
        els.grid.append(plate);
    }
}

function appendImages(images) {
    const start = state.images.length;
    state.images.push(...images);

    images.forEach((image, i) => {
        els.grid.append(buildPlate(image, start + i, i));
    });
}

function buildPlate(image, index, order) {
    const plate = el("figure", "plate");
    plate.style.setProperty("--i", order);

    const frame = el("button", "plate-frame");
    frame.type = "button";
    frame.setAttribute("aria-label", `Open picture: ${headline(image.tags, 3)}`);

    if (image.width && image.height) {
        frame.style.aspectRatio = `${image.width} / ${image.height}`;
    }

    const img = el("img");
    img.src = image.webformatURL;
    img.alt = image.tags || "";
    img.loading = "lazy";
    frame.append(img);
    frame.addEventListener("click", () => openViewer(index));

    const overlay = el("div", "plate-overlay");

    const meta = el("div", "plate-meta");
    meta.append(
        el("span", "plate-by", image.user),
        el("span", "plate-tags", headline(image.tags, 3))
    );

    const dl = el("a", "plate-dl");
    dl.innerHTML = DOWNLOAD_ICON;
    dl.href = downloadURL(image);
    dl.title = "Download full size";
    dl.setAttribute("aria-label", "Download full size");

    overlay.append(meta, dl);
    plate.append(frame, overlay);

    return plate;
}


// ───────── Viewer ─────────

function openViewer(index) {
    state.viewerIndex = index;
    renderViewer();

    if (!els.viewer.open) els.viewer.showModal();
}

function stepViewer(delta) {
    const next = state.viewerIndex + delta;
    if (next < 0 || next >= state.images.length) return;

    state.viewerIndex = next;
    renderViewer();

    // quietly fetch the next page when the user reaches the end
    if (next >= state.images.length - 2 && !els.more.hidden && !els.more.disabled) {
        loadMore();
    }
}

function renderViewer() {
    const image = state.images[state.viewerIndex];
    if (!image) return;

    const viewerImage = $("viewerImage");
    viewerImage.src = image.largeImageURL || image.webformatURL;
    viewerImage.alt = image.tags || "";

    $("viewerIndex").textContent = `${state.viewerIndex + 1} of ${state.images.length}`;
    $("viewerTags").textContent = headline(image.tags);
    $("viewerUser").textContent = image.user;
    $("viewerSize").textContent =
        image.fullWidth ? `${formatNumber(image.fullWidth)} × ${formatNumber(image.fullHeight)}` : "—";
    $("viewerViews").textContent = formatNumber(image.views);
    $("viewerLikes").textContent = formatNumber(image.likes);
    $("viewerDownloads").textContent = formatNumber(image.downloads);

    $("viewerDownload").href = downloadURL(image);
    $("viewerSource").href = image.pageURL || "https://pixabay.com";

    $("viewerPrev").hidden = state.viewerIndex === 0;
    $("viewerNext").hidden = state.viewerIndex >= state.images.length - 1;
}


// ───────── Events ─────────

els.form.addEventListener("submit", event => {
    event.preventDefault();
    runSearch(els.input.value);
});

els.miniForm.addEventListener("submit", event => {
    event.preventDefault();
    runSearch(els.miniInput.value);
});

els.more.addEventListener("click", loadMore);

document.querySelectorAll(".try-link").forEach(button => {
    button.addEventListener("click", () => runSearch(button.textContent));
});

document.querySelectorAll(".seg").forEach(seg => {
    seg.addEventListener("click", () => {
        const filter = seg.dataset.filter;

        document
            .querySelectorAll(`.seg[data-filter="${filter}"]`)
            .forEach(s => s.classList.toggle("is-active", s === seg));

        state[filter] = seg.dataset.value;

        if (state.query) runSearch(state.query);
    });
});

$("viewerClose").addEventListener("click", () => els.viewer.close());
$("viewerPrev").addEventListener("click", () => stepViewer(-1));
$("viewerNext").addEventListener("click", () => stepViewer(1));

// click on the backdrop closes the viewer
els.viewer.addEventListener("click", event => {
    if (event.target === els.viewer) els.viewer.close();
});

document.addEventListener("keydown", event => {
    if (els.viewer.open) {
        if (event.key === "ArrowLeft") stepViewer(-1);
        if (event.key === "ArrowRight") stepViewer(1);
        return;
    }

    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);

    if (event.key === "/" && !typing) {
        event.preventDefault();
        window.scrollTo({ top: 0 });
        els.input.focus();
        els.input.select();
    }
});

// Top bar: border once the page scrolls, compact search once the hero search is out of view
window.addEventListener("scroll", () => {
    els.topbar.classList.toggle("is-scrolled", window.scrollY > 8);
}, { passive: true });

new IntersectionObserver(([entry]) => {
    const gone = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    els.topbar.classList.toggle("show-mini", gone);
}, { rootMargin: "-64px 0px 0px 0px" }).observe(els.form);


// ───────── Start ─────────

// A shared link (?q=fog) opens straight to that search; otherwise show a random starter
const sharedQuery = new URLSearchParams(location.search).get("q");

if (sharedQuery) {
    runSearch(sharedQuery);
} else {
    runSearch(STARTERS[Math.floor(Math.random() * STARTERS.length)]);
    history.replaceState(null, "", location.pathname);
    els.input.value = "";
    els.miniInput.value = "";
}
