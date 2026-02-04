function getElement(selector) {
    return document.querySelector(selector);
}

function setText(selector, text) {
    const el = getElement(selector);
    if (el) el.textContent = text;
    return el;
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, options);
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
