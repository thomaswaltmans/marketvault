document.addEventListener('DOMContentLoaded', function () {

    document.querySelector('#nav-dashboard').addEventListener('click', (e) => { e.preventDefault(); view_dashboard(); });
    
    document.querySelector('#nav-assets').addEventListener('click', (e) => { e.preventDefault(); view_assets(); });
    document.querySelector("#btn-asset-refresh")?.addEventListener("click", () => loadAssets());
    document.querySelector("#btn-asset-search")?.addEventListener("click", () => {
        const q = document.querySelector("#asset-search").value.trim();
        loadAssets(q);
    });
    document.querySelector("#btn-asset-create")?.addEventListener("click", createAsset);
    document.querySelector("#assets-list")?.addEventListener("click", async (e) => {
        const button = e.target.closest("button");
        if (!button) return;
        const action = button.dataset.action;
        const assetId = button.dataset.id;
        if (action === "delete") {
        await deleteAsset(assetId);
        }
        if (action === "edit") {
        showEditForm(assetId);
        }
        if (action === "save-edit") {
        await saveAssetEdit(assetId);
        }
        if (action === "cancel-edit") {
        hideEditForm(assetId);
        }
    });

    document.querySelector('#nav-transactions').addEventListener('click', (e) => { e.preventDefault(); view_transactions(); });
    document.querySelector("#btn-new-transaction")?.addEventListener("click", () => {
        view_transaction_form("new");
    });
    document.querySelector("#btn-refresh-transactions")?.addEventListener("click", loadTransactions);
    document.querySelector("#btn-cancel-transaction")?.addEventListener("click", () => {
        view_transactions();
    });
    document.querySelector("#btn-save-transaction")?.addEventListener("click", saveTransaction);
    document.querySelector("#txn-type")?.addEventListener("change", () => {
        updateTxnFieldVisibility();
    });

    document.querySelector('#nav-import').addEventListener('click', (e) => { e.preventDefault(); view_import(); });
    const importButton = document.querySelector("#btn-import");
    if (importButton) {
    importButton.addEventListener("click", () => {
        const file = document.querySelector("#xlsx").files[0];
        if (!file) {
        alert("Pick an .xlsx file first");
        return;
        }
        uploadXlsx(file);
    });
    }

    view_dashboard();
});

function show(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'block';
}

function hide(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'none';
}

function hide_all_views() {
    hide('#view-dashboard');
    hide('#view-assets');
    hide('#view-transactions');
    hide('#view-transaction-form');
    hide('#view-import');
}

// DASHBOARD

function view_dashboard() {
    hide_all_views();
    show('#view-dashboard');

    requestAnimationFrame(() => {
    loadGrowthChartWithRetry();
    loadAllocationChart();
    });
}
  

async function loadGrowthChartWithRetry(attempt = 1) {
    try {
    const response = await fetch("/analytics/growth");
    const data = await response.json();

    // Heuristic: if we got almost no data, retry
    const dates = data.dates || [];
    const values = data.portfolio_value || [];

    if (dates.length < 10 && attempt < 5) {
        console.log(`Growth data too short, retrying (${attempt})...`);
        setTimeout(() => loadGrowthChartWithRetry(attempt + 1), 800 * attempt);
        return;
    }

    renderGrowthChart(data);
    } catch (err) {
    console.log(err);
    if (attempt < 5) {
        setTimeout(() => loadGrowthChartWithRetry(attempt + 1), 800 * attempt);
    }
    }
}

function renderGrowthChart(data) {
    const traces = [
        {
        x: data.dates,
        y: data.portfolio_value,
        type: "scatter",
        mode: "lines",
        name: "Portfolio Value",
        line: {
            color: "#1f77b4",
            width: 1.5,
        }
        },
        {
        x: data.dates,
        y: data.invested,
        type: "scatter",
        mode: "lines",
        name: "Invested",
        line: {
            color: "skyblue",
            width: 1.5,
        }
        }
    ];

    const dates = data.dates || [];
    if (dates.length === 0) return;

    const lastDate = new Date(dates[dates.length - 1]);
    const start3y = new Date(lastDate);
    start3y.setFullYear(start3y.getFullYear() - 3);

    
    const layout = {
        title: "Portfolio Value Over Time",
        xaxis: {
        title: "Date",
        range: [
            start3y.toISOString().slice(0, 10),
            lastDate.toISOString().slice(0, 10)
        ],
        rangeselector: {
            buttons: [
            { count: 1, label: "1m", step: "month", stepmode: "backward" },
            { count: 6, label: "6m", step: "month", stepmode: "backward" },
            { count: 1, label: "1y", step: "year", stepmode: "backward" },
            { count: 3, label: "3y", step: "year", stepmode: "backward" },
            { count: 5, label: "5y", step: "year", stepmode: "backward" },
            { step: "all", label: "ALL" }
            ]
        },
        rangeslider: { visible: false }
        },
        yaxis: { title: "Value" },
        legend: {
            orientation: "v",
            x: 0,
            y: 1,
            xanchor: "left",
            yanchor: "top",
        },
        margin: { t: 50, l: 50, r: 20, b: 50 },
    };
      

    Plotly.react("chart-growth", traces, layout, { responsive: true })
    .then(() => Plotly.Plots.resize("chart-growth"));

}


async function loadAllocationChart() {
    const response = await fetch("/analytics/allocation");
    if (!response.ok) {
    console.log(await response.json());
    return;
    }

    const data = await response.json();

    const labels = data.labels || [];
    const values = data.values || [];

    if (labels.length === 0) {
    const div = document.getElementById("chart-allocation");
    if (div) div.innerHTML = "<p>No holdings yet.</p>";
    return;
    }

    const trace = {
        type: "pie",
        labels: labels,
        values: values,
        hole: 0.6,
        textinfo: "label",
        textposition: "outside",
        hoverinfo: "label+percent+value"
    };

    const layout = {
    title: "Current Allocation",
    margin: { t: 50, l: 20, r: 20, b: 20 }
    };

    Plotly.react("chart-allocation", [trace], layout, { responsive: true })
    .then(() => Plotly.Plots.resize("chart-allocation"));
}

// ASSETS

function view_assets() {
    hide_all_views();
    show('#view-assets');
    loadAssets();
}

function view_assets() {
    hide_all_views();
    show('#view-assets');
    loadAssets();
}

async function loadAssets(query = "") {
    const url = query ? `/assets?q=${encodeURIComponent(query)}` : "/assets";
    const response = await fetch(url);
    const data = await response.json();

    const list = document.querySelector("#assets-list");
    if (!list) return;

    const assets = data.assets || [];

    if (assets.length === 0) {
    list.innerHTML = "<p>No assets found.</p>";
    return;
    }

    list.innerHTML = assets.map(asset => {
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
    }).join("");
    
}

async function createAsset() {
    const status = document.querySelector("#asset-create-status");
    if (status) status.textContent = "Creating...";

    const ticker = document.querySelector("#asset-ticker").value.trim();
    const name = document.querySelector("#asset-name").value.trim();
    const exchange = document.querySelector("#asset-exchange").value.trim();
    const currency = document.querySelector("#asset-currency").value.trim();
    const dataSymbol = document.querySelector("#asset-data-symbol").value.trim();

    const response = await fetch("/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        ticker: ticker,
        name: name,
        exchange: exchange,
        currency: currency,
        data_symbol: dataSymbol
    })
    });

    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    if (status) status.textContent = "Failed. Check console.";
    return;
    }

    if (status) status.textContent = `Created ${data.ticker} (${data.data_symbol})`;

    // clear minimal fields
    document.querySelector("#asset-ticker").value = "";
    document.querySelector("#asset-data-symbol").value = "";

    loadAssets();
}

async function showEditForm(assetId) {
    const response = await fetch(`/assets/${assetId}`);
    const asset = await response.json();

    const container = document.querySelector(`#asset-edit-${assetId}`);
    if (!container) return;

    container.style.display = "block";
    container.innerHTML = `
    <div style="margin-top: 0.5rem;">
        <input id="edit-ticker-${assetId}" value="${asset.ticker || ""}" placeholder="Ticker">
        <input id="edit-name-${assetId}" value="${asset.name || ""}" placeholder="Name">
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
    const container = document.querySelector(`#asset-edit-${assetId}`);
    if (!container) return;

    container.style.display = "none";
    container.innerHTML = "";
}

async function saveAssetEdit(assetId) {
    const status = document.querySelector(`#edit-status-${assetId}`);
    if (status) status.textContent = "Saving...";

    const payload = {
    ticker: document.querySelector(`#edit-ticker-${assetId}`).value.trim(),
    name: document.querySelector(`#edit-name-${assetId}`).value.trim(),
    exchange: document.querySelector(`#edit-exchange-${assetId}`).value.trim(),
    currency: document.querySelector(`#edit-currency-${assetId}`).value.trim(),
    data_symbol: document.querySelector(`#edit-data-symbol-${assetId}`).value.trim(),
    };

    const response = await fetch(`/assets/${assetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    if (status) status.textContent = "Failed. Check console.";
    return;
    }

    if (status) status.textContent = "Saved.";
    hideEditForm(assetId);
    loadAssets();  // refresh list
}

async function deleteAsset(assetId) {
    const sure = confirm("Delete this asset? This cannot be undone.");
    if (!sure) return;

    const response = await fetch(`/assets/${assetId}`, {
    method: "DELETE"
    });

    const data = await response.json();

    if (!response.ok) {
    alert(data.error || "Delete failed");
    return;
    }

    loadAssets();
}


// TRANSACTIONS

let editingTransactionId = null;

function view_transactions() {
    hide_all_views();
    show('#view-transactions');
    loadTransactions();
}

async function view_transaction_form(mode, txn = null) {
    hide_all_views();
    show('#view-transaction-form');

    const title = document.querySelector("#transaction-form-title");
    const status = document.querySelector("#transaction-form-status");
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
    if (txnType === "BUY") return "background:#eaffea; border:1px solid #bde5bd;";      // light green
    if (txnType === "SELL") return "background:#ffecec; border:1px solid #f2b8b8;";    // light red
    if (txnType === "DIV") return "background:#fff8db; border:1px solid #f0e1a0;";     // light yellow
    return "background:#f6f6f6; border:1px solid #ddd;";
}
  

async function loadTransactions() {
    const status = document.querySelector("#transactions-status");
    if (status) status.textContent = "Loading...";

    const response = await fetch("/transactions");
    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    if (status) status.textContent = "Failed to load transactions. Check console.";
    return;
    }

    const list = document.querySelector("#transactions-list");
    const txns = data.transactions || [];

    if (status) status.textContent = `${txns.length} transaction(s).`;

    if (!list) return;

    if (txns.length === 0) {
    list.innerHTML = "<p>No transactions yet.</p>";
    return;
    }

    list.innerHTML = txns.map(t => {
    const details = t.txn_type === "DIV"
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
    }).join("");

    // Attach handlers (event delegation)
    list.onclick = async (e) => {
    const button = e.target.closest("button");
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "delete") {
        await deleteTransaction(id);
    }

    if (action === "edit") {
        const txn = txns.find(x => String(x.id) === String(id));
        if (txn) view_transaction_form("edit", txn);
    }
    };
}

async function loadAssetsIntoSelect(selectedAssetId = null) {
    const select = document.querySelector("#txn-asset");
    const hint = document.querySelector("#txn-asset-hint");
    if (!select) return;

    select.innerHTML = "<option value=''>Loading assets...</option>";

    const response = await fetch("/assets");
    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    select.innerHTML = "<option value=''>Failed to load assets</option>";
    return;
    }

    const assets = data.assets || [];

    if (assets.length === 0) {
    select.innerHTML = "<option value=''>No assets found (create one first)</option>";
    return;
    }

    select.innerHTML = assets.map(a => {
    const label = `${a.ticker} — ${a.data_symbol}`;
    return `<option value="${a.id}">${label}</option>`;
    }).join("");

    if (selectedAssetId) {
    select.value = String(selectedAssetId);
    }

    select.addEventListener("change", () => {
    const id = select.value;
    const asset = assets.find(a => String(a.id) === String(id));
    if (hint) hint.textContent = asset ? `Selected: ${asset.name || "(no name)"} | ${asset.exchange || ""}` : "";
    });

    // trigger hint once
    const currentAsset = assets.find(a => String(a.id) === String(select.value));
    if (hint) hint.textContent = currentAsset ? `Selected: ${currentAsset.name || "(no name)"} | ${currentAsset.exchange || ""}` : "";
}

function resetTransactionForm() {
    document.querySelector("#txn-type").value = "BUY";
    document.querySelector("#txn-quantity").value = "";
    document.querySelector("#txn-unit-price").value = "";
    document.querySelector("#txn-div-amount").value = "";
    const now = new Date();
    now.setSeconds(0, 0);
    document.querySelector("#txn-timestamp").value = isoToDatetimeLocal(now.toISOString());
}

function fillTransactionForm(txn) {
    document.querySelector("#txn-type").value = txn.txn_type;
    document.querySelector("#txn-quantity").value = txn.quantity || "";
    document.querySelector("#txn-unit-price").value = txn.unit_price || "";
    document.querySelector("#txn-div-amount").value = txn.div_amount || "";
    document.querySelector("#txn-timestamp").value = isoToDatetimeLocal(txn.timestamp);
}

function updateTxnFieldVisibility() {
    const txnType = document.querySelector("#txn-type").value;

    const trade = document.querySelector("#trade-fields");
    const div = document.querySelector("#div-fields");

    if (txnType === "DIV") {
    if (trade) trade.style.display = "none";
    if (div) div.style.display = "block";
    } else {
    if (trade) trade.style.display = "block";
    if (div) div.style.display = "none";
    }
}

async function saveTransaction() {
    const status = document.querySelector("#transaction-form-status");
    if (status) status.textContent = "Saving...";

    const payload = {
    txn_type: document.querySelector("#txn-type").value,
    asset_id: document.querySelector("#txn-asset").value,
    quantity: document.querySelector("#txn-quantity").value.trim() || null,
    unit_price: document.querySelector("#txn-unit-price").value.trim() || null,
    div_amount: document.querySelector("#txn-div-amount").value.trim() || null,
    timestamp: datetimeLocalToIso(document.querySelector("#txn-timestamp").value),
    };

    if (!payload.asset_id) {
    if (status) status.textContent = "Please select an asset.";
    return;
    }

    const isEdit = editingTransactionId !== null;

    const url = isEdit ? `/transactions/${editingTransactionId}` : "/transactions";
    const method = isEdit ? "PUT" : "POST";

    const response = await fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    if (status) status.textContent = "Failed. Check console.";
    return;
    }

    if (status) status.textContent = "Saved.";

    // Go back to list, refresh charts
    view_transactions();
    loadGrowthChart();
    loadAllocationChart();
}
  
async function deleteTransaction(transactionId) {
    const sure = confirm("Delete this transaction? This cannot be undone.");
    if (!sure) return;

    const response = await fetch(`/transactions/${transactionId}`, {
    method: "DELETE"
    });

    const data = await response.json();

    if (!response.ok) {
    alert(data.error || "Delete failed");
    return;
    }

    await loadTransactions();
    loadGrowthChart();
    loadAllocationChart();
}

function datetimeLocalToIso(datetimeLocalValue) {
    // datetimeLocalValue looks like: "2026-01-28T12:30"
    if (!datetimeLocalValue) return null;

    // Create a Date in LOCAL time
    const localDate = new Date(datetimeLocalValue);

    // Convert to ISO with timezone offset (e.g. 2026-01-28T12:30:00+01:00)
    const pad = (n) => String(n).padStart(2, "0");

    const year = localDate.getFullYear();
    const month = pad(localDate.getMonth() + 1);
    const day = pad(localDate.getDate());
    const hours = pad(localDate.getHours());
    const minutes = pad(localDate.getMinutes());
    const seconds = pad(localDate.getSeconds());

    const offsetMinutes = -localDate.getTimezoneOffset(); // e.g. +60 for CET
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


// IMPORTS

function view_import() {
    hide_all_views();
    show('#view-import');
}

async function uploadXlsx(file) {
    const statusDiv = document.querySelector("#import-status");
    if (statusDiv) statusDiv.textContent = "Importing...";

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/import", {
    method: "POST",
    body: formData
    });

    const data = await response.json();

    if (!response.ok) {
    console.log(data);
    if (statusDiv) statusDiv.textContent = "Import failed. Check console.";
    alert("Import failed");
    return;
    }

    if (statusDiv) {
    statusDiv.textContent = `Imported ${data.created_transactions} transactions. Created ${data.created_assets} new assets.`;
    }

    // Refresh dashboard charts
    loadGrowthChart();
    loadAllocationChart();

    // Optional: switch back to dashboard after import
    view_dashboard();
}
