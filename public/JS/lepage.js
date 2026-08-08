const tableBody = document.getElementById("leTableBody");
const searchInput = document.getElementById("searchInput");
const exportBtn = document.getElementById("exportBtn");
const detailModal = document.getElementById("detailModal");
const detailContent = document.getElementById("detailContent");
const closeDetailModal = document.getElementById("closeDetailModal");

let dataStore = [];

// 🔹 LOAD DATA (only submitted)
async function loadData() {
    try {
        const res = await fetch('/api/spring/submitted');
        const json = await res.json();

        if (!res.ok) { // res.ok is standard for fetch status
            console.error("Failed to load data");
            return;
        }

        dataStore = json.data || [];
        renderTable(dataStore);
    } catch (err) {
        console.error("Load error:", err);
    }
}

// 🔹 RENDER TABLE
function renderTable(data) {
    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center;">No submitted springs</td>
            </tr>`;
        return;
    }

    data.forEach(item => {
        const row = document.createElement("tr");

        row.innerHTML = `
        <td>
            <input type="checkbox" class="row-checkbox" data-id="${item.id}">
        </td>
    
        <td>${item.spring_tag || "-"}</td>
        <td>${item.line_id || "-"}</td>
        <td>${item.stress_system || "-"}</td>
        <td>${item.spring_type || "-"}</td>
        <td>${item.quantity ?? "-"}</td>
    
        <td class="${item.status === 'approved' ? 'status-approved' : ''}">
            ${item.status || "-"}
        </td>
    
        <td>
            ${item.status !== 'approved'
                ? `<button class="approve-btn" data-id="${item.id}">Approve</button>`
                : '✔'
            }
        </td>
    `;

        row.style.cursor = "pointer";

        row.addEventListener("click", function (e) {

            // ❗ Prevent button click conflict
            if (e.target.classList.contains("approve-btn")) return;

            showDetailModal(item);
        });

        // ✅ Attach approve event
        const btn = row.querySelector(".approve-btn");
        if (btn) {
            btn.addEventListener("click", async function () {
                const id = this.dataset.id;
                if (!id) return;

                try {
                    // Removed spaces from the template literal URL
                    const res = await fetch(`/api/spring/approve/${id}`, {
                        method: "PUT"
                    });

                    const json = await res.json();
                    if (!res.ok) throw new Error("Approval failed");

                    // Refresh table
                    loadData();
                } catch (err) {
                    console.error("Approve error:", err);
                    alert("Failed to approve");
                }
            });
        }
        tableBody.appendChild(row);
    });
}

// 🔹 SEARCH FILTER
if (searchInput) {
    searchInput.addEventListener("input", function () {
        const val = this.value.toLowerCase();
        const filtered = dataStore.filter(d =>
            (d.spring_tag && d.spring_tag.toLowerCase().includes(val)) ||
            (d.line_id && d.line_id.toLowerCase().includes(val))
        );
        renderTable(filtered);
    });
}

// 🔹 EXPORT
if (exportBtn) {
    exportBtn.addEventListener("click", function () {
        window.open('/api/spring/export', '_blank');
    });
}

// 🔹 INIT
document.addEventListener("DOMContentLoaded", loadData);

function showDetailModal(data) {

    detailContent.innerHTML = `
        <div><strong>Tag:</strong> ${data.spring_tag}</div>
        <div><strong>Line:</strong> ${data.line_id}</div>
        <div><strong>System:</strong> ${data.stress_system}</div>
        <div><strong>Type:</strong> ${data.spring_type}</div>
        <div><strong>Figure:</strong> ${data.figure}</div>
        <div><strong>Qty:</strong> ${data.quantity || "-"}</div>
        <div><strong>Node:</strong> ${data.node_no || "-"}</div>

        <hr>

        <div><strong>Subline:</strong> ${data.subline || "-"}</div>
        <div><strong>Area:</strong> ${data.area || "-"}</div>
        <div><strong>Class:</strong> ${data.piping_class || "-"}</div>
        <div><strong>Size:</strong> ${data.line_size || "-"}</div>

        <hr>

        <div><strong>Travel Up:</strong> ${data.travel_up || "-"}</div>
        <div><strong>Travel Down:</strong> ${data.travel_down || "-"}</div>
        <div><strong>Max Up:</strong> ${data.max_up || "-"}</div>
        <div><strong>Max Down:</strong> ${data.max_down || "-"}</div>

        <hr>

        <div><strong>Operating Load:</strong> ${data.operating_load || "-"}</div>
        <div><strong>Hydro Load:</strong> ${data.hydro_load || "-"}</div>
    `;

    detailModal.classList.add("active");
}

closeDetailModal.addEventListener("click", () => {
    detailModal.classList.remove("active");
});

// Optional: click outside to close
detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) {
        detailModal.classList.remove("active");
    }
});

const selectAll = document.getElementById("selectAll");

if (selectAll) {
    selectAll.addEventListener("change", function () {

        const checkboxes = document.querySelectorAll(".row-checkbox");

        checkboxes.forEach(cb => {
            cb.checked = selectAll.checked;
        });
    });
}

const bulkApproveBtn = document.getElementById("bulkApproveBtn");

if (bulkApproveBtn) {
    bulkApproveBtn.addEventListener("click", async function () {

        const selected = document.querySelectorAll(".row-checkbox:checked");

        if (selected.length === 0) {
            alert("No springs selected");
            return;
        }

        const ids = Array.from(selected).map(cb => cb.dataset.id);

        if (!confirm(`Approve ${ids.length} springs?`)) return;

        try {
            const res = await fetch('/api/spring/bulk-approve', {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids })
            });

            const json = await res.json();

            if (!json.ok) throw new Error();

            alert("Approved successfully");

            loadData();

        } catch (err) {
            console.error(err);
            alert("Bulk approve failed");
        }
    });
}
