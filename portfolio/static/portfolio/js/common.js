function getElement(selector) {
    return document.querySelector(selector);
}

function setText(selector, text) {
    const el = getElement(selector);
    if (el) el.textContent = text;
    return el;
}

function getCookie(name) {
    const cookieValue = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`));
    return cookieValue ? decodeURIComponent(cookieValue.split("=").slice(1).join("=")) : null;
}

async function apiRequest(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});

    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
        const csrfToken = getCookie("csrftoken");
        if (csrfToken) headers.set("X-CSRFToken", csrfToken);
    }

    const requestOptions = {
        credentials: "same-origin",
        ...options,
        method: method,
        headers: headers,
    };

    const response = await fetch(url, requestOptions);
    let data = null;

    try {
        data = await response.json();
    } catch (err) {
        data = null;
    }

    return {
        response: response,
        data: data,
        ok: response.ok,
        status: response.status,
    };
}

function show(selector) {
    const el = getElement(selector);
    if (el) el.style.display = "block";
}

function hide(selector) {
    const el = getElement(selector);
    if (el) el.style.display = "none";
}

function hide_all_views() {
    document.querySelectorAll("[id^='view-']").forEach((el) => {
        el.style.display = "none";
    });
}

function setActiveNav(selector) {
    document.querySelectorAll(".navbar .nav-link").forEach((link) => {
        link.classList.remove("is-active");
    });

    const activeLink = selector ? getElement(selector) : null;
    if (activeLink) activeLink.classList.add("is-active");
}
