let activeAllocationLoadToken = 0;
let allocationViewMode = "assets";
let allocationRawData = null;
let allocationToggleInitialized = false;
let assetGrowthData = null;

const ALLOCATION_TYPE_ORDER = ["ETF", "STOCK", "ETC", "CRYPTO"];
const ALLOCATION_TYPE_COLORS = {
    ETF: "hsl(0, 54%, 46%)",
    STOCK: "hsl(90, 54%, 54%)",
    ETC: "hsl(180, 54%, 46%)",
    CRYPTO: "hsl(270, 54%, 54%)",
};

function getPlotlyConfig() {
    return {
        responsive: true,
        displayModeBar: !window.matchMedia("(max-width: 900px)").matches,
        displaylogo: false,
    };
}

function view_dashboard() {
    hide_all_views();
    setActiveNav("#nav-dashboard");
    show("#view-dashboard");
    initializeAllocationToggle();

    requestAnimationFrame(() => {
        loadGrowthChartWithRetry();
        loadAllocationChartWithRetry();
        loadAssetGrowthChartWithRetry();
    });
}

function refreshDashboardCharts() {
    loadGrowthChartWithRetry();
    loadAllocationChartWithRetry();
    loadAssetGrowthChartWithRetry();
}

async function loadGrowthChartWithRetry(attempt = 1) {
    try {
        const { data } = await apiRequest("/analytics/growth");
        if (!data) return;

        const dates = data.dates || [];
        if (dates.length < 10 && attempt < 5) {
            console.log(`Growth data too short, retrying (${attempt})...`);
            setTimeout(() => loadGrowthChartWithRetry(attempt + 1), 800 * attempt);
            return;
        }

        updateOverviewMetrics(data);
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
            name: "Portfolio",
            line: {
                color: "#1f77b4",
                width: 1.5,
            },
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
            },
        },
    ];

    const dates = data.dates || [];
    if (dates.length === 0) return;

    const lastDate = new Date(dates[dates.length - 1]);
    const start3y = new Date(lastDate);
    start3y.setFullYear(start3y.getFullYear() - 3);

    const layout = {
        xaxis: {
            title: "Date",
            range: [start3y.toISOString().slice(0, 10), lastDate.toISOString().slice(0, 10)],
            rangeselector: {
                buttons: [
                    { count: 1, label: "1m", step: "month", stepmode: "backward" },
                    { count: 6, label: "6m", step: "month", stepmode: "backward" },
                    { count: 1, label: "1y", step: "year", stepmode: "backward" },
                    { count: 3, label: "3y", step: "year", stepmode: "backward" },
                    { count: 5, label: "5y", step: "year", stepmode: "backward" },
                    { step: "all", label: "ALL" },
                ],
            },
            rangeslider: { visible: false },
        },
        yaxis: { title: "Value" },
        legend: {
            orientation: "v",
            x: 0,
            y: 1,
            xanchor: "left",
            yanchor: "top",
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 40, l: 50, r: 20, b: 40 },
        font: { family: "system-ui, -apple-system, Segoe UI, Roboto, Arial", size: 12 },
    };

    Plotly.react("chart-growth", traces, layout, getPlotlyConfig()).then(() => {
        const chartEl = document.getElementById("chart-growth");
        if (!chartEl) return;

        if (chartEl._growthRelayoutHandler) {
            chartEl.removeListener("plotly_relayout", chartEl._growthRelayoutHandler);
        }

        chartEl._growthRelayoutHandler = (relayoutData) => {
            const hasXRangeChange =
                relayoutData["xaxis.range[0]"] !== undefined ||
                relayoutData["xaxis.range[1]"] !== undefined ||
                relayoutData["xaxis.range"] !== undefined ||
                relayoutData["xaxis.autorange"] !== undefined;

            if (!hasXRangeChange) return;
            autoScaleGrowthYAxis(chartEl, dates, data.portfolio_value, data.invested, relayoutData);
        };

        chartEl.on("plotly_relayout", chartEl._growthRelayoutHandler);
        autoScaleGrowthYAxis(chartEl, dates, data.portfolio_value, data.invested, null);
        Plotly.Plots.resize("chart-growth");
    });
}

function autoScaleGrowthYAxis(chartEl, dates, portfolioValues, investedValues, relayoutData) {
    if (!chartEl || !dates?.length) return;

    const getTimestamp = (value) => {
        if (!value) return NaN;
        const ts = new Date(value).getTime();
        return Number.isFinite(ts) ? ts : NaN;
    };

    let rangeStart;
    let rangeEnd;

    if (!relayoutData || relayoutData["xaxis.autorange"] === true) {
        rangeStart = getTimestamp(dates[0]);
        rangeEnd = getTimestamp(dates[dates.length - 1]);
    } else if (Array.isArray(relayoutData["xaxis.range"])) {
        rangeStart = getTimestamp(relayoutData["xaxis.range"][0]);
        rangeEnd = getTimestamp(relayoutData["xaxis.range"][1]);
    } else {
        rangeStart = getTimestamp(relayoutData["xaxis.range[0]"] || chartEl.layout?.xaxis?.range?.[0]);
        rangeEnd = getTimestamp(relayoutData["xaxis.range[1]"] || chartEl.layout?.xaxis?.range?.[1]);
    }

    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return;
    if (rangeStart > rangeEnd) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];

    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < dates.length; i += 1) {
        const xTs = getTimestamp(dates[i]);
        if (!Number.isFinite(xTs) || xTs < rangeStart || xTs > rangeEnd) continue;

        const p = Number(portfolioValues?.[i]);
        const inv = Number(investedValues?.[i]);

        if (Number.isFinite(p)) {
            minY = Math.min(minY, p);
            maxY = Math.max(maxY, p);
        }
        if (Number.isFinite(inv)) {
            minY = Math.min(minY, inv);
            maxY = Math.max(maxY, inv);
        }
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return;

    const span = Math.max(maxY - minY, 1);
    const padding = span * 0.08;
    const nextRange = [minY - padding, maxY + padding];

    Plotly.relayout(chartEl, { "yaxis.range": nextRange });
}

async function loadAllocationChartWithRetry(attempt = 1) {
    if (attempt === 1) {
        activeAllocationLoadToken += 1;
    }
    const loadToken = activeAllocationLoadToken;

    const { ok, data } = await apiRequest("/analytics/allocation");
    if (loadToken !== activeAllocationLoadToken) return;

    if (!ok) {
        console.log("Allocation load failed:", data);
        if (attempt < 6) {
            setTimeout(() => loadAllocationChartWithRetry(attempt + 1), 700 * attempt);
        }
        return;
    }

    if ((data.labels || []).length === 0 && attempt < 6) {
        setTimeout(() => loadAllocationChartWithRetry(attempt + 1), 700 * attempt);
        return;
    }

    allocationRawData = data;
    renderAllocationFromData(allocationRawData);
}

function renderAllocationFromData(data) {
    const dataset = getAllocationDataset(data, allocationViewMode);
    const labels = dataset.labels || [];
    const values = dataset.values || [];
    if (labels.length === 0) {
        const chartEl = getElement("#chart-allocation");
        if (chartEl) chartEl.innerHTML = "<p>No holdings yet.</p>";
        setText("#allocation-legend", "");
        return;
    }

    const colors = getAllocationColors(dataset);

    const trace = {
        type: "pie",
        labels: labels,
        values: values,
        sort: false,
        hole: 0.6,
        rotation: 0,
        direction: "clockwise",
        textinfo: "none",
        hovertemplate: "%{label}<br>%{percent} (%{value:.2f})<extra></extra>",
        marker: {
            colors: colors,
            line: { color: "#fff", width: 1 },
        },
    };

    const layout = {
        showlegend: false,
        height: 340,
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 24, l: 10, r: 10, b: 20 },
        font: { family: "system-ui, -apple-system, Segoe UI, Roboto, Arial", size: 12 },
    };

    Plotly.react("chart-allocation", [trace], layout, getPlotlyConfig()).then(() => {
        Plotly.Plots.resize("chart-allocation");
        setTimeout(() => Plotly.Plots.resize("chart-allocation"), 120);
        renderAllocationLegend(labels, values, colors);
    });
}

function initializeAllocationToggle() {
    if (allocationToggleInitialized) return;

    const assetsButton = getElement("#btn-allocation-assets");
    const typesButton = getElement("#btn-allocation-types");
    if (!assetsButton || !typesButton) return;

    const setMode = (mode) => {
        allocationViewMode = mode;
        assetsButton.classList.toggle("is-active", mode === "assets");
        typesButton.classList.toggle("is-active", mode === "types");
        if (allocationRawData) renderAllocationFromData(allocationRawData);
    };

    assetsButton.addEventListener("click", () => setMode("assets"));
    typesButton.addEventListener("click", () => setMode("types"));
    allocationToggleInitialized = true;
}

function getAllocationDataset(data, mode) {
    const labels = data.labels || [];
    const values = (data.values || []).map((value) => Number(value) || 0);
    const assetTypes = data.asset_types || [];

    if (mode !== "types") {
        return {
            labels: labels,
            values: values,
            assetTypes: assetTypes,
            mode: "assets",
        };
    }

    const byType = new Map(ALLOCATION_TYPE_ORDER.map((type) => [type, 0]));
    for (let i = 0; i < labels.length; i += 1) {
        const type = assetTypes[i] || "STOCK";
        byType.set(type, (byType.get(type) || 0) + (values[i] || 0));
    }

    const typeLabels = [];
    const typeValues = [];
    for (const type of ALLOCATION_TYPE_ORDER) {
        const value = byType.get(type) || 0;
        if (value > 0) {
            typeLabels.push(type);
            typeValues.push(value);
        }
    }

    return {
        labels: typeLabels,
        values: typeValues,
        mode: "types",
    };
}

function getAllocationColors(dataset) {
    if (dataset.mode === "types") {
        return dataset.labels.map((label) => ALLOCATION_TYPE_COLORS[label] || "#64748b");
    }
    return generateMutedCategoryPalette(dataset.labels.length);
}

function generateMutedCategoryPalette(count) {
    if (count <= 0) return [];

    // Unique color for every slice index: evenly distribute hues around the wheel.
    // This avoids accidental repeats when portfolio size grows.
    return Array.from({ length: count }, (_, i) => {
        const hue = (i * 360) / count;
        const saturation = 54;
        const lightness = i % 2 === 0 ? 46 : 54;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    });
}

function renderAllocationLegend(labels, values, colors) {
    const legendEl = getElement("#allocation-legend");
    if (!legendEl) return;

    const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
    legendEl.innerHTML = labels
        .map((label, i) => {
            const value = Number(values[i]) || 0;
            const pct = total > 0 ? (value / total) * 100 : 0;
            const swatch = colors[i] || "#999";
            return `
                <div class="allocation-legend-item">
                    <div class="allocation-legend-left">
                        <span class="allocation-legend-swatch" style="background:${swatch};"></span>
                        <span class="allocation-legend-label" title="${label}">${label}</span>
                    </div>
                    <span class="allocation-legend-pct">${pct.toFixed(1)}%</span>
                </div>
            `;
        })
        .join("");
}

function updateOverviewMetrics(data) {
    const dates = data.dates || [];
    const values = data.portfolio_value || [];
    const invested = data.invested || [];
    const dividendYieldTtm = Number(data.dividend_yield_ttm);
    const bestPerformer = data.best_performer || null;
    const worstPerformer = data.worst_performer || null;
    const topDividendAsset = data.top_dividend_asset || null;

    if (!dates.length || !values.length || !invested.length) {
        setText("#metric-portfolio-value", "-");
        setText("#metric-total-invested", "-");
        setMetricTextWithTone("#metric-unrealized-pl", "-", null);
        setMetricTextWithTone("#metric-total-roi", "-", null);
        setMetricTextWithTone("#metric-ytd-roi", "-", null);
        setMetricTextWithTone("#metric-dividend-yield", "-", null);
        setMetricTextWithTone("#metric-best-performer", "-", null);
        setMetricTextWithTone("#metric-worst-performer", "-", null);
        setMetricTextWithTone("#metric-top-dividend-asset", "-", null);
        return;
    }

    const latestValue = Number(values[values.length - 1]) || 0;
    const latestInvested = Number(invested[invested.length - 1]) || 0;
    const totalRoi = latestInvested > 0 ? ((latestValue - latestInvested) / latestInvested) * 100 : null;
    const ytdRoi = computeYtdRoi(dates, values);
    const unrealizedPl = latestValue - latestInvested;

    setText("#metric-portfolio-value", formatCurrency(latestValue));
    setText("#metric-total-invested", formatCurrency(latestInvested));
    setMetricTextWithTone("#metric-unrealized-pl", formatSignedCurrency(unrealizedPl), unrealizedPl);
    setMetricTextWithTone("#metric-total-roi", formatPercent(totalRoi), totalRoi);
    setMetricTextWithTone("#metric-ytd-roi", formatPercent(ytdRoi), ytdRoi);
    setMetricTextWithTone("#metric-dividend-yield", formatPercent(dividendYieldTtm), dividendYieldTtm);
    setMetricTextWithTone(
        "#metric-best-performer",
        formatAssetPercentMetric(bestPerformer, "roi_pct"),
        Number(bestPerformer?.roi_pct)
    );
    setMetricTextWithTone(
        "#metric-worst-performer",
        formatAssetPercentMetric(worstPerformer, "roi_pct"),
        Number(worstPerformer?.roi_pct)
    );
    setMetricTextWithTone(
        "#metric-top-dividend-asset",
        formatAssetPercentMetric(topDividendAsset, "dividend_yield_ttm_pct"),
        Number(topDividendAsset?.dividend_yield_ttm_pct)
    );
}

function computeYtdRoi(dates, values) {
    if (!dates.length || !values.length) return null;

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startTs = startOfYear.getTime();

    let startIndex = -1;
    for (let i = 0; i < dates.length; i += 1) {
        const ts = new Date(dates[i]).getTime();
        if (Number.isFinite(ts) && ts >= startTs) {
            startIndex = i;
            break;
        }
    }

    if (startIndex === -1) return null;

    const startValue = Number(values[startIndex]);
    const latestValue = Number(values[values.length - 1]);
    if (!Number.isFinite(startValue) || !Number.isFinite(latestValue) || startValue <= 0) return null;

    return ((latestValue - startValue) / startValue) * 100;
}

function formatCurrency(value) {
    if (!Number.isFinite(value)) return "-";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
    }).format(value);
}

function formatSignedCurrency(value) {
    if (!Number.isFinite(value)) return "-";
    const amount = formatCurrency(Math.abs(value));
    if (value > 0) return `+${amount}`;
    if (value < 0) return `-${amount}`;
    return amount;
}

function formatPercent(value, options = {}) {
    const { showPlus = true } = options;
    if (!Number.isFinite(value)) return "-";
    const prefix = showPlus && value >= 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
}

function formatAssetPercentMetric(item, valueKey) {
    if (!item || !item.symbol) return "-";
    const value = Number(item[valueKey]);
    if (!Number.isFinite(value)) return item.symbol;
    return `${item.symbol} (${formatPercent(value)})`;
}

function setMetricTextWithTone(selector, text, numericValue) {
    const el = setText(selector, text);
    if (!el) return;

    el.classList.remove("metric-positive", "metric-negative", "metric-neutral");

    if (!Number.isFinite(numericValue) || numericValue === 0) {
        el.classList.add("metric-neutral");
        return;
    }

    el.classList.add(numericValue > 0 ? "metric-positive" : "metric-negative");
}

async function loadAssetGrowthChartWithRetry(attempt = 1) {
    const { ok, data } = await apiRequest("/analytics/asset-growth");
    if (!ok) {
        if (attempt < 5) {
            setTimeout(() => loadAssetGrowthChartWithRetry(attempt + 1), 700 * attempt);
        }
        return;
    }

    if (!(data?.series || []).length) {
        if (attempt < 5) {
            setTimeout(() => loadAssetGrowthChartWithRetry(attempt + 1), 700 * attempt);
            return;
        }
        const chartEl = getElement("#chart-asset-growth");
        const selectEl = getElement("#asset-growth-select");
        if (chartEl) chartEl.innerHTML = "<p>No per-asset growth data yet.</p>";
        if (selectEl) selectEl.innerHTML = "";
        return;
    }

    assetGrowthData = data;
    renderAssetGrowthChart();
}

function renderAssetGrowthChart() {
    if (!assetGrowthData) return;

    const selectEl = getElement("#asset-growth-select");
    const chartEl = getElement("#chart-asset-growth");
    if (!selectEl || !chartEl) return;

    const series = assetGrowthData.series || [];
    const dates = assetGrowthData.dates || [];
    if (!series.length || !dates.length) return;

    const currentValue = selectEl.value;
    selectEl.innerHTML = series
        .map((item) => `<option value="${item.symbol}">${item.symbol} (${item.asset_type})</option>`)
        .join("");

    const selectedSymbol = series.some((item) => item.symbol === currentValue) ? currentValue : series[0].symbol;
    selectEl.value = selectedSymbol;

    const selected = series.find((item) => item.symbol === selectedSymbol) || series[0];
    const assetStartDate = getAssetSeriesStartDate(dates, selected.value, selected.invested);
    const lastDate = dates[dates.length - 1];
    const rangeConfig = buildAssetRangeSelector(assetStartDate, lastDate);

    const traces = [
        {
            x: dates,
            y: selected.value,
            type: "scatter",
            mode: "lines",
            name: `${selected.symbol}`,
            line: { color: "#1f77b4", width: 1.5 },
        },
        {
            x: dates,
            y: selected.invested,
            type: "scatter",
            mode: "lines",
            name: "Invested",
            line: { color: "skyblue", width: 1.5 },
        },
    ];

    const layout = {
        xaxis: {
            title: "Date",
            range: [assetStartDate, lastDate],
            rangeselector: {
                buttons: rangeConfig.buttons,
                active: rangeConfig.activeIndex,
            },
            rangeslider: { visible: false },
        },
        yaxis: { title: "Value" },
        legend: {
            orientation: "v",
            x: 0,
            y: 1,
            xanchor: "left",
            yanchor: "top",
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 40, l: 50, r: 20, b: 40 },
        font: { family: "system-ui, -apple-system, Segoe UI, Roboto, Arial", size: 12 },
    };

    Plotly.react("chart-asset-growth", traces, layout, getPlotlyConfig()).then(() => {
        if (chartEl._assetGrowthRelayoutHandler) {
            chartEl.removeListener("plotly_relayout", chartEl._assetGrowthRelayoutHandler);
        }

        chartEl._assetGrowthRelayoutHandler = (relayoutData) => {
            const hasXRangeChange =
                relayoutData["xaxis.range[0]"] !== undefined ||
                relayoutData["xaxis.range[1]"] !== undefined ||
                relayoutData["xaxis.range"] !== undefined ||
                relayoutData["xaxis.autorange"] !== undefined;
            if (!hasXRangeChange) return;
            autoScaleGrowthYAxis(chartEl, dates, selected.value, selected.invested, relayoutData);
        };

        chartEl.on("plotly_relayout", chartEl._assetGrowthRelayoutHandler);
        autoScaleGrowthYAxis(
            chartEl,
            dates,
            selected.value,
            selected.invested,
            { "xaxis.range": [assetStartDate, lastDate] }
        );
        Plotly.Plots.resize("chart-asset-growth");
    });

    if (!selectEl.dataset.bound) {
        selectEl.addEventListener("change", () => renderAssetGrowthChart());
        selectEl.dataset.bound = "1";
    }
}

function getAssetSeriesStartDate(dates, valueSeries, investedSeries) {
    for (let i = 0; i < dates.length; i += 1) {
        const value = Number(valueSeries?.[i]);
        const invested = Number(investedSeries?.[i]);
        if ((Number.isFinite(value) && value !== 0) || (Number.isFinite(invested) && invested !== 0)) {
            return dates[i];
        }
    }
    return dates[0];
}

function buildAssetRangeSelector(startDateString, endDateString) {
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);

    const days = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const months = days / 30.4375;
    const years = months / 12;

    const buttons = [];
    if (months >= 1) buttons.push({ count: 1, label: "1m", step: "month", stepmode: "backward" });
    if (months >= 6) buttons.push({ count: 6, label: "6m", step: "month", stepmode: "backward" });
    if (years >= 1) buttons.push({ count: 1, label: "1y", step: "year", stepmode: "backward" });
    if (years >= 3) buttons.push({ count: 3, label: "3y", step: "year", stepmode: "backward" });
    if (years >= 5) buttons.push({ count: 5, label: "5y", step: "year", stepmode: "backward" });
    buttons.push({ step: "all", label: "ALL" });

    return {
        buttons: buttons,
        activeIndex: buttons.length - 1,
    };
}
