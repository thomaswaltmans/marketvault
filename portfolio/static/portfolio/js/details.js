function view_details() {
    navigate("#view-details", "#nav-details", loadDetails);
}

async function loadDetails() {
    const container = getElement("#details-table-container");
    if (!container) return;
    container.innerHTML = '<p class="details-empty">Loading…</p>';

    const { ok, data } = await apiRequest("/analytics/details");
    if (!ok || !data) {
        container.innerHTML = '<p class="details-empty">No data available.</p>';
        return;
    }
    renderDetailsTable(data);
}

function renderDetailsTable(data) {
    const container = getElement("#details-table-container");
    if (!container) return;

    if (!data.groups || data.groups.length === 0) {
        container.innerHTML = '<p class="details-empty">No open positions.</p>';
        return;
    }

    const fmtEur = (v) => v != null ? `€\u00a0${v.toFixed(2)}` : '—';
    const fmtPct = (v) => v != null ? `${v.toFixed(2)}%` : '—';
    const fmtQty = (v) => {
        if (v == null) return '—';
        return Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(6)).toString();
    };
    const colorCls = (v) => v == null ? '' : v >= 0 ? 'dt-pos' : 'dt-neg';

    const typeLabel = { ETF: 'ETFs', STOCK: 'Stocks', ETC: 'ETCs', CRYPTO: 'Crypto' };
    const colCount = 15;

    let html = '<div class="details-scroll"><table class="details-table"><thead><tr>'
        + '<th>Name</th><th class="dt-hide-mobile">Ticker</th>'
        + '<th class="dt-hide-mobile">Market</th><th class="dt-r">#</th>'
        + '<th class="dt-r">Price</th><th class="dt-r">Value</th><th class="dt-r">% Portfolio</th>'
        + '<th class="dt-r">Day P/L</th><th class="dt-r">Day P/L (%)</th><th class="dt-r">YTD (%)</th>'
        + '<th class="dt-r">Bought</th><th class="dt-r">Sold</th><th class="dt-r">Dividends</th>'
        + '<th class="dt-r">Total P/L</th><th class="dt-r">Total P/L (%)</th>'
        + '</tr></thead><tbody>';

    for (const group of data.groups) {
        const label = typeLabel[group.asset_type] || group.asset_type;
        html += `<tr class="dt-group"><td colspan="${colCount}">${label}</td></tr>`;

        for (const r of group.rows) {
            html += `<tr class="dt-row">
                <td class="dt-name">${r.name || '—'}</td>
                <td class="dt-hide-mobile">${r.ticker || '—'}</td>
                <td class="dt-muted dt-hide-mobile">${r.exchange || '—'}</td>
                <td class="dt-r">${fmtQty(r.quantity)}</td>
                <td class="dt-r">${fmtEur(r.current_price)}</td>
                <td class="dt-r">${fmtEur(r.market_value)}</td>
                <td class="dt-r">${fmtPct(r.pct_portfolio)}</td>
                <td class="dt-r ${colorCls(r.day_change)}">${fmtEur(r.day_change)}</td>
                <td class="dt-r ${colorCls(r.day_change_pct)}">${fmtPct(r.day_change_pct)}</td>
                <td class="dt-r ${colorCls(r.ytd_pct)}">${fmtPct(r.ytd_pct)}</td>
                <td class="dt-r">${fmtEur(r.total_bought)}</td>
                <td class="dt-r">${fmtEur(r.total_sold)}</td>
                <td class="dt-r">${fmtEur(r.total_dividends)}</td>
                <td class="dt-r ${colorCls(r.total_pl)}">${fmtEur(r.total_pl)}</td>
                <td class="dt-r ${colorCls(r.total_pl_pct)}">${fmtPct(r.total_pl_pct)}</td>
            </tr>`;
        }
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}
