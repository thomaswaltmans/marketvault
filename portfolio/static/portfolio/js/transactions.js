let editingTransactionId = null;
let activeTransactionAssetFilterId = "";
let transactionMenusBound = false;

function getTransactionTypePillClass(txnType) {
    return `transaction-pill-${String(txnType || "").toLowerCase()}`;
}

function getAssetTypePillClass(assetType) {
    return `asset-pill-${String(assetType || "STOCK").toLowerCase()}`;
}

function view_transactions() {
    hide_all_views();
    setActiveNav("#nav-transactions");
    show("#view-transactions");
    loadTransactionAssetFilter().then(() => loadTransactions());
}

async function view_transaction_form(mode, txn = null) {
    hide_all_views();
    setActiveNav("#nav-transactions");
    show("#view-transaction-form");

    const title = getElement("#transaction-form-title");
    const status = getElement("#transaction-form-status");
    if (status) status.textContent = "";

    if (mode === "new") {
        editingTransactionId = null;
        if (title) title.textContent = "New transaction";
        resetTransactionForm();
    } else {
        editingTransactionId = txn.id;
        if (title) title.textContent = `Edit transaction #${txn.id}`;
        fillTransactionForm(txn);
    }

    loadAssetsIntoSelect(txn ? txn.asset_id : null);
    updateTxnFieldVisibility();
}

function formatTxnQuantity(quantity) {
    const raw = String(quantity ?? "").trim();
    if (!raw) return "0";

    const isWholeWithTrailingZeros = /^-?\d+(?:\.0+)?$/.test(raw);
    if (isWholeWithTrailingZeros) {
        return String(parseInt(raw, 10));
    }

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return raw;
    return numeric.toFixed(4);
}

function formatEditableDecimal(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (!raw.includes(".")) return raw;
    return raw.replace(/0+$/, "").replace(/\.$/, "");
}

function currencySymbol(currencyCode) {
    const code = String(currencyCode || "").toUpperCase();
    if (code === "EUR") return "€";
    if (code === "USD") return "$";
    if (code === "GBP") return "£";
    return code ? `${code} ` : "";
}

function formatMoneyAmount(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "-";
    return value.toFixed(2);
}

async function loadTransactions() {
    setText("#transactions-status", "Loading...");

    const { ok, data } = await apiRequest("/transactions");
    if (!ok) {
        console.log(data);
        setText("#transactions-status", "Failed to load transactions. Check console.");
        return;
    }

    const list = getElement("#transactions-list");
    const txns = data.transactions || [];
    const filteredTxns = activeTransactionAssetFilterId
        ? txns.filter((txn) => String(txn.asset_id) === String(activeTransactionAssetFilterId))
        : txns;

    const statusText = activeTransactionAssetFilterId
        ? `${filteredTxns.length} of ${txns.length} transaction(s).`
        : `${txns.length} transaction(s).`;
    setText("#transactions-status", statusText);
    if (!list) return;

    if (filteredTxns.length === 0) {
        list.innerHTML = activeTransactionAssetFilterId
            ? "<div class='surface-card'>No transactions for selected asset.</div>"
            : "<div class='surface-card'>No transactions yet.</div>";
        return;
    }

    list.innerHTML = filteredTxns
        .map((t) => {
            const displayName = (t.asset_name || "").trim() || t.asset;
            const symbol = currencySymbol(t.asset_currency);
            const quantity = Number(t.quantity);
            const unitPrice = Number(t.unit_price);
            const total = quantity * unitPrice;
            const headlineAmount = t.txn_type === "DIV"
                ? `${symbol}${formatMoneyAmount(t.div_amount)}`
                : `${symbol}${formatMoneyAmount(total)}`;
            const rightDetails = t.txn_type === "DIV"
                ? ""
                : `${formatTxnQuantity(t.quantity)} @ ${formatMoneyAmount(unitPrice)}`;
            const dateOnly = t.timestamp ? t.timestamp.slice(0, 10) : "";
            const typeClass = `transaction-item-${String(t.txn_type || "").toLowerCase()}`;

            return `
        <div class="transaction-item ${typeClass}">
            <div class="transaction-item-head">
                <div class="transaction-item-meta">
                    <div class="transaction-item-title">
                        <strong style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${displayName}</strong>
                        <span class="transaction-pill ${getTransactionTypePillClass(t.txn_type)}">${t.txn_type}</span>
                        <span class="asset-pill ${getAssetTypePillClass(t.asset_type)}">${t.data_symbol}</span>
                    </div>
                    <div class="transaction-item-subtitle">
                        <span>${dateOnly}</span>
                        ${rightDetails ? `<span>${rightDetails}</span>` : ""}
                        <span>${headlineAmount}</span>
                    </div>
                </div>
                <div class="txn-actions">
                    <button
                        class="txn-menu-btn"
                        data-action="toggle-menu"
                        data-id="${t.id}"
                        title="More actions"
                        aria-label="More actions"
                        aria-haspopup="true"
                        aria-expanded="false"
                    >⋯</button>
                    <div class="txn-menu" data-menu-id="${t.id}">
                        <button class="txn-menu-item" data-action="edit" data-id="${t.id}">Edit</button>
                        <button class="txn-menu-item txn-menu-item-danger" data-action="delete" data-id="${t.id}">Delete</button>
                    </div>
                </div>
            </div>
        </div>
    `;
        })
        .join("");

    bindTransactionMenuDismiss();

    list.onclick = async (e) => {
        const button = e.target.closest("button");
        if (!button) return;

        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === "toggle-menu") {
            e.preventDefault();
            toggleTransactionMenu(id);
            return;
        }

        if (action === "delete") {
            await deleteTransaction(id);
            closeAllTransactionMenus();
        }

        if (action === "edit") {
            const txn = filteredTxns.find((x) => String(x.id) === String(id));
            if (txn) view_transaction_form("edit", txn);
            closeAllTransactionMenus();
        }
    };
}

function closeAllTransactionMenus() {
    document.querySelectorAll(".txn-menu.is-open").forEach((menu) => {
        menu.classList.remove("is-open");
    });
    document.querySelectorAll(".txn-menu-btn[aria-expanded='true']").forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
    });
}

function toggleTransactionMenu(transactionId) {
    const targetMenu = document.querySelector(`.txn-menu[data-menu-id='${transactionId}']`);
    const targetButton = document.querySelector(`.txn-menu-btn[data-id='${transactionId}']`);
    if (!targetMenu || !targetButton) return;

    const opening = !targetMenu.classList.contains("is-open");
    closeAllTransactionMenus();

    if (opening) {
        targetMenu.classList.add("is-open");
        targetButton.setAttribute("aria-expanded", "true");
    }
}

function bindTransactionMenuDismiss() {
    if (transactionMenusBound) return;
    document.addEventListener("click", (event) => {
        const insideMenuArea = event.target.closest(".txn-actions");
        if (insideMenuArea) return;
        closeAllTransactionMenus();
    });
    transactionMenusBound = true;
}

async function loadTransactionAssetFilter() {
    const filterSelect = getElement("#txn-filter-asset");
    if (!filterSelect) return;

    filterSelect.innerHTML = "<option value=''>Loading assets...</option>";

    const { ok, data } = await apiRequest("/assets");
    if (!ok) {
        filterSelect.innerHTML = "<option value=''>All assets</option>";
        activeTransactionAssetFilterId = "";
        return;
    }

    const assets = data.assets || [];
    const options = ["<option value=''>All assets</option>"];
    assets.forEach((asset) => {
        options.push(`<option value="${asset.id}">${asset.ticker} — ${asset.data_symbol}</option>`);
    });
    filterSelect.innerHTML = options.join("");

    const stillValid = assets.some((asset) => String(asset.id) === String(activeTransactionAssetFilterId));
    filterSelect.value = stillValid ? String(activeTransactionAssetFilterId) : "";
    activeTransactionAssetFilterId = filterSelect.value || "";

    filterSelect.onchange = () => {
        activeTransactionAssetFilterId = filterSelect.value || "";
        loadTransactions();
    };
}

async function loadAssetsIntoSelect(selectedAssetId = null) {
    const select = getElement("#txn-asset");
    const hint = getElement("#txn-asset-hint");
    if (!select) return;

    select.innerHTML = "<option value=''>Loading assets...</option>";

    const { ok, data } = await apiRequest("/assets");
    if (!ok) {
        console.log(data);
        select.innerHTML = "<option value=''>Failed to load assets</option>";
        return;
    }

    const assets = data.assets || [];
    if (assets.length === 0) {
        select.innerHTML = "<option value=''>No assets found (create one first)</option>";
        return;
    }

    select.innerHTML = assets
        .map((a) => {
            const label = `${a.ticker} — ${a.data_symbol}`;
            return `<option value="${a.id}">${label}</option>`;
        })
        .join("");

    if (selectedAssetId) {
        select.value = String(selectedAssetId);
    }

    select.onchange = () => {
        const id = select.value;
        const asset = assets.find((a) => String(a.id) === String(id));
        if (hint) hint.textContent = asset ? `Selected: ${asset.name || "(no name)"} | ${asset.exchange || ""}` : "";
    };

    const currentAsset = assets.find((a) => String(a.id) === String(select.value));
    if (hint) hint.textContent = currentAsset ? `Selected: ${currentAsset.name || "(no name)"} | ${currentAsset.exchange || ""}` : "";
}

function resetTransactionForm() {
    getElement("#txn-type").value = "BUY";
    getElement("#txn-quantity").value = "";
    getElement("#txn-unit-price").value = "";
    getElement("#txn-div-amount").value = "";
    const now = new Date();
    now.setSeconds(0, 0);
    getElement("#txn-timestamp").value = isoToDatetimeLocal(now.toISOString());
}

function fillTransactionForm(txn) {
    getElement("#txn-type").value = txn.txn_type;
    getElement("#txn-quantity").value = formatEditableDecimal(txn.quantity);
    getElement("#txn-unit-price").value = formatEditableDecimal(txn.unit_price);
    getElement("#txn-div-amount").value = formatEditableDecimal(txn.div_amount);
    getElement("#txn-timestamp").value = isoToDatetimeLocal(txn.timestamp);
}

function updateTxnFieldVisibility() {
    const txnType = getElement("#txn-type").value;
    const trade = getElement("#trade-fields");
    const div = getElement("#div-fields");

    if (txnType === "DIV") {
        if (trade) trade.style.display = "none";
        if (div) div.style.display = "block";
    } else {
        if (trade) trade.style.display = "block";
        if (div) div.style.display = "none";
    }
}

async function saveTransaction() {
    setText("#transaction-form-status", "Saving...");

    const payload = {
        txn_type: getElement("#txn-type").value,
        asset_id: getElement("#txn-asset").value,
        quantity: getElement("#txn-quantity").value.trim() || null,
        unit_price: getElement("#txn-unit-price").value.trim() || null,
        div_amount: getElement("#txn-div-amount").value.trim() || null,
        timestamp: datetimeLocalToIso(getElement("#txn-timestamp").value),
    };

    if (!payload.asset_id) {
        setText("#transaction-form-status", "Please select an asset.");
        return;
    }

    const isEdit = editingTransactionId !== null;
    const url = isEdit ? `/transactions/${editingTransactionId}` : "/transactions";
    const method = isEdit ? "PUT" : "POST";

    const { ok, data } = await apiRequest(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!ok) {
        console.log(data);
        setText("#transaction-form-status", "Failed. Check console.");
        return;
    }

    setText("#transaction-form-status", "Saved.");

    view_transactions();
    refreshDashboardCharts();
}

async function deleteTransaction(transactionId) {
    const sure = confirm("Delete this transaction? This cannot be undone.");
    if (!sure) return;

    const { ok, data } = await apiRequest(`/transactions/${transactionId}`, {
        method: "DELETE",
    });
    if (!ok) {
        alert(data.error || "Delete failed");
        return;
    }

    await loadTransactions();
    refreshDashboardCharts();
}

function datetimeLocalToIso(datetimeLocalValue) {
    if (!datetimeLocalValue) return null;
    const localDate = new Date(datetimeLocalValue);
    const pad = (n) => String(n).padStart(2, "0");

    const year = localDate.getFullYear();
    const month = pad(localDate.getMonth() + 1);
    const day = pad(localDate.getDate());
    const hours = pad(localDate.getHours());
    const minutes = pad(localDate.getMinutes());
    const seconds = pad(localDate.getSeconds());

    const offsetMinutes = -localDate.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const offsetAbs = Math.abs(offsetMinutes);
    const offsetH = pad(Math.floor(offsetAbs / 60));
    const offsetM = pad(offsetAbs % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetH}:${offsetM}`;
}

function isoToDatetimeLocal(isoString) {
    if (!isoString) return "";

    const date = new Date(isoString);
    const pad = (n) => String(n).padStart(2, "0");
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}
