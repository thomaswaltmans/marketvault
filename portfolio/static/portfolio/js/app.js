document.addEventListener("DOMContentLoaded", function () {
    const mobileNavButton = getElement("#btn-mobile-nav");
    const mobileNavMenu = getElement("#mobile-nav-menu");
    const closeMobileNavMenu = () => {
        if (!mobileNavButton || !mobileNavMenu) return;
        mobileNavButton.setAttribute("aria-expanded", "false");
        mobileNavMenu.hidden = true;
    };
    const toggleMobileNavMenu = () => {
        if (!mobileNavButton || !mobileNavMenu) return;
        const nextExpanded = mobileNavButton.getAttribute("aria-expanded") !== "true";
        mobileNavButton.setAttribute("aria-expanded", String(nextExpanded));
        mobileNavMenu.hidden = !nextExpanded;
    };

    mobileNavButton?.addEventListener("click", (e) => {
        e.preventDefault();
        toggleMobileNavMenu();
    });

    document.querySelectorAll(".mobile-nav-option").forEach((button) => {
        button.addEventListener("click", (e) => {
            e.preventDefault();
            const view = button.dataset.view;
            closeMobileNavMenu();

            if (view === "dashboard") view_dashboard();
            if (view === "assets") view_assets();
            if (view === "transactions") view_transactions();
            if (view === "profile") view_profile();
        });
    });

    document.addEventListener("click", (event) => {
        const mobileNavRoot = event.target.closest("#mobile-nav");
        if (mobileNavRoot) return;
        closeMobileNavMenu();
    });

    getElement("#nav-profile")?.addEventListener("click", (e) => {
        e.preventDefault();
        closeMobileNavMenu();
        view_profile();
    });

    getElement("#nav-dashboard").addEventListener("click", (e) => {
        e.preventDefault();
        closeMobileNavMenu();
        view_dashboard();
    });

    getElement("#nav-assets").addEventListener("click", (e) => {
        e.preventDefault();
        closeMobileNavMenu();
        view_assets();
    });
    getElement("#btn-asset-search")?.addEventListener("click", () => {
        const q = getElement("#asset-search").value.trim();
        loadAssets(q);
    });
    getElement("#btn-toggle-asset-create")?.addEventListener("click", toggleAssetCreatePanel);
    getElement("#btn-asset-create")?.addEventListener("click", createAsset);
    getElement("#assets-list")?.addEventListener("click", async (e) => {
        const button = e.target.closest("button");
        if (!button) return;

        const action = button.dataset.action;
        const assetId = button.dataset.id;

        if (action === "toggle-menu") {
            e.preventDefault();
            toggleAssetMenu(assetId);
            return;
        }

        if (action === "delete") await deleteAsset(assetId);
        if (action === "edit") {
            closeAllAssetMenus();
            showEditForm(assetId);
        }
        if (action === "save-edit") await saveAssetEdit(assetId);
        if (action === "refresh-prices") await refreshAssetPrices(assetId);
        if (action === "cancel-edit") hideEditForm(assetId);
    });

    getElement("#nav-transactions").addEventListener("click", (e) => {
        e.preventDefault();
        closeMobileNavMenu();
        view_transactions();
    });
    getElement("#btn-new-transaction")?.addEventListener("click", () => view_transaction_form("new"));
    getElement("#btn-go-import")?.addEventListener("click", () => view_import());
    getElement("#btn-cancel-transaction")?.addEventListener("click", () => view_transactions());
    getElement("#btn-save-transaction")?.addEventListener("click", saveTransaction);
    getElement("#txn-type")?.addEventListener("change", updateTxnFieldVisibility);
    getElement("#btn-save-profile")?.addEventListener("click", saveProfile);
    getElement("#btn-change-password")?.addEventListener("click", changePassword);

    const fileInput = getElement("#xlsx");
    const fileName = getElement("#file-name");
    if (fileInput) {
        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            console.log("selected file:", file);
            if (fileName) fileName.textContent = file ? file.name : "";
        });
    }

    const importButton = getElement("#btn-import");
    if (importButton) {
        importButton.addEventListener("click", () => {
            const file = getElement("#xlsx").files[0];
            if (!file) {
                alert("Pick an .xlsx file first");
                return;
            }
            uploadXlsx(file);
        });
    }

    view_dashboard();
});
