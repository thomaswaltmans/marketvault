const ASSET_TYPES = ["ETF", "STOCK", "ETC", "CRYPTO"];
let assetMenusBound = false;

function getAssetTypePillClass(assetType) {
    return `asset-pill-${String(assetType || "STOCK").toLowerCase()}`;
}

function buildAssetTypeOptions(selectedType = "STOCK") {
    return ASSET_TYPES.map((type) => {
        const selected = type === selectedType ? "selected" : "";
        return `<option value="${type}" ${selected}>${type}</option>`;
    }).join("");
}

function view_assets() {
    hide_all_views();
    setActiveNav("#nav-assets");
    show("#view-assets");
    const createPanel = getElement("#asset-create-panel");
    const toggleButton = getElement("#btn-toggle-asset-create");
    if (createPanel) createPanel.style.display = "none";
    if (toggleButton) toggleButton.textContent = "Create asset";
    loadAssets();
}

function toggleAssetCreatePanel() {
    const panel = getElement("#asset-create-panel");
    const button = getElement("#btn-toggle-asset-create");
    if (!panel || !button) return;

    const isOpen = panel.style.display !== "none";
    panel.style.display = isOpen ? "none" : "block";
    button.textContent = isOpen ? "Create asset" : "Hide create asset";
}

async function loadAssets(query = "") {
    const url = query ? `/assets?q=${encodeURIComponent(query)}` : "/assets";
    const { data } = await apiRequest(url);
    if (!data) return;

    const list = getElement("#assets-list");
    if (!list) return;

    const assets = data.assets || [];
    if (assets.length === 0) {
        list.innerHTML = "<div class='surface-card'>No assets found.</div>";
        return;
    }

    list.innerHTML = assets
        .map((asset) => {
            const details = [
                asset.ticker,
                asset.asset_type,
                asset.exchange,
                asset.currency,
            ].filter(Boolean);
            return `
        <div class="asset-item">
            <div class="asset-item-head">
                <div class="asset-item-meta">
                    <div class="asset-item-title">
                        <strong>${asset.name || "(no name)"}</strong>
                        <span class="asset-pill ${getAssetTypePillClass(asset.asset_type)}">${asset.data_symbol}</span>
                    </div>
                    <div class="asset-item-subtitle">
                        ${details.map((detail) => `<span>${detail}</span>`).join("")}
                    </div>
                </div>
                <div class="asset-actions">
                    <button
                        class="asset-menu-btn"
                        data-action="toggle-menu"
                        data-id="${asset.id}"
                        title="More actions"
                        aria-label="More actions"
                        aria-haspopup="true"
                        aria-expanded="false"
                    >⋯</button>
                    <div class="asset-menu" data-menu-id="${asset.id}">
                        <button class="asset-menu-item" data-action="edit" data-id="${asset.id}">Edit</button>
                        <button class="asset-menu-item asset-menu-item-danger" data-action="delete" data-id="${asset.id}">Delete</button>
                    </div>
                </div>
            </div>
            <div id="asset-edit-${asset.id}" class="asset-edit-panel" style="display:none;"></div>
        </div>
        `;
        })
        .join("");

    bindAssetMenuDismiss();
}

function closeAllAssetMenus() {
    document.querySelectorAll(".asset-menu.is-open").forEach((menu) => {
        menu.classList.remove("is-open");
    });
    document.querySelectorAll(".asset-menu-btn[aria-expanded='true']").forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
    });
}

function toggleAssetMenu(assetId) {
    const targetMenu = document.querySelector(`.asset-menu[data-menu-id='${assetId}']`);
    const targetButton = document.querySelector(`.asset-menu-btn[data-id='${assetId}']`);
    if (!targetMenu || !targetButton) return;

    const opening = !targetMenu.classList.contains("is-open");
    closeAllAssetMenus();

    if (opening) {
        targetMenu.classList.add("is-open");
        targetButton.setAttribute("aria-expanded", "true");
    }
}

function bindAssetMenuDismiss() {
    if (assetMenusBound) return;
    document.addEventListener("click", (event) => {
        const insideMenuArea = event.target.closest(".asset-actions");
        if (insideMenuArea) return;
        closeAllAssetMenus();
    });
    assetMenusBound = true;
}

async function createAsset() {
    setText("#asset-create-status", "Creating...");

    const ticker = getElement("#asset-ticker").value.trim();
    const name = getElement("#asset-name").value.trim();
    const assetType = getElement("#asset-type").value;
    const exchange = getElement("#asset-exchange").value.trim();
    const currency = getElement("#asset-currency").value.trim();
    const dataSymbol = getElement("#asset-data-symbol").value.trim();

    const { ok, data } = await apiRequest("/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ticker: ticker,
            name: name,
            asset_type: assetType,
            exchange: exchange,
            currency: currency,
            data_symbol: dataSymbol,
        }),
    });
    if (!ok) {
        console.log(data);
        setText("#asset-create-status", "Failed. Check console.");
        return;
    }

    setText("#asset-create-status", `Created ${data.ticker} (${data.data_symbol})`);

    getElement("#asset-ticker").value = "";
    getElement("#asset-type").value = "STOCK";
    getElement("#asset-data-symbol").value = "";

    loadAssets();
}

async function showEditForm(assetId) {
    const { data: asset } = await apiRequest(`/assets/${assetId}`);
    if (!asset) return;

    const container = getElement(`#asset-edit-${assetId}`);
    if (!container) return;

    container.style.display = "block";
    container.innerHTML = `
    <div class="form-grid form-grid-3">
        <div class="form-field">
            <label>Ticker</label>
            <input id="edit-ticker-${assetId}" value="${asset.ticker || ""}" placeholder="Ticker">
        </div>
        <div class="form-field">
            <label>Name</label>
            <input id="edit-name-${assetId}" value="${asset.name || ""}" placeholder="Name">
        </div>
        <div class="form-field">
            <label>Type</label>
            <select id="edit-asset-type-${assetId}">
                ${buildAssetTypeOptions(asset.asset_type || "STOCK")}
            </select>
        </div>
        <div class="form-field">
            <label>Exchange</label>
            <input id="edit-exchange-${assetId}" value="${asset.exchange || ""}" placeholder="Exchange">
        </div>
        <div class="form-field">
            <label>Currency</label>
            <input id="edit-currency-${assetId}" value="${asset.currency || ""}" placeholder="Currency">
        </div>
        <div class="form-field">
            <label>Data symbol</label>
            <input id="edit-data-symbol-${assetId}" value="${asset.data_symbol || ""}" placeholder="Data symbol">
        </div>
    </div>
    <div class="panel-actions">
        <button data-action="save-edit" data-id="${assetId}">Save</button>
        <button data-action="cancel-edit" data-id="${assetId}">Cancel</button>
    </div>
    <div id="edit-status-${assetId}" class="form-status"></div>
    `;
}

function hideEditForm(assetId) {
    const container = getElement(`#asset-edit-${assetId}`);
    if (!container) return;

    container.style.display = "none";
    container.innerHTML = "";
}

async function saveAssetEdit(assetId) {
    setText(`#edit-status-${assetId}`, "Saving...");

    const payload = {
        ticker: getElement(`#edit-ticker-${assetId}`).value.trim(),
        name: getElement(`#edit-name-${assetId}`).value.trim(),
        asset_type: getElement(`#edit-asset-type-${assetId}`).value,
        exchange: getElement(`#edit-exchange-${assetId}`).value.trim(),
        currency: getElement(`#edit-currency-${assetId}`).value.trim(),
        data_symbol: getElement(`#edit-data-symbol-${assetId}`).value.trim(),
    };

    const { ok, data } = await apiRequest(`/assets/${assetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!ok) {
        console.log(data);
        setText(`#edit-status-${assetId}`, "Failed. Check console.");
        return;
    }

    setText(`#edit-status-${assetId}`, "Saved.");
    closeAllAssetMenus();
    hideEditForm(assetId);
    loadAssets();
}

async function deleteAsset(assetId) {
    const sure = confirm("Delete this asset? This cannot be undone.");
    if (!sure) return;

    const { ok, data } = await apiRequest(`/assets/${assetId}`, {
        method: "DELETE",
    });
    if (!ok) {
        alert(data.error || "Delete failed");
        return;
    }

    closeAllAssetMenus();
    loadAssets();
}
