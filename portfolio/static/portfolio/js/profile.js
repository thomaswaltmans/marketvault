function view_profile() {
    hide_all_views();
    setActiveNav("#nav-profile");
    show("#view-profile");
    loadProfile();
}

async function loadProfile() {
    const { ok, data } = await apiRequest("/profile");
    if (!ok || !data) {
        setText("#profile-status", "Failed to load profile.");
        return;
    }

    getElement("#profile-username").value = data.username || "";
    getElement("#profile-email").value = data.email || "";
    getElement("#profile-first-name").value = data.first_name || "";
    getElement("#profile-last-name").value = data.last_name || "";
    setText("#profile-status", "");
}

async function saveProfile() {
    setText("#profile-status", "Saving...");

    const payload = {
        email: getElement("#profile-email").value.trim(),
        first_name: getElement("#profile-first-name").value.trim(),
        last_name: getElement("#profile-last-name").value.trim(),
    };

    const { ok, data } = await apiRequest("/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!ok) {
        console.log(data);
        setText("#profile-status", "Failed to save profile.");
        return;
    }

    const navProfile = getElement("#nav-profile");
    if (navProfile) {
        navProfile.textContent = (data.first_name || data.username || "").trim();
    }

    setText("#profile-status", "Profile saved.");
}

async function changePassword() {
    setText("#password-status", "Updating password...");

    const payload = {
        current_password: getElement("#password-current").value,
        new_password: getElement("#password-new").value,
        confirm_password: getElement("#password-confirm").value,
    };

    const { ok, data } = await apiRequest("/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!ok) {
        setText("#password-status", data?.error || "Failed to change password.");
        return;
    }

    getElement("#password-current").value = "";
    getElement("#password-new").value = "";
    getElement("#password-confirm").value = "";
    setText("#password-status", "Password updated.");
}
