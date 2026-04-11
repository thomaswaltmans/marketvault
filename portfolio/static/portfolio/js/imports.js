function view_import() {
    navigate("#view-import", "#nav-transactions");
}

async function uploadXlsx(file) {
    setText("#import-status", "Importing...");

    const formData = new FormData();
    formData.append("file", file);

    const { ok, data } = await apiRequest("/import", {
        method: "POST",
        body: formData,
    });
    if (!ok) {
        console.log(data);
        setText("#import-status", "Import failed. Check console.");
        alert("Import failed");
        return;
    }

    setText(
        "#import-status",
        `Imported ${data.created_transactions} transactions. Created ${data.created_assets} new assets.`
    );

    refreshDashboardCharts();
    view_dashboard();
}
