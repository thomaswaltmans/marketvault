let editingTransactionId = null;

function view_transactions() {
    hide_all_views();
    setActiveNav("#nav-transactions");
    show("#view-transactions");
    loadTransactions();
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

function txnStyle(txnType) {
    if (txnType === "BUY") return "background:#eaffea; border:1px solid #bde5bd;";
    if (txnType === "SELL") return "background:#ffecec; border:1px solid #f2b8b8;";
    if (txnType === "DIV") return "background:#fff8db; border:1px solid #f0e1a0;";
    return "background:#f6f6f6; border:1px solid #ddd;";
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
    setText("#transactions-status", `${txns.length} transaction(s).`);
    if (!list) return;

    if (txns.length === 0) {
        list.innerHTML = "<p>No transactions yet.</p>";
        return;
    }

    list.innerHTML = txns
        .map((t) => {
            const details =
                t.txn_type === "DIV"
                    ? `Dividend: ${t.div_amount}`
                    : `Qty: ${Number(t.quantity).toFixed(4)} @ ${Number(t.unit_price).toFixed(2)}`;
            const dateOnly = t.timestamp ? t.timestamp.slice(0, 10) : "";

            return `
        <div style="padding:0.6rem; margin-bottom:0.5rem; border-radius:10px; ${txnStyle(t.txn_type)}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
                <div>
                    <div>
                        <strong>${t.txn_type}</strong> — <strong>${t.asset}</strong>
                    </div>
                    <div style="font-size:0.9rem; opacity:0.85;">
                        ${details} <span style="opacity:0.7;">|</span> ${dateOnly}
                    </div>
                </div>
                <div style="white-space:nowrap;">
                    <button data-action="edit" data-id="${t.id}">Edit</button>
                    <button data-action="delete" data-id="${t.id}">Delete</button>
                </div>
            </div>
        </div>
    `;
        })
        .join("");

    list.onclick = async (e) => {
        const button = e.target.closest("button");
        if (!button) return;

        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === "delete") {
            await deleteTransaction(id);
        }

        if (action === "edit") {
            const txn = txns.find((x) => String(x.id) === String(id));
            if (txn) view_transaction_form("edit", txn);
        }
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
    getElement("#txn-quantity").value = txn.quantity || "";
    getElement("#txn-unit-price").value = txn.unit_price || "";
    getElement("#txn-div-amount").value = txn.div_amount || "";
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
