const ASSET_TYPES = ["ETF", "STOCK", "ETC", "CRYPTO"];

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
        list.innerHTML = "<p>No assets found.</p>";
        return;
    }

    list.innerHTML = assets
        .map((asset) => {
            return `
        <div style="padding:0.6rem; margin-bottom:0.5rem; border-radius:10px; border:1px solid #ddd; background:#fafafa;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                <div>
                    <div>
                        <strong>${asset.name || "(no name)"}</strong>
                        <small style="opacity:0.75;">(${asset.data_symbol})</small>
                    </div>
                    <div style="font-size:0.9rem; opacity:0.85;">
                        ${asset.ticker}
                        ${asset.asset_type ? " | " + asset.asset_type : ""}
                        ${asset.exchange ? " | " + asset.exchange : ""}
                        ${asset.currency ? " | " + asset.currency : ""}
                    </div>
                </div>
                <div style="white-space:nowrap; display:flex; gap:6px;">
                    <button class="btn-edit" data-action="edit" data-id="${asset.id}">Edit</button>
                    <button class="btn-delete" data-action="delete" data-id="${asset.id}">Delete</button>
                </div>
            </div>
            <div id="asset-edit-${asset.id}" style="display:none; margin-top:0.5rem;"></div>
        </div>
        `;
        })
        .join("");
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
    <div style="margin-top: 0.5rem;">
        <input id="edit-ticker-${assetId}" value="${asset.ticker || ""}" placeholder="Ticker">
        <input id="edit-name-${assetId}" value="${asset.name || ""}" placeholder="Name">
        <select id="edit-asset-type-${assetId}">
            ${buildAssetTypeOptions(asset.asset_type || "STOCK")}
        </select>
        <input id="edit-exchange-${assetId}" value="${asset.exchange || ""}" placeholder="Exchange">
        <input id="edit-currency-${assetId}" value="${asset.currency || ""}" placeholder="Currency">
        <input id="edit-data-symbol-${assetId}" value="${asset.data_symbol || ""}" placeholder="Data symbol">
        <button data-action="save-edit" data-id="${assetId}">Save</button>
        <button data-action="cancel-edit" data-id="${assetId}">Cancel</button>
        <div id="edit-status-${assetId}" style="margin-top:0.3rem;"></div>
    </div>
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

    loadAssets();
}
