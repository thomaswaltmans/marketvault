let activeAllocationLoadToken = 0;
let allocationViewMode = "assets";
let allocationRawData = null;
let allocationToggleInitialized = false;
let growthChartData = null;
let assetGrowthData = null;
let dividendsMonthlyData = null;
let winnersLosersData = null;
let hideSensitiveValues = false;
let overviewMetricsSnapshot = null;
let sensitiveToggleInitialized = false;
let growthRangeLabel = "1Y";
let assetGrowthRangeLabel = "1Y";
let dividendsRangeLabel = "1Y";
let winnersLosersRangeLabel = "M";

const ALLOCATION_TYPE_ORDER = ["ETF", "STOCK", "ETC", "CRYPTO"];
const ALLOCATION_TYPE_COLORS = {
    ETF: "hsl(0, 54%, 46%)",
    STOCK: "hsl(90, 54%, 54%)",
    ETC: "hsl(180, 54%, 46%)",
    CRYPTO: "hsl(270, 54%, 54%)",
};
const SENSITIVE_MASK_TEXT = "********";
const SENSITIVE_TOGGLE_STORAGE_KEY = "marketvault.hideSensitiveValues";

function getPlotlyConfig() {
    return {
        responsive: true,
        displayModeBar: false,
        displaylogo: false,
    };
}

function getChartAxisStyle(axis = "x") {
    const base = {
        title: "",
        showline: true,
        linecolor: "#d1d5db",
        linewidth: 1,
        zeroline: false,
        showgrid: true,
        gridcolor: "#e5e7eb",
        tickfont: { color: "#6b7280", size: 12 },
        tickcolor: "#d1d5db",
        ticks: "",
    };

    if (axis === "x") {
        return {
            ...base,
            gridcolor: "#f0f2f5",
        };
    }

    return base;
}

function computeDefaultRangeStart(startDateString, endDateString, years = 1) {
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);
    const candidate = new Date(endDate);
    candidate.setFullYear(candidate.getFullYear() - years);
    return candidate > startDate ? candidate.toISOString().slice(0, 10) : startDateString;
}

function view_dashboard() {
    hide_all_views();
    setActiveNav("#nav-dashboard");
    show("#view-dashboard");
    initializeAllocationToggle();
    initializeSensitiveToggle();

    requestAnimationFrame(() => {
        loadGrowthChartWithRetry();
        loadAllocationChartWithRetry();
        loadAssetGrowthChartWithRetry();
        loadDividendsMonthlyChartWithRetry();
        loadWinnersLosersCard();
    });
}

function refreshDashboardCharts() {
    loadGrowthChartWithRetry();
    loadAllocationChartWithRetry();
    loadAssetGrowthChartWithRetry();
    loadDividendsMonthlyChartWithRetry();
    loadWinnersLosersCard();
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
        growthChartData = data;
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
    if (dates.length === 0) {
        const controlsEl = getElement("#chart-growth-controls");
        if (controlsEl) controlsEl.innerHTML = "";
        return;
    }

    const lastDate = new Date(dates[dates.length - 1]);
    const rangeButtons = [
        { count: 1, label: "1M", step: "month", stepmode: "backward" },
        { count: 6, label: "6M", step: "month", stepmode: "backward" },
        { count: 1, label: "1Y", step: "year", stepmode: "backward" },
        { count: 3, label: "3Y", step: "year", stepmode: "backward" },
        { count: 5, label: "5Y", step: "year", stepmode: "backward" },
        { step: "all", label: "ALL" },
    ];
    const activeRange = rangeButtons.find((button) => button.label === growthRangeLabel) || rangeButtons[2];
    const xRange = computeRangeFromButton(dates[0], dates[dates.length - 1], activeRange);

    renderChartRangeControls("chart-growth-controls", rangeButtons, activeRange.label, (label) => {
        growthRangeLabel = label;
        if (growthChartData) renderGrowthChart(growthChartData);
    });

    const layout = {
        xaxis: {
            ...getChartAxisStyle("x"),
            range: xRange,
            tickformat: "%b '%y",
            rangeslider: { visible: false },
        },
        yaxis: {
            ...getChartAxisStyle("y"),
            showticklabels: !hideSensitiveValues,
        },
        legend: {
            orientation: "v",
            x: 0,
            y: 1,
            xanchor: "left",
            yanchor: "top",
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 10, l: hideSensitiveValues ? 12 : 38, r: 10, b: 24 },
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
        autoScaleGrowthYAxis(
            chartEl,
            dates,
            data.portfolio_value,
            data.invested,
            { "xaxis.range": xRange }
        );
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
        margin: { t: 16, l: 8, r: 8, b: 12 },
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

function initializeSensitiveToggle() {
    const toggleButton = getElement("#btn-sensitive-toggle");
    if (!toggleButton) return;

    hideSensitiveValues = readSensitiveToggleState();

    if (!sensitiveToggleInitialized) {
        toggleButton.addEventListener("click", () => {
            setSensitiveVisibility(!hideSensitiveValues);
        });
        sensitiveToggleInitialized = true;
    }

    setSensitiveVisibility(hideSensitiveValues, { persist: false });
}

function setSensitiveVisibility(nextHidden, options = {}) {
    const { persist = true } = options;
    hideSensitiveValues = Boolean(nextHidden);

    const toggleButton = getElement("#btn-sensitive-toggle");
    const toggleLabel = getElement("#sensitive-toggle-label");
    if (toggleButton) {
        toggleButton.classList.toggle("is-hidden", hideSensitiveValues);
        toggleButton.setAttribute("aria-pressed", String(hideSensitiveValues));
        toggleButton.setAttribute(
            "aria-label",
            hideSensitiveValues ? "Show sensitive values" : "Hide sensitive values"
        );
    }
    if (toggleLabel) {
        toggleLabel.textContent = hideSensitiveValues ? "Show values" : "Hide values";
    }

    if (persist) {
        persistSensitiveToggleState(hideSensitiveValues);
    }

    renderOverviewMetrics();
    applySensitiveYAxisState();
}

function readSensitiveToggleState() {
    try {
        return localStorage.getItem(SENSITIVE_TOGGLE_STORAGE_KEY) === "1";
    } catch (error) {
        return false;
    }
}

function persistSensitiveToggleState(isHidden) {
    try {
        localStorage.setItem(SENSITIVE_TOGGLE_STORAGE_KEY, isHidden ? "1" : "0");
    } catch (error) {
        // Ignore storage failures (private mode, blocked storage, etc.)
    }
}

function applySensitiveYAxisState() {
    if (typeof Plotly === "undefined") return;

    const showTickLabels = !hideSensitiveValues;
    const leftMargin = hideSensitiveValues ? 12 : 38;
    const chartIds = ["chart-growth", "chart-asset-growth", "chart-dividends-monthly"];

    chartIds.forEach((chartId) => {
        const chartEl = document.getElementById(chartId);
        if (!chartEl || !chartEl.data) return;
        Plotly.relayout(chartEl, {
            "yaxis.title.text": "",
            "yaxis.showticklabels": showTickLabels,
            "margin.l": leftMargin,
        });
    });
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
        overviewMetricsSnapshot = {
            portfolioValue: "-",
            totalInvested: "-",
            unrealizedPl: "-",
            unrealizedPlTone: null,
            totalRoi: "-",
            totalRoiTone: null,
            ytdRoi: "-",
            ytdRoiTone: null,
            dividendYieldTtm: "-",
            dividendYieldTtmTone: null,
            bestPerformer: "-",
            bestPerformerTone: null,
            worstPerformer: "-",
            worstPerformerTone: null,
            topDividendAsset: "-",
            topDividendAssetTone: null,
        };
        renderOverviewMetrics();
        return;
    }

    const latestValue = Number(values[values.length - 1]) || 0;
    const latestInvested = Number(invested[invested.length - 1]) || 0;
    const totalRoi = latestInvested > 0 ? ((latestValue - latestInvested) / latestInvested) * 100 : null;
    const ytdRoi = computeYtdRoi(dates, values);
    const unrealizedPl = latestValue - latestInvested;

    overviewMetricsSnapshot = {
        portfolioValue: formatCurrency(latestValue),
        totalInvested: formatCurrency(latestInvested),
        unrealizedPl: formatSignedCurrency(unrealizedPl),
        unrealizedPlTone: unrealizedPl,
        totalRoi: formatPercent(totalRoi),
        totalRoiTone: totalRoi,
        ytdRoi: formatPercent(ytdRoi),
        ytdRoiTone: ytdRoi,
        dividendYieldTtm: formatPercent(dividendYieldTtm),
        dividendYieldTtmTone: dividendYieldTtm,
        bestPerformer: formatAssetPercentMetric(bestPerformer, "roi_pct"),
        bestPerformerTone: Number(bestPerformer?.roi_pct),
        worstPerformer: formatAssetPercentMetric(worstPerformer, "roi_pct"),
        worstPerformerTone: Number(worstPerformer?.roi_pct),
        topDividendAsset: formatAssetPercentMetric(topDividendAsset, "dividend_yield_ttm_pct"),
        topDividendAssetTone: Number(topDividendAsset?.dividend_yield_ttm_pct),
    };

    renderOverviewMetrics();
}

function renderOverviewMetrics() {
    if (!overviewMetricsSnapshot) return;

    setSensitiveMetricText("#metric-portfolio-value", overviewMetricsSnapshot.portfolioValue, hideSensitiveValues);
    setSensitiveMetricText("#metric-total-invested", overviewMetricsSnapshot.totalInvested, hideSensitiveValues);

    const unrealizedText = hideSensitiveValues ? SENSITIVE_MASK_TEXT : overviewMetricsSnapshot.unrealizedPl;
    const unrealizedTone = hideSensitiveValues ? null : overviewMetricsSnapshot.unrealizedPlTone;
    const unrealizedEl = setMetricTextWithTone("#metric-unrealized-pl", unrealizedText, unrealizedTone);
    if (unrealizedEl) unrealizedEl.classList.toggle("value-hidden", hideSensitiveValues);

    setMetricTextWithTone("#metric-total-roi", overviewMetricsSnapshot.totalRoi, overviewMetricsSnapshot.totalRoiTone);
    setMetricTextWithTone("#metric-ytd-roi", overviewMetricsSnapshot.ytdRoi, overviewMetricsSnapshot.ytdRoiTone);
    setMetricTextWithTone(
        "#metric-dividend-yield",
        overviewMetricsSnapshot.dividendYieldTtm,
        overviewMetricsSnapshot.dividendYieldTtmTone
    );
    setMetricTextWithTone(
        "#metric-best-performer",
        overviewMetricsSnapshot.bestPerformer,
        overviewMetricsSnapshot.bestPerformerTone
    );
    setMetricTextWithTone(
        "#metric-worst-performer",
        overviewMetricsSnapshot.worstPerformer,
        overviewMetricsSnapshot.worstPerformerTone
    );
    setMetricTextWithTone(
        "#metric-top-dividend-asset",
        overviewMetricsSnapshot.topDividendAsset,
        overviewMetricsSnapshot.topDividendAssetTone
    );
}

function setSensitiveMetricText(selector, text, hidden) {
    const metricElement = setText(selector, hidden ? SENSITIVE_MASK_TEXT : text);
    if (!metricElement) return;
    metricElement.classList.toggle("value-hidden", hidden);
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
    const metricElement = setText(selector, text);
    if (!metricElement) return null;

    metricElement.classList.remove("metric-positive", "metric-negative", "metric-neutral");

    if (!Number.isFinite(numericValue) || numericValue === 0) {
        metricElement.classList.add("metric-neutral");
        return metricElement;
    }

    metricElement.classList.add(numericValue > 0 ? "metric-positive" : "metric-negative");
    return metricElement;
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
        const controlsEl = getElement("#chart-asset-growth-controls");
        if (chartEl) chartEl.innerHTML = "<p>No per-asset growth data yet.</p>";
        if (selectEl) selectEl.innerHTML = "";
        if (controlsEl) controlsEl.innerHTML = "";
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
    const startIndex = getAssetSeriesStartIndex(dates, selected.value, selected.invested);
    const selectedDates = dates.slice(startIndex);
    const selectedValue = selected.value.slice(startIndex);
    const selectedInvested = selected.invested.slice(startIndex);
    const assetStartDate = selectedDates[0] || dates[0];
    const lastDate = selectedDates[selectedDates.length - 1] || dates[dates.length - 1];
    const rangeConfig = buildAssetRangeSelector(assetStartDate, lastDate);
    const activeRange =
        rangeConfig.buttons.find((button) => button.label === assetGrowthRangeLabel) ||
        rangeConfig.buttons[rangeConfig.activeIndex] ||
        rangeConfig.buttons[0];
    const xRange = computeRangeFromButton(assetStartDate, lastDate, activeRange);

    renderChartRangeControls("chart-asset-growth-controls", rangeConfig.buttons, activeRange.label, (label) => {
        assetGrowthRangeLabel = label;
        renderAssetGrowthChart();
    });

    const traces = [
        {
            x: selectedDates,
            y: selectedValue,
            type: "scatter",
            mode: "lines",
            name: `${selected.symbol}`,
            line: { color: "#1f77b4", width: 1.5 },
        },
        {
            x: selectedDates,
            y: selectedInvested,
            type: "scatter",
            mode: "lines",
            name: "Invested",
            line: { color: "skyblue", width: 1.5 },
        },
    ];

    const layout = {
        xaxis: {
            ...getChartAxisStyle("x"),
            range: xRange,
            tickformat: "%b '%y",
            rangeslider: { visible: false },
        },
        yaxis: {
            ...getChartAxisStyle("y"),
            showticklabels: !hideSensitiveValues,
        },
        legend: {
            orientation: "v",
            x: 0,
            y: 1,
            xanchor: "left",
            yanchor: "top",
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 10, l: hideSensitiveValues ? 12 : 38, r: 10, b: 24 },
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
            autoScaleGrowthYAxis(chartEl, selectedDates, selectedValue, selectedInvested, relayoutData);
        };

        chartEl.on("plotly_relayout", chartEl._assetGrowthRelayoutHandler);
        autoScaleGrowthYAxis(
            chartEl,
            selectedDates,
            selectedValue,
            selectedInvested,
            { "xaxis.range": xRange }
        );
        Plotly.Plots.resize("chart-asset-growth");
    });

    if (!selectEl.dataset.bound) {
        selectEl.addEventListener("change", () => renderAssetGrowthChart());
        selectEl.dataset.bound = "1";
    }
}

function getAssetSeriesStartIndex(dates, valueSeries, investedSeries) {
    for (let i = 0; i < dates.length; i += 1) {
        const value = Number(valueSeries?.[i]);
        const invested = Number(investedSeries?.[i]);
        if ((Number.isFinite(value) && value !== 0) || (Number.isFinite(invested) && invested !== 0)) {
            return i;
        }
    }
    return 0;
}

function buildAssetRangeSelector(startDateString, endDateString) {
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);

    const days = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const months = days / 30.4375;
    const years = months / 12;

    const buttons = [];
    if (months >= 1) buttons.push({ count: 1, label: "1M", step: "month", stepmode: "backward" });
    if (months >= 6) buttons.push({ count: 6, label: "6M", step: "month", stepmode: "backward" });
    if (years >= 1) buttons.push({ count: 1, label: "1Y", step: "year", stepmode: "backward" });
    if (years >= 3) buttons.push({ count: 3, label: "3Y", step: "year", stepmode: "backward" });
    if (years >= 5) buttons.push({ count: 5, label: "5Y", step: "year", stepmode: "backward" });
    buttons.push({ step: "all", label: "ALL" });

    let activeIndex = buttons.length - 1;
    const oneYearIndex = buttons.findIndex((button) => button.label === "1Y");
    if (oneYearIndex !== -1) {
        activeIndex = oneYearIndex;
    }

    return {
        buttons: buttons,
        activeIndex: activeIndex,
    };
}

function buildYearRangeSelector(startDateString, endDateString) {
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);

    const days = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const years = days / 365.25;
    const buttons = [];

    if (years >= 1) buttons.push({ count: 1, label: "1Y", step: "year", stepmode: "backward" });
    if (years >= 3) buttons.push({ count: 3, label: "3Y", step: "year", stepmode: "backward" });
    if (years >= 5) buttons.push({ count: 5, label: "5Y", step: "year", stepmode: "backward" });
    buttons.push({ step: "all", label: "ALL" });

    const oneYearIndex = buttons.findIndex((button) => button.label === "1Y");
    return {
        buttons,
        activeIndex: oneYearIndex !== -1 ? oneYearIndex : buttons.length - 1,
    };
}

async function loadDividendsMonthlyChartWithRetry(attempt = 1) {
    const { ok, data } = await apiRequest("/analytics/dividends-monthly");
    if (!ok) {
        if (attempt < 5) {
            setTimeout(() => loadDividendsMonthlyChartWithRetry(attempt + 1), 700 * attempt);
        }
        return;
    }

    const dates = data?.dates || [];
    if (!dates.length) {
        const chartEl = getElement("#chart-dividends-monthly");
        const controlsEl = getElement("#chart-dividends-monthly-controls");
        if (chartEl) chartEl.innerHTML = "<p>No dividend history yet.</p>";
        if (controlsEl) controlsEl.innerHTML = "";
        return;
    }

    dividendsMonthlyData = data;
    renderDividendsMonthlyChart();
}

function renderDividendsMonthlyChart() {
    if (!dividendsMonthlyData) return;

    const dates = dividendsMonthlyData.dates || [];
    const dividends = dividendsMonthlyData.dividends || [];
    if (!dates.length) return;

    const lastDate = dates[dates.length - 1];
    const rangeConfig = buildYearRangeSelector(dates[0], lastDate);
    const activeRange =
        rangeConfig.buttons.find((button) => button.label === dividendsRangeLabel) ||
        rangeConfig.buttons[rangeConfig.activeIndex] ||
        rangeConfig.buttons[0];
    const xRange = computeRangeFromButton(dates[0], lastDate, activeRange);

    renderChartRangeControls("chart-dividends-monthly-controls", rangeConfig.buttons, activeRange.label, (label) => {
        dividendsRangeLabel = label;
        renderDividendsMonthlyChart();
    });

    const trace = {
        x: dates,
        y: dividends,
        type: "bar",
        name: "Dividends",
        marker: {
            color: "rgba(220, 38, 38, 0.68)",
            line: {
                color: "rgba(185, 28, 28, 0.95)",
                width: 1,
            },
        },
        hovertemplate: "%{x|%b %Y}<br>Dividends: %{y:.2f}<extra></extra>",
    };

    const layout = {
        xaxis: {
            ...getChartAxisStyle("x"),
            range: xRange,
            rangeslider: { visible: false },
            tickformat: "%b '%y",
        },
        yaxis: {
            ...getChartAxisStyle("y"),
            showticklabels: !hideSensitiveValues,
            fixedrange: true,
        },
        bargap: 0.32,
        barcornerradius: 8,
        showlegend: false,
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        margin: { t: 10, l: hideSensitiveValues ? 12 : 38, r: 10, b: 24 },
        font: { family: "system-ui, -apple-system, Segoe UI, Roboto, Arial", size: 12 },
    };

    Plotly.react("chart-dividends-monthly", [trace], layout, getPlotlyConfig()).then(() => {
        Plotly.Plots.resize("chart-dividends-monthly");
    });
}

function computeRangeFromButton(startDateString, endDateString, button) {
    if (!button || button.step === "all") {
        return [startDateString, endDateString];
    }

    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);
    const nextStart = new Date(endDate);

    if (button.step === "month") {
        nextStart.setMonth(nextStart.getMonth() - (button.count || 0));
    } else if (button.step === "year") {
        nextStart.setFullYear(nextStart.getFullYear() - (button.count || 0));
    }

    const boundedStart = nextStart > startDate ? nextStart : startDate;
    return [boundedStart.toISOString().slice(0, 10), endDateString];
}

function renderChartRangeControls(containerId, buttons, activeLabel, onSelect) {
    const container = getElement(`#${containerId}`);
    if (!container) return;

    container.innerHTML = buttons
        .map((button) => `
            <button
                type="button"
                class="chart-range-btn${button.label === activeLabel ? " is-active" : ""}"
                data-label="${button.label}"
            >${button.label}</button>
        `)
        .join("");

    container.querySelectorAll(".chart-range-btn").forEach((buttonEl) => {
        buttonEl.addEventListener("click", () => onSelect(buttonEl.dataset.label));
    });
}

async function loadWinnersLosersCard() {
    const { ok, data } = await apiRequest(`/analytics/winners-losers?range=${encodeURIComponent(winnersLosersRangeLabel)}`);
    const controls = [
        { label: "W" },
        { label: "M" },
        { label: "YTD" },
        { label: "ALL" },
    ];

    renderChartRangeControls("winners-losers-controls", controls, winnersLosersRangeLabel, (label) => {
        winnersLosersRangeLabel = label;
        loadWinnersLosersCard();
    });

    const container = getElement("#winners-losers-card");
    if (!container) return;

    if (!ok || !data) {
        container.innerHTML = "<div class='surface-card'>Unable to load winners and losers.</div>";
        return;
    }

    winnersLosersData = data;
    renderWinnersLosersCard();
}

function renderWinnersLosersCard() {
    const container = getElement("#winners-losers-card");
    if (!container || !winnersLosersData) return;

    const winners = (winnersLosersData.winners || []).filter((item) => Number(item.return_pct) > 0);
    const losers = (winnersLosersData.losers || []).filter((item) => Number(item.return_pct) < 0);
    const targetRows = 6;

    const renderItems = (items, emptyText) => {
        const rows = [];

        if (!items.length) {
            rows.push(`<div class="performance-empty">${emptyText}</div>`);
        } else {
            rows.push(
                ...items.slice(0, targetRows).map((item) => `
                <div class="performance-item">
                    <div class="performance-item-main">
                        <span class="performance-item-symbol">${item.symbol}</span>
                        <span class="performance-item-type">${item.asset_type}</span>
                    </div>
                    <div class="performance-item-value ${Number(item.return_pct) >= 0 ? "metric-positive" : "metric-negative"}">
                        ${formatPercent(Number(item.return_pct))}
                    </div>
                </div>
            `)
            );
        }

        while (rows.length < targetRows) {
            rows.push(`<div class="performance-item performance-item-placeholder" aria-hidden="true"></div>`);
        }

        return rows.join("");
    };

    container.innerHTML = `
        <div class="performance-column">
            <div class="performance-column-title">Winners</div>
            <div class="performance-list">
                ${renderItems(winners, "No winners in this period.")}
            </div>
        </div>
        <div class="performance-column">
            <div class="performance-column-title">Losers</div>
            <div class="performance-list">
                ${renderItems(losers, "No losers in this period.")}
            </div>
        </div>
    `;
}
