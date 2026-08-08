(function () {
    "use strict";

    function init() {
        // ── Dropdown toggle ──────────────────────────────────
        const dropdown   = document.getElementById("userDropdown");
        const chipTrigger = document.getElementById("userChipTrigger");

        if (dropdown && chipTrigger) {
            chipTrigger.addEventListener("click", function (e) {
                e.stopPropagation();
                dropdown.classList.toggle("open");
            });
            document.addEventListener("click", function () {
                dropdown.classList.remove("open");
            });
        }

        // ── Change Password modal ────────────────────────────
        const btn      = document.getElementById("changePwdBtn");
        const overlay  = document.getElementById("changePwdOverlay");
        const closeBtn = document.getElementById("cpwClose");
        const cancelBtn= document.getElementById("cpwCancel");
        const saveBtn  = document.getElementById("cpwSave");
        const errEl    = document.getElementById("cpwError");
        const curInput = document.getElementById("cpwCurrent");
        const newInput = document.getElementById("cpwNew");
        const conInput = document.getElementById("cpwConfirm");

        if (!btn || !overlay) return;

        function openModal() {
            if (dropdown) dropdown.classList.remove("open");
            curInput.value = "";
            newInput.value = "";
            conInput.value = "";
            errEl.textContent = "";
            overlay.style.display = "flex";
            curInput.focus();
        }

        function closeModal() {
            overlay.style.display = "none";
        }

        btn.addEventListener("click", openModal);
        closeBtn.addEventListener("click", closeModal);
        cancelBtn.addEventListener("click", closeModal);
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closeModal();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && overlay.style.display === "flex") closeModal();
        });

        saveBtn.addEventListener("click", async function () {
            const employeeId      = localStorage.getItem("employee_id") || "";
            const currentPassword = curInput.value;
            const newPassword     = newInput.value;
            const confirmPassword = conInput.value;

            errEl.textContent = "";

            if (!currentPassword || !newPassword || !confirmPassword) {
                errEl.textContent = "All fields are required.";
                return;
            }
            if (newPassword !== confirmPassword) {
                errEl.textContent = "New password and confirm password do not match.";
                return;
            }
            if (newPassword.length < 4) {
                errEl.textContent = "New password must be at least 4 characters.";
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = "Updating…";

            try {
                const res  = await fetch("/api/auth/change-password", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ employee_id: employeeId, currentPassword, newPassword })
                });
                const json = await res.json();

                if (!json.ok) {
                    errEl.textContent = json.error || "Failed to update password.";
                    return;
                }

                closeModal();
                showCpwToast("Password updated successfully");
            } catch (err) {
                errEl.textContent = "Server error. Please try again.";
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = "Update Password";
            }
        });
    }

    function showCpwToast(msg) {
        const existing = document.getElementById("cpwToast");
        if (existing) existing.remove();

        const t = document.createElement("div");
        t.id = "cpwToast";
        t.textContent = msg;
        Object.assign(t.style, {
            position: "fixed",
            bottom: "28px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(30,30,46,0.95)",
            color: "#e8c99a",
            border: "1px solid rgba(212,169,106,0.35)",
            borderRadius: "10px",
            padding: "10px 20px",
            fontSize: "13px",
            fontWeight: "500",
            zIndex: "9999",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            pointerEvents: "none"
        });
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
