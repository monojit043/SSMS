/* ============================================================
   SSMS — Lead Engineer Approval Portal
   JS/le-approval.js
   ============================================================ */

(function () {
    "use strict";

    const role = localStorage.getItem("role");
    const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");

    if (!role || assignments.length === 0) {
        window.location.href = "/Login.html";
    }

    if (role !== "LE" && role !== "GL") {
        window.location.href = "/dashboard.html";
    }

    const logoutBtn = document.getElementById("logoutBtn");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", function () {
            localStorage.clear();
            window.location.href = "/Login.html";
        });
    }

    const changeJobUnitBtn = document.getElementById("changeJobUnitBtn");
    if (changeJobUnitBtn) {
        changeJobUnitBtn.addEventListener("click", async function () {
            const dropdown = document.getElementById("userDropdown");
            if (dropdown) dropdown.classList.remove("open");

            // Refresh from server so any newly created master units show up
            // without requiring a fresh login.
            let assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
            const empId = localStorage.getItem("employee_id") || assignments[0]?.employee_id || "";
            if (empId) {
                try {
                    const res = await fetch(`/api/auth/assignments?employee_id=${encodeURIComponent(empId)}`);
                    const json = await res.json();
                    if (json.ok && json.data) {
                        assignments = json.data;
                        localStorage.setItem("assignments", JSON.stringify(assignments));
                    }
                } catch (err) { console.error("Refresh assignments failed:", err); }
            }

            if (assignments.length <= 1) {
                showToast("You only have one job/unit assigned");
                return;
            }
            openJobSelectionFromAssignments(assignments);
        });
    }

    // ── Populate navbar user info ──
    const _empId    = localStorage.getItem("employee_id") || "";
    const _empName  = localStorage.getItem("employee_name") || _empId;
    const _avatarEl = document.getElementById("userAvatar");
    const _nameEl   = document.getElementById("userNameDisplay");
    const _roleEl   = document.getElementById("roleBadge");
    if (_avatarEl) {
        const _parts = _empName.trim().split(/\s+/);
        _avatarEl.textContent = _parts.length >= 2
            ? (_parts[0][0] + _parts[_parts.length - 1][0]).toUpperCase()
            : _empName.slice(0, 2).toUpperCase() || "LE";
    }
    if (_nameEl) _nameEl.textContent = _empName || "—";
    if (_roleEl) {
        _roleEl.textContent = role || "LE";
        _roleEl.className   = "db-role-badge role-" + (role || "le").toLowerCase();
    }

    window.history.pushState(null, "", window.location.href);
    window.onpopstate = function () {
        window.history.pushState(null, "", window.location.href);
    };


    /* ══════════════════════════════════════════
       STATE
    ══════════════════════════════════════════ */
    let allSprings = [];        // full dataset from API
    let filteredSprings = [];        // after filters applied
    let selectedIds = new Set(); // checked rows
    let currentPage = 1;
    const PAGE_SIZE = 15;
    let sortCol = "spring_tag";
    let sortDir = "asc";
    let activeFilter = "all";
    let currentSpring = null;      // spring open in detail modal
    let pendingAction = null;      // { type, ids, remarks }


    /* ══════════════════════════════════════════
       ELEMENT REFERENCES
    ══════════════════════════════════════════ */

    // Modal
    const jobModal = document.getElementById("jobModal");
    const jobForm = document.getElementById("jobForm");
    const modalJobNo = document.getElementById("modalJobNo");
    const modalUnitNo = document.getElementById("modalUnitNo");
    const sessionJobDisplay = document.getElementById("sessionJobDisplay");
    const sessionUnitDisplay = document.getElementById("sessionUnitDisplay");

    // Stats
    const statPending = document.getElementById("statPending");
    const statApproved = document.getElementById("statApproved");
    const statRejected = document.getElementById("statRejected");
    const donutFill = document.getElementById("donutFill");
    const donutPct = document.getElementById("donutPct");

    // Filter pills
    const filterPillsWrap = document.getElementById("filterPills");

    // Toolbar
    const leSearchInput = document.getElementById("leSearchInput");
    const leSearchClear = document.getElementById("leSearchClear");
    const lineFilter = document.getElementById("lineFilter");
    const typeFilter = document.getElementById("typeFilter");
    const stressFilter = document.getElementById("stressFilter");
    const addedByFilter = document.getElementById("addedByFilter");
    const resultCount = document.getElementById("resultCount");

    // Table
    const leTableBody = document.getElementById("leTableBody");
    const leEmpty = document.getElementById("leEmpty");
    const leLoading = document.getElementById("leLoading");
    const selectAll = document.getElementById("selectAll");

    // Selection bar
    const selectionBar = document.getElementById("selectionBar");
    const selectionCount = document.getElementById("selectionCount");
    const selApproveBtn = document.getElementById("selApproveBtn");
    const selRejectBtn = document.getElementById("selRejectBtn");
    const selClearBtn = document.getElementById("selClearBtn");

    // Pagination
    const pagePrev = document.getElementById("pagePrev");
    const pageNext = document.getElementById("pageNext");
    const pageNumbers = document.getElementById("pageNumbers");

    // Spring detail modal
    const springDetailModal = document.getElementById("springDetailModal");
    const sdmClose = document.getElementById("sdmClose");
    const sdmTag = document.getElementById("sdmTag");
    const sdmStatusPill = document.getElementById("sdmStatusPill");
    const sdmPipingGrid = document.getElementById("sdmPipingGrid");
    const sdmSpringGrid = document.getElementById("sdmSpringGrid");
    const sdmImage = document.getElementById("sdmImage");
    const sdmImgPlaceholder = document.getElementById("sdmImgPlaceholder");
    const sdmRemarks = document.getElementById("sdmRemarks");
    const sdmApproveBtn = document.getElementById("sdmApproveBtn");
    const sdmRejectBtn = document.getElementById("sdmRejectBtn");
    const sdmDisapproveBtn = document.getElementById("sdmDisapproveBtn");

    // Confirm modal
    const confirmModal = document.getElementById("confirmModal");
    const confirmTitle = document.getElementById("confirmTitle");
    const confirmMsg = document.getElementById("confirmMsg");
    const confirmIcon = document.getElementById("confirmIcon");
    const confirmOk = document.getElementById("confirmOk");
    const confirmCancel = document.getElementById("confirmCancel");

    // Bulk / refresh
    const bulkApproveBtn = document.getElementById("bulkApproveBtn");
    const bulkExportBtn  = document.getElementById("bulkExportBtn");
    const exportAllBtn   = document.getElementById("exportAllBtn");
    const refreshBtn     = document.getElementById("refreshBtn");
    const lastRefreshText = document.getElementById("lastRefreshText");


    /* ══════════════════════════════════════════
       JOB / UNIT MODAL
    ══════════════════════════════════════════ */

    function openJobModal() {
        jobModal.classList.remove("hidden");
        jobModal.classList.remove("modal-hidden");

        // FORCE override any inline style
        jobModal.style.display = "flex";
        jobModal.style.visibility = "visible";
        jobModal.style.opacity = "1";
    }

    function closeModal(job, unit) {
        sessionJobDisplay.textContent = job;
        sessionUnitDisplay.textContent = unit;
    
        jobModal.classList.add("modal-hidden");
        setTimeout(() => { jobModal.style.display = "none"; }, 320);
    
        // 🔥 LE PAGE DATA LOAD
        loadSprings();
    }


    // document.addEventListener("DOMContentLoaded", function () {

    //     const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");

    //     console.log("Assignments:", assignments);

    //     // 🔹 CASE 1 — No assignments → logout
    //     if (assignments.length === 0) {
    //         localStorage.clear();
    //         window.location.href = "/Login.html";
    //         return;
    //     }

    //     // 🔹 CASE 2 — Only ONE job → auto select
    //     if (assignments.length === 1) {

    //         const a = assignments[0];

    //         localStorage.setItem("jobno", a.job_no);
    //         localStorage.setItem("unit", a.unit_no);

    //         closeJobModal(a.job_no, a.unit_no);
    //         return;
    //     }

    //     // 🔹 CASE 3 — MULTIPLE JOBS → show modal
    //     openJobSelectionFromAssignments(assignments);

    // });

    document.addEventListener("DOMContentLoaded", function () {

        const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
        const jobNo = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");

        console.log("Assignments:", assignments);
        console.log("Saved Job:", jobNo, unitNo);

        // ❌ No session → logout
        if (assignments.length === 0) {
            localStorage.clear();
            window.location.href = "/Login.html";
            return;
        }

        // ✅ IF JOB ALREADY SELECTED → USE IT
        if (jobNo && unitNo) {
            closeModal(jobNo, unitNo);

            // JE page
            if (typeof loadStressLines === "function") {
                loadStressLines(jobNo, unitNo);
            }

            // LE page
            loadSprings();

            return;
        }

        // 🟡 FIRST TIME ONLY → ask selection
        if (assignments.length === 1) {
            const a = assignments[0];

            localStorage.setItem("jobno", a.job_no);
            localStorage.setItem("unit", a.unit_no);

            closeModal(a.job_no, a.unit_no);

            if (typeof loadStressLines === "function") {
                loadStressLines(a.job_no, a.unit_no);
            }

            loadSprings();

        } else {
            openJobSelectionFromAssignments(assignments);
        }

    });

    let _jobSelAssignments = [];

    function _handleJobSelectChange() {
        const selectedJob = modalJobNo.value;
        modalUnitNo.innerHTML = '<option value="">— Select Unit No. —</option>';
        _jobSelAssignments
            .filter(a => a.job_no === selectedJob)
            .forEach(a => {
                const opt = document.createElement("option");
                opt.value = a.unit_no;
                opt.textContent = a.is_master
                    ? `${a.unit_no} — Master (${(a.master_members || []).join(", ")})`
                    : a.unit_no;
                modalUnitNo.appendChild(opt);
            });
    }

    function openJobSelectionFromAssignments(assignments) {
        _jobSelAssignments = assignments;

        modalJobNo.innerHTML = '<option value="">— Select Job No. —</option>';
        modalUnitNo.innerHTML = '<option value="">— Select Unit No. —</option>';

        const jobs = [...new Set(assignments.map(a => a.job_no))];
        jobs.forEach(job => {
            const opt = document.createElement("option");
            opt.value = job;
            opt.textContent = job;
            modalJobNo.appendChild(opt);
        });

        // Remove before adding — prevents duplicate listeners on re-open
        modalJobNo.removeEventListener("change", _handleJobSelectChange);
        modalJobNo.addEventListener("change", _handleJobSelectChange);

        openJobModal();
    }

    jobForm.addEventListener("submit", function (e) {
        e.preventDefault();
        const job = modalJobNo.value, unit = modalUnitNo.value;
        if (!job || !unit) return;
        localStorage.setItem("jobno", job);
        localStorage.setItem("unit", unit);
        closeJobModal(job, unit);
    });

    function closeJobModal(job, unit) {
        sessionJobDisplay.textContent = job;
        sessionUnitDisplay.textContent = unit;
        jobModal.classList.add("hidden");
        setTimeout(() => { jobModal.style.display = "none"; }, 320);

        // Reset all filter state for the new job context
        activeFilter = "all";
        if (leSearchInput) { leSearchInput.value = ""; leSearchClear.classList.remove("visible"); }
        if (lineFilter)    lineFilter.value    = "";
        if (typeFilter)    typeFilter.value    = "";
        if (stressFilter)  stressFilter.value  = "";
        if (addedByFilter) addedByFilter.value = "";
        if (filterPillsWrap) {
            filterPillsWrap.querySelectorAll(".filter-pill").forEach(p => {
                p.classList.toggle("active", p.dataset.status === "all");
            });
        }

        loadSprings();
    }


    /* ══════════════════════════════════════════
       LOAD SPRINGS
    ══════════════════════════════════════════ */

    async function loadSprings() {
        const jobNo = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;

        showLoading(true);

        try {
            const res = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&excludeStatus=saved&aggregate=true`);
            const json = await res.json();
            allSprings = json.data || [];

            updateAggregateBanner(json.meta, "leAggregateBannerReview", "leAggMasterUnitReview", "leAggMembersReview");

            populateLineFilter();
            populateDynamicFilters();
            applyFilters();
            updateStats();
            updateLastRefresh();

        } catch (e) {
            console.error("loadSprings:", e);
            showToast("❌ Failed to load spring data");
        } finally {
            showLoading(false);
        }
    }

    function updateAggregateBanner(meta, bannerId, masterElId, membersElId) {
        const banner = document.getElementById(bannerId);
        if (!banner) return;
        if (meta && meta.aggregated) {
            document.getElementById(masterElId).textContent  = meta.masterUnitNo;
            document.getElementById(membersElId).textContent = meta.members.join(", ");
            banner.classList.remove("hidden");
        } else {
            banner.classList.add("hidden");
        }
    }

    function showLoading(state) {
        leLoading.style.display = state ? "flex" : "none";
        leTableBody.style.opacity = state ? "0.4" : "1";
    }

    function updateLastRefresh() {
        const now = new Date();
        lastRefreshText.textContent = "Last refreshed " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }


    /* ══════════════════════════════════════════
       STATS & DONUT
    ══════════════════════════════════════════ */

    function updateStats() {
        const pending = allSprings.filter(s => s.status === "submitted").length;
        const approved = allSprings.filter(s => s.status === "approved").length;
        const rejected = allSprings.filter(s => s.status === "rejected").length;
        const total = allSprings.length;

        animateNum(statPending, pending);
        animateNum(statApproved, approved);
        animateNum(statRejected, rejected);

        // Donut — % approved + rejected (decided)
        const decided = approved + rejected;
        const pct = total > 0 ? Math.round((decided / total) * 100) : 0;
        const circum = 2 * Math.PI * 32;  // r=32
        const filled = (pct / 100) * circum;

        donutFill.setAttribute("stroke-dasharray", `${filled.toFixed(1)} ${(circum - filled).toFixed(1)}`);
        donutPct.textContent = pct + "%";
    }

    function animateNum(el, target) {
        if (!el) return;
        const current = parseInt(el.textContent) || 0;
        if (current === target) return;
        const step = (target - current) / 12;
        let val = current;
        const timer = setInterval(() => {
            val += step;
            if ((step > 0 && val >= target) || (step < 0 && val <= target)) {
                val = target; clearInterval(timer);
            }
            el.textContent = Math.round(val);
        }, 30);
    }


    /* ══════════════════════════════════════════
       LINE FILTER POPULATION
    ══════════════════════════════════════════ */

    function populateLineFilter() {
        const lines = [...new Set(allSprings.map(s => s.line_id).filter(Boolean))].sort();
        lineFilter.innerHTML = '<option value="">All Lines</option>';
        lines.forEach(l => {
            const opt = document.createElement("option");
            opt.value = l; opt.textContent = l;
            lineFilter.appendChild(opt);
        });
    }

    function populateDynamicFilters() {
        const stressNos = [...new Set(allSprings.map(s => s.stress_system).filter(Boolean))].sort();
        stressFilter.innerHTML = '<option value="">All Stress Sys</option>';
        stressNos.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v; opt.textContent = v;
            stressFilter.appendChild(opt);
        });

        const users = [...new Set(allSprings.map(s => s.created_by).filter(Boolean))].sort();
        addedByFilter.innerHTML = '<option value="">All Users</option>';
        users.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v; opt.textContent = v;
            addedByFilter.appendChild(opt);
        });
    }


    /* ══════════════════════════════════════════
       FILTER + SORT + RENDER
    ══════════════════════════════════════════ */

    function applyFilters() {
        const query = leSearchInput.value.trim().toLowerCase();
        const lineVal = lineFilter.value;
        const typeVal = typeFilter.value;
        const stressVal = stressFilter.value;
        const addedByVal = addedByFilter.value;

        // Status filter
        let data = activeFilter === "all"
            ? allSprings
            : allSprings.filter(s => s.status === activeFilter);

        // Search
        if (query) {
            data = data.filter(s =>
                (s.spring_tag || "").toLowerCase().includes(query) ||
                (s.line_id || "").toLowerCase().includes(query) ||
                (s.spring_type || "").toLowerCase().includes(query) ||
                (s.node_no || "").toLowerCase().includes(query)
            );
        }

        // Line filter
        if (lineVal) data = data.filter(s => s.line_id === lineVal);

        // Type filter
        if (typeVal) data = data.filter(s => s.spring_type === typeVal);

        // Stress System No filter
        if (stressVal) data = data.filter(s => s.stress_system === stressVal);

        // Added By filter
        if (addedByVal) data = data.filter(s => s.created_by === addedByVal);

        // Sort
        data.sort((a, b) => {
            let va = a[sortCol] ?? ""; let vb = b[sortCol] ?? "";
            if (typeof va === "string") va = va.toLowerCase();
            if (typeof vb === "string") vb = vb.toLowerCase();
            if (va < vb) return sortDir === "asc" ? -1 : 1;
            if (va > vb) return sortDir === "asc" ? 1 : -1;
            return 0;
        });

        filteredSprings = data;
        currentPage = 1;
        selectedIds.clear();
        updateSelectionBar();

        renderTable();
        renderPagination();
        resultCount.textContent = `${data.length} record${data.length !== 1 ? "s" : ""}`;
    }


    /* ══════════════════════════════════════════
       TABLE RENDER
    ══════════════════════════════════════════ */

    function renderTable() {
        leTableBody.innerHTML = "";

        const start = (currentPage - 1) * PAGE_SIZE;
        const page = filteredSprings.slice(start, start + PAGE_SIZE);

        if (page.length === 0) {
            leEmpty.style.display = "flex";
            selectAll.checked = false;
            return;
        }

        leEmpty.style.display = "none";

        page.forEach((s, idx) => {
            const tr = document.createElement("tr");
            if (selectedIds.has(s.id)) tr.classList.add("row-selected");

            tr.innerHTML = `
                <td class="td-check">
                    <input type="checkbox" class="row-checkbox" data-id="${s.id}" ${selectedIds.has(s.id) ? "checked" : ""}>
                </td>
                <td class="td-tag">${escHtml(s.spring_tag || "—")}</td>
                <td>${escHtml(s.line_id || "—")}</td>
                <td>${escHtml(s.unit_no || "—")}</td>
                <td><span class="type-badge">${escHtml(s.spring_type || "—")}</span></td>
                <td>${escHtml(s.figure || "—")}</td>
                <td>${escHtml(s.stress_system || "—")}</td>
                <td>${escHtml(s.quantity != null ? String(s.quantity) : "—")}</td>
                <td>${s.operating_load != null ? s.operating_load + " KG" : "—"}</td>
                <td><span class="status-pill ${s.status || ""}">${statusLabel(s.status)}</span></td>
                <td class="td-remarks" title="${escHtml(s.remarks || "")}">${escHtml(s.remarks || "—")}</td>
                <td class="td-added-by">${escHtml(s.created_by || "—")}</td>
                <td class="td-actions">
                    <button class="row-action-btn row-btn-view" data-id="${s.id}" title="View details">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    ${s.mr_no ? `
                    <span class="row-mr-lock" title="MR locked — ${escHtml(s.mr_no)}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    ` : s.status === 'approved' ? `
                    <button class="row-action-btn row-btn-disapprove" data-id="${s.id}" title="Disapprove">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
                    </button>
                    ` : `
                    <button class="row-action-btn row-btn-approve" data-id="${s.id}" title="Approve">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button class="row-action-btn row-btn-reject" data-id="${s.id}" title="Reject">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    `}
                </td>`;

            // Animate row in
            tr.style.animation = `fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) ${idx * 0.03}s both`;

            // Row click → detail modal (not on checkbox or action buttons)
            tr.addEventListener("click", function (e) {
                if (e.target.closest(".row-action-btn") || e.target.closest(".row-checkbox")) return;
                openSpringDetail(s);
            });

            // Checkbox
            const cb = tr.querySelector(".row-checkbox");
            cb.addEventListener("change", function () {
                if (this.checked) selectedIds.add(s.id);
                else selectedIds.delete(s.id);
                tr.classList.toggle("row-selected", this.checked);
                updateSelectionBar();
                updateSelectAllState();
            });

            // Inline action buttons
            tr.querySelector(".row-btn-view").addEventListener("click", () => openSpringDetail(s));
            if (!s.mr_no) {
                if (s.status === 'approved') {
                    tr.querySelector(".row-btn-disapprove")?.addEventListener("click", (e) => { e.stopPropagation(); quickAction("disapprove", [s.id]); });
                } else {
                    tr.querySelector(".row-btn-approve")?.addEventListener("click", (e) => { e.stopPropagation(); quickAction("approve", [s.id]); });
                    tr.querySelector(".row-btn-reject")?.addEventListener("click", (e) => { e.stopPropagation(); quickAction("reject", [s.id]); });
                }
            }

            leTableBody.appendChild(tr);
        });

        updateSelectAllState();
    }


    /* ══════════════════════════════════════════
       SELECT ALL
    ══════════════════════════════════════════ */

    selectAll.addEventListener("change", function () {
        const start = (currentPage - 1) * PAGE_SIZE;
        const page = filteredSprings.slice(start, start + PAGE_SIZE);
        page.forEach(s => {
            if (this.checked) selectedIds.add(s.id);
            else selectedIds.delete(s.id);
        });
        renderTable();
        updateSelectionBar();
    });

    function updateSelectAllState() {
        const start = (currentPage - 1) * PAGE_SIZE;
        const page = filteredSprings.slice(start, start + PAGE_SIZE);
        const allChecked = page.length > 0 && page.every(s => selectedIds.has(s.id));
        const anyChecked = page.some(s => selectedIds.has(s.id));
        selectAll.checked = allChecked;
        selectAll.indeterminate = !allChecked && anyChecked;
    }


    /* ══════════════════════════════════════════
       SELECTION BAR
    ══════════════════════════════════════════ */

    function updateSelectionBar() {
        const n = selectedIds.size;
        selectionBar.classList.toggle("hidden", n === 0);
        selectionCount.textContent = `${n} selected`;
    }

    selApproveBtn.addEventListener("click", () => quickAction("approve", [...selectedIds]));
    selRejectBtn.addEventListener("click", () => quickAction("reject", [...selectedIds]));

    selClearBtn.addEventListener("click", () => {
        selectedIds.clear();
        updateSelectionBar();
        renderTable();
    });


    /* ══════════════════════════════════════════
       SPRING DETAIL MODAL
    ══════════════════════════════════════════ */

    function openSpringDetail(s) {
        currentSpring = s;

        sdmTag.textContent = s.spring_tag || "—";
        sdmStatusPill.textContent = statusLabel(s.status);
        sdmStatusPill.className = `sdm-status-pill ${s.status || ""}`;

        // Piping grid
        const pipingFields = [
            ["Line ID", s.line_id],
            ["Unit No.", s.unit_no],
            ["Stress System", s.stress_system],
            ["Subline", s.subline],
            ["Area No.", s.area],
            ["Piping Class", s.piping_class],
            ["Line Size", s.line_size],
            ["Line Schedule", s.line_schedule],
            ["Insulation", s.insulation],
            ["Ins. Thickness", s.insulation_thickness != null ? s.insulation_thickness + " MM" : "—"],
            ["Design Temp", s.design_temp],
        ];
        renderSdmGrid(sdmPipingGrid, pipingFields);

        // Spring grid
        const springFields = [
            ["Type", s.spring_type],
            ["Figure", s.figure],
            ["Quantity", s.quantity],
            ["Node No.", s.node_no],
            ["Pipe Location", s.pipe_location_type === 'dummy' ? 'Dummy Pipe' : 'Main Line'],
            ["Pipe Size @ Spring", s.pipe_size_at_spring],
            ["Pipe Sch @ Spring", s.pipe_sch_at_spring],
            ["Dummy Pipe Material", s.dummy_pipe_material],
            ["Dimension", s.dimension],
            ["Travel UP", s.travel_up != null ? s.travel_up + " MM" : "—"],
            ["Travel DOWN", s.travel_down != null ? s.travel_down + " MM" : "—"],
            ["Max Vert UP", s.max_up != null ? s.max_up + " MM" : "—"],
            ["Max Vert DOWN", s.max_down != null ? s.max_down + " MM" : "—"],
            ["Horiz Axial", s.horiz_axial != null ? s.horiz_axial + " MM" : "—"],
            ["Horiz Trans.", s.horiz_trans != null ? s.horiz_trans + " MM" : "—"],
            ["Op. Load", s.operating_load != null ? s.operating_load + " KG" : "—"],
            ["Hydro Load", s.hydro_load != null ? s.hydro_load + " KG" : "—"],
        ];
        renderSdmGrid(sdmSpringGrid, springFields);

        // Image
        if (s.spring_type && s.figure) {
            const src = "spring_images/" + s.spring_type + "_" + s.figure + ".jpg";
            sdmImage.src = src;
            sdmImage.classList.remove("hidden");
            sdmImgPlaceholder.style.display = "none";
            sdmImage.onerror = () => {
                sdmImage.classList.add("hidden");
                sdmImgPlaceholder.style.display = "flex";
            };
        } else {
            sdmImage.classList.add("hidden");
            sdmImgPlaceholder.style.display = "flex";
        }

        const jeRemarksEl = document.getElementById("sdmJeRemarksText");
        if (jeRemarksEl) jeRemarksEl.textContent = s.remarks || "—";

        sdmRemarks.value = s.review_remarks || "";

        // Audit info
        const sdmAudit = document.getElementById("sdmAuditRow");
        if (sdmAudit) {
            const createdBy = s.created_by || "—";
            const reviewedBy = s.reviewed_by || "—";
            sdmAudit.innerHTML = `
                <div class="sdm-audit-field">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    <span class="sdm-audit-label">Added By</span>
                    <span class="sdm-audit-value">${escHtml(createdBy)}</span>
                </div>
                <div class="sdm-audit-field">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    <span class="sdm-audit-label">Reviewed By</span>
                    <span class="sdm-audit-value">${escHtml(reviewedBy)}</span>
                </div>`;
        }

        // Show disapprove button only for approved springs; hide Approve/Reject for approved
        // If MR is raised, all action buttons are hidden — spring is locked
        const isApproved = s.status === 'approved';
        const isMrLocked = !!s.mr_no;
        sdmApproveBtn.style.display    = (isMrLocked || isApproved)  ? 'none' : '';
        sdmRejectBtn.style.display     = (isMrLocked || isApproved)  ? 'none' : '';
        sdmDisapproveBtn.style.display = (isMrLocked || !isApproved) ? 'none' : '';

        // Show MR lock notice in the detail overlay
        let sdmMrNotice = document.getElementById("sdmMrNotice");
        if (!sdmMrNotice) {
            sdmMrNotice = document.createElement("div");
            sdmMrNotice.id = "sdmMrNotice";
            sdmMrNotice.className = "sdm-mr-notice";
            sdmDisapproveBtn.parentNode.insertBefore(sdmMrNotice, sdmDisapproveBtn);
        }
        if (isMrLocked) {
            sdmMrNotice.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> MR raised: <strong>${escHtml(s.mr_no)}</strong> — no further changes allowed.`;
            sdmMrNotice.style.display = "";
        } else {
            sdmMrNotice.style.display = "none";
        }

        springDetailModal.classList.remove("hidden");
        springDetailModal.style.display = "flex";
    }

    function renderSdmGrid(container, fields) {
        container.innerHTML = "";
        fields.forEach(([label, value]) => {
            const div = document.createElement("div");
            div.className = "sdm-field";
            div.innerHTML = `<span class="sdm-field-label">${label}</span><span class="sdm-field-value">${escHtml(value != null ? String(value) : "—")}</span>`;
            container.appendChild(div);
        });
    }


    // Close via 'X' button
    sdmClose.addEventListener("click", () => {
        springDetailModal.classList.add("hidden");
        springDetailModal.style.display = "none";
    });

    // Close via clicking background overlay
    springDetailModal.addEventListener("click", function (e) {
        if (e.target === springDetailModal) {
            springDetailModal.classList.add("hidden");
            springDetailModal.style.display = "none";
        }
    });

    // Action Buttons
    sdmApproveBtn.addEventListener("click", () => {
        if (!currentSpring) return;
        const remarks = sdmRemarks.value.trim();
        springDetailModal.classList.add("hidden");
        springDetailModal.style.display = "none"; // Added here
        quickAction("approve", [currentSpring.id], remarks);
    });

    sdmRejectBtn.addEventListener("click", () => {
        if (!currentSpring) return;
        const remarks = sdmRemarks.value.trim();
        springDetailModal.classList.add("hidden");
        springDetailModal.style.display = "none"; // Added here
        quickAction("reject", [currentSpring.id], remarks);
    });

    sdmDisapproveBtn.addEventListener("click", () => {
        if (!currentSpring) return;
        springDetailModal.classList.add("hidden");
        springDetailModal.style.display = "none";
        quickAction("disapprove", [currentSpring.id]);
    });



    /* ══════════════════════════════════════════
       QUICK ACTION (approve / reject)
       Always shows confirm modal first
    ══════════════════════════════════════════ */

    function quickAction(type, ids, remarks = "") {
        if (!ids || ids.length === 0) return;

        const labels = { approve: "Approve", reject: "Reject", disapprove: "Disapprove" };
        const icons = { approve: "✅", reject: "❌", disapprove: "↩️" };
        const confirmClasses = { approve: "confirm-approve", reject: "confirm-reject", disapprove: "confirm-disapprove" };

        const stateLabel = type === "disapprove" ? "pending (reverted to submitted)" : type + "d";

        pendingAction = { type, ids, remarks };

        confirmIcon.textContent = icons[type];
        confirmTitle.textContent = `${labels[type]} ${ids.length} Spring${ids.length > 1 ? "s" : ""}?`;
        confirmMsg.textContent = ids.length === 1
            ? `This will mark the selected spring as ${stateLabel}.`
            : `This will mark all ${ids.length} selected springs as ${stateLabel}.`;

        confirmOk.className = `btn-confirm ${confirmClasses[type]}`;
        confirmOk.textContent = `Yes, ${labels[type]}`;

        confirmModal.classList.remove("hidden");
        confirmModal.style.display = "flex";
    }

    confirmCancel.addEventListener("click", () => {
        confirmModal.classList.add("hidden");
        confirmModal.style.display = "none";
        pendingAction = null;
    });

    confirmModal.addEventListener("click", (e) => {
        if (e.target === confirmModal) {
            confirmModal.classList.add("hidden");
            confirmModal.style.display = "none"; pendingAction = null;
        }
    });

    confirmOk.addEventListener("click", async function () {
        if (!pendingAction) return;
        confirmModal.classList.add("hidden");
        confirmModal.style.display = "none";

        const { type, ids, remarks } = pendingAction;
        pendingAction = null;

        try {
            const reviewed_by = localStorage.getItem("employee_id") ||
                (JSON.parse(localStorage.getItem("assignments") || "[]")[0]?.employee_id) || "";
            // Fire requests in parallel
            await Promise.all(ids.map(id =>
                fetch(`/api/spring/${type}/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ remarks, reviewed_by })
                }).then(r => r.json())
            ));

            const label = type === "disapprove" ? "disapproved (reverted to pending)" : type + "d";
            showToast(`✅ ${ids.length} spring${ids.length > 1 ? "s" : ""} ${label} successfully`);

            selectedIds.clear();
            updateSelectionBar();
            await loadSprings();

        } catch (e) {
            console.error("Action error:", e);
            showToast("❌ Action failed — please try again");
        }
    });


    /* ══════════════════════════════════════════
       BULK APPROVE ALL PENDING
    ══════════════════════════════════════════ */

    bulkApproveBtn.addEventListener("click", function () {
        const pendingIds = allSprings.filter(s => s.status === "submitted").map(s => s.id);
        if (pendingIds.length === 0) { showToast("No pending springs to approve"); return; }
        quickAction("approve", pendingIds);
    });


    /* ══════════════════════════════════════════
       EXPORT CSV
    ══════════════════════════════════════════ */

    bulkExportBtn.addEventListener("click", function () {
        const approvedCount = allSprings.filter(s => s.status === "approved").length;
        if (approvedCount === 0) { showToast("No approved springs to export"); return; }
        document.getElementById("exportFormatModal").style.display = "flex";
    });

    function triggerDownload(url, toastMsg) {
        const link = document.createElement("a");
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(toastMsg);
        document.getElementById("exportFormatModal").style.display = "none";
    }

    document.getElementById("efModalClose")?.addEventListener("click", () => {
        document.getElementById("exportFormatModal").style.display = "none";
    });

    document.getElementById("efIpmcsBtn")?.addEventListener("click", function () {
        const jobNo  = localStorage.getItem("jobno")  || "";
        const unitNo = localStorage.getItem("unit")   || "";
        const approvedCount = allSprings.filter(s => s.status === "approved").length;
        triggerDownload(
            `/api/spring/export?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&aggregate=true`,
            `✅ Exporting ${approvedCount} spring${approvedCount !== 1 ? "s" : ""} — IPMCS format…`
        );
    });

    document.getElementById("efEilBtn")?.addEventListener("click", function () {
        const jobNo  = localStorage.getItem("jobno")  || "";
        const unitNo = localStorage.getItem("unit")   || "";
        const approvedCount = allSprings.filter(s => s.status === "approved").length;
        triggerDownload(
            `/api/spring/export-eil?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&aggregate=true`,
            `✅ Exporting ${approvedCount} spring${approvedCount !== 1 ? "s" : ""} — EIL format…`
        );
    });

    exportAllBtn?.addEventListener("click", function () {
        const jobNo  = localStorage.getItem("jobno") || "";
        const unitNo = localStorage.getItem("unit")  || "";
        if (!jobNo || !unitNo) { showToast("No job / unit selected"); return; }
        const link = document.createElement("a");
        link.href = `/api/spring/export-all?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&aggregate=true`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("✅ Exporting all springs…");
    });


    /* ══════════════════════════════════════════
       REFRESH
    ══════════════════════════════════════════ */

    refreshBtn.addEventListener("click", async function () {
        refreshBtn.classList.add("spinning");
        await loadSprings();
        setTimeout(() => refreshBtn.classList.remove("spinning"), 800);
    });


    /* ══════════════════════════════════════════
       SORT
    ══════════════════════════════════════════ */

    document.querySelectorAll(".th-sortable").forEach(th => {
        th.addEventListener("click", function () {
            const col = this.dataset.col;
            if (sortCol === col) sortDir = sortDir === "asc" ? "desc" : "asc";
            else { sortCol = col; sortDir = "asc"; }

            document.querySelectorAll(".th-sortable").forEach(h => h.classList.remove("sort-asc", "sort-desc"));
            this.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");

            applyFilters();
        });
    });


    /* ══════════════════════════════════════════
       FILTER PILLS
    ══════════════════════════════════════════ */

    filterPillsWrap.addEventListener("click", function (e) {
        const pill = e.target.closest(".filter-pill");
        if (!pill) return;
        filterPillsWrap.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        activeFilter = pill.dataset.status;
        applyFilters();
    });


    /* ══════════════════════════════════════════
       SEARCH & DROPDOWN FILTERS
    ══════════════════════════════════════════ */

    leSearchInput.addEventListener("input", function () {
        leSearchClear.classList.toggle("hidden", !this.value.trim());
        applyFilters();
    });

    leSearchClear.addEventListener("click", function () {
        leSearchInput.value = "";
        this.classList.add("hidden");
        applyFilters();
        leSearchInput.focus();
    });

    lineFilter.addEventListener("change", applyFilters);
    typeFilter.addEventListener("change", applyFilters);
    stressFilter.addEventListener("change", applyFilters);
    addedByFilter.addEventListener("change", applyFilters);


    /* ══════════════════════════════════════════
       PAGINATION
    ══════════════════════════════════════════ */

    function renderPagination() {
        const total = filteredSprings.length;
        const pages = Math.ceil(total / PAGE_SIZE);

        pagePrev.disabled = currentPage <= 1;
        pageNext.disabled = currentPage >= pages;

        pageNumbers.innerHTML = "";

        // Show up to 5 page numbers
        const range = [];
        let start = Math.max(1, currentPage - 2);
        let end = Math.min(pages, start + 4);
        if (end - start < 4) start = Math.max(1, end - 4);

        for (let i = start; i <= end; i++) range.push(i);

        range.forEach(n => {
            const btn = document.createElement("button");
            btn.className = `page-num${n === currentPage ? " active" : ""}`;
            btn.textContent = n;
            btn.addEventListener("click", () => { currentPage = n; renderTable(); renderPagination(); });
            pageNumbers.appendChild(btn);
        });
    }

    pagePrev.addEventListener("click", () => {
        if (currentPage > 1) { currentPage--; renderTable(); renderPagination(); }
    });

    pageNext.addEventListener("click", () => {
        const pages = Math.ceil(filteredSprings.length / PAGE_SIZE);
        if (currentPage < pages) { currentPage++; renderTable(); renderPagination(); }
    });


    /* ══════════════════════════════════════════
       UTILITIES
    ══════════════════════════════════════════ */

    function statusLabel(status) {
        const map = { submitted: "Pending", approved: "Approved", rejected: "Rejected" };
        return map[status] || status || "—";
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function showToast(message) {
        let t = document.getElementById("ssms-toast");
        if (t) t.remove();
        t = document.createElement("div");
        t.id = "ssms-toast";
        t.textContent = message;
        Object.assign(t.style, {
            position: "fixed", bottom: "32px", right: "40px",
            background: "#3b2e1e", color: "#f5f0e8", padding: "14px 24px",
            borderRadius: "10px", fontSize: "13px", fontFamily: "'DM Sans',sans-serif",
            fontWeight: "500", letterSpacing: "0.5px",
            boxShadow: "0 8px 32px rgba(59,46,30,0.35)", border: "1px solid rgba(212,169,106,0.3)",
            zIndex: "9999", opacity: "0", transform: "translateY(10px)",
            transition: "opacity 0.3s ease, transform 0.3s ease",
        });
        document.body.appendChild(t);
        requestAnimationFrame(() => requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; }));
        setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(10px)"; setTimeout(() => t.remove(), 350); }, 3000);
    }


    /* ══════════════════════════════════════════
       INIT
    ══════════════════════════════════════════ */
    /* ══════════════════════════════════════════
    FORCE HIDE MODALS ON LOAD  ✅ FIX
 ══════════════════════════════════════════ */

    function hideAllModalsOnLoad() {
        [jobModal, springDetailModal, confirmModal].forEach(m => {
            if (!m) return;
            m.classList.add("hidden");
            m.style.display = "none";
        });
    }

    // Call before anything else
    hideAllModalsOnLoad();

    // Add @keyframes fadeUp dynamically if not in CSS
    if (!document.querySelector("style[data-le-anim]")) {
        const s = document.createElement("style");
        s.setAttribute("data-le-anim", "1");
        s.textContent = `@keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}`;
        document.head.appendChild(s);
    }


    /* ══════════════════════════════════════════
       NOTES DRAWER
    ══════════════════════════════════════════ */

    const STANDARD_NOTES = [
        "In case of identical springs (like A/B/C/D etc), the data furnished is applicable for individual spring. Spring tag number legend: XXXX (Job number) – XXX (Unit number) – XX (VS/CS) – XXXX (Unique serial number).",
        "Refer EIL standards No. 7-44-00761/62/63/65/68/69/70/71/86 as applicable.",
        "Variable spring shall have max. 15% load variation based on operating load unless otherwise specified against remarks column. Vendor to provide the % load variation of the spring offered based on the operating load & the corresponding travel specified.",
        "Vendor to ensure that the spring will be suitable and will be able to provide the support load without leading to eccentric loading for the horizontal movement specified.",
        "For all the springs with clamp arrangement, an additional lock-nut shall be provided. Bolt length shall be suitably increased to accommodate the lock-nut.",
        "Spring constant, preset load & the % load variation of the spring shall be filled by spring vendor.",
        "Note 3 is not applicable wherever spring constant is specified against remarks column. Vendor shall offer the spring according to the applicable requirement.",
        "The tag no. specified in the spring schedule shall be used for tagging & marking as per the technical notes for spring assemblies.",
        "Vendor to ensure that clamps and other components are designed for maximum allowable load of spring wherever the size or load is not covered in EIL std. MOC of clamp & components shall be identical to pipe MOC or the material suitable for the intended design conditions.",
        "Spring shall be suitable for the travel range specified in the MR.",
        "Protection shield, if indicated in the support arrangement type drawing, shall be of the same MOC of the line pipe or shall be rolled from equivalent plate material. Thickness of protection shield shall be same as that of line pipe or 12 mm whichever is less.",
        "Protection shield indicated on elbow/bend shall be suitable & matching the curvature profile of the elbow/bend (1.5D radius & as per B-16.9, unless otherwise specified)."
    ];

    const notesDrawer   = document.getElementById("notesDrawer");
    const notesNavBtn   = document.getElementById("notesNavBtn");
    const notesCloseBtn = document.getElementById("notesClose");

    function renderStandardNotes() {
        const list = document.getElementById("notesStdList");
        if (!list || list.children.length) return;
        STANDARD_NOTES.forEach((text, i) => {
            const li = document.createElement("li");
            li.className = "notes-std-item";
            li.innerHTML = `<span class="notes-std-num">${i + 1}</span><span class="notes-std-text">${text}</span>`;
            list.appendChild(li);
        });
    }

    function openNotesDrawer() {
        if (!notesDrawer) return;
        notesDrawer.classList.add("drawer-open");
        if (notesNavBtn) notesNavBtn.classList.add("active");
        renderStandardNotes();
        loadCustomNotes();
    }

    function closeNotesDrawer() {
        if (!notesDrawer) return;
        notesDrawer.classList.remove("drawer-open");
        if (notesNavBtn) notesNavBtn.classList.remove("active");
    }

    if (notesNavBtn) {
        notesNavBtn.addEventListener("click", function () {
            notesDrawer.classList.contains("drawer-open") ? closeNotesDrawer() : openNotesDrawer();
        });
    }
    if (notesCloseBtn) notesCloseBtn.addEventListener("click", closeNotesDrawer);

    window.switchNotesTab = function (tab) {
        const stdTab     = document.getElementById("notesTabStd");
        const customTab  = document.getElementById("notesTabCustom");
        const stdPane    = document.getElementById("notesPaneStd");
        const customPane = document.getElementById("notesPaneCustom");
        if (tab === "std") {
            stdTab.classList.add("active");    customTab.classList.remove("active");
            stdPane.classList.remove("hidden-pane"); customPane.classList.add("hidden-pane");
        } else {
            customTab.classList.add("active"); stdTab.classList.remove("active");
            customPane.classList.remove("hidden-pane"); stdPane.classList.add("hidden-pane");
            loadCustomNotes();
        }
    };

    async function loadCustomNotes() {
        const jobNo  = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;
        try {
            const res  = await fetch(`/api/notes?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}`);
            const json = await res.json();
            renderCustomNotes(json.data || []);
        } catch (err) { console.error("Notes load error:", err); }
    }

    function renderCustomNotes(data) {
        const list  = document.getElementById("notesCustomList");
        const empty = document.getElementById("notesCustomEmpty");
        if (!list) return;
        list.querySelectorAll(".notes-custom-card").forEach(c => c.remove());
        if (!data.length) { if (empty) empty.style.display = "flex"; return; }
        if (empty) empty.style.display = "none";
        const myId   = localStorage.getItem("employee_id") || "";
        const myRole = localStorage.getItem("role") || "";
        data.forEach((note, idx) => {
            const card    = document.createElement("div");
            card.className = "notes-custom-card";
            const noteNum = STANDARD_NOTES.length + (note.note_number > 0 ? note.note_number : idx + 1);
            const dt      = new Date(note.created_at);
            const dateStr = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                          + " " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            const canEdit = note.created_by === myId || myRole === "LE";
            card.innerHTML = `
                <div class="notes-custom-card-body">
                    <span class="notes-std-num">${noteNum}</span>
                    <div class="notes-custom-card-text">${note.note_text.replace(/\n/g, "<br>")}</div>
                </div>
                <div class="notes-custom-card-footer">
                    <span class="notes-custom-card-meta">${note.created_by || "—"} &nbsp;·&nbsp; ${(note.role || "—").toUpperCase()} &nbsp;·&nbsp; ${dateStr}</span>
                    <div style="display:flex;gap:4px;">
                        ${canEdit ? `<button class="notes-edit-btn" data-id="${note.id}">Edit</button>` : ""}
                        ${canEdit ? `<button class="notes-del-btn" data-id="${note.id}">Delete</button>` : ""}
                    </div>
                </div>`;
            if (canEdit) {
                card.querySelector(".notes-edit-btn").addEventListener("click", function () {
                    const textDiv = card.querySelector(".notes-custom-card-text");
                    const currentText = note.note_text;
                    textDiv.innerHTML = `
                        <textarea class="notes-edit-textarea">${currentText}</textarea>
                        <div class="notes-edit-actions">
                            <button class="notes-save-btn">Save</button>
                            <button class="notes-cancel-btn">Cancel</button>
                        </div>`;
                    card.querySelector(".notes-cancel-btn").addEventListener("click", function () {
                        textDiv.innerHTML = currentText.replace(/\n/g, "<br>");
                    });
                    card.querySelector(".notes-save-btn").addEventListener("click", async function () {
                        const newText = card.querySelector(".notes-edit-textarea").value.trim();
                        if (!newText) { showToast("⚠️ Note cannot be empty"); return; }
                        try {
                            const res = await fetch(`/api/notes/${note.id}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ noteText: newText })
                            });
                            const json = await res.json();
                            if (!json.ok) throw new Error(json.error || "Save failed");
                            showToast("✅ Note updated");
                            await loadCustomNotes();
                        } catch (err) { showToast("❌ Failed to update note"); }
                    });
                });
                card.querySelector(".notes-del-btn").addEventListener("click", async function () {
                    if (!confirm("Delete this note?")) return;
                    try {
                        await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
                        showToast("🗑️ Note deleted");
                        await loadCustomNotes();
                    } catch (err) { showToast("❌ Failed to delete note"); }
                });
            }
            list.appendChild(card);
        });
    }

    const noteAddBtn = document.getElementById("noteAddBtn");
    if (noteAddBtn) {
        noteAddBtn.addEventListener("click", async function () {
            const input     = document.getElementById("noteAddInput");
            const text      = input?.value?.trim();
            if (!text) { showToast("⚠️ Please enter a note"); return; }
            const jobNo     = localStorage.getItem("jobno");
            const unitNo    = localStorage.getItem("unit");
            const createdBy = localStorage.getItem("employee_id") || "";
            const role      = localStorage.getItem("role") || "";
            try {
                const res  = await fetch("/api/notes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobNo, unitNo, noteText: text, createdBy, role })
                });
                const json = await res.json();
                if (!json.ok) throw new Error(json.error || "Save failed");
                input.value = "";
                showToast("✅ Note added");
                await loadCustomNotes();
            } catch (err) { console.error("Note add error:", err); showToast("❌ Failed to add note"); }
        });
    }

    /* ══════════════════════════════════════════
       LE SIDEBAR TAB SWITCHING
    ══════════════════════════════════════════ */

    window.switchLeSidebarTab = function (tab) {
        const leContent    = document.getElementById("leContent");
        const leVsPanel    = document.getElementById("leViewSpringsPanel");
        const leUgPanel    = document.getElementById("leUnitGroupsPanel");
        const leTabReview  = document.getElementById("leTabReview");
        const leTabView    = document.getElementById("leTabView");
        const leTabGroups  = document.getElementById("leTabGroups");
        const lePaneReview = document.getElementById("lePaneReview");
        const lePaneView   = document.getElementById("lePaneView");
        const lePaneGroups = document.getElementById("lePaneGroups");

        // Elements toggled between tabs
        const leTableWrap  = document.getElementById("leTableWrap");
        const lePagination = document.getElementById("lePagination");

        [leTabReview, leTabView, leTabGroups].forEach(t => t && t.classList.remove("active"));
        [lePaneReview, lePaneView, lePaneGroups].forEach(p => p && p.classList.add("le-hidden-pane"));
        leContent.style.display = "none";
        leVsPanel.style.display = "none";
        leUgPanel.style.display = "none";

        const lePageHeading    = document.getElementById("lePageHeading");
        const lePageSubheading = document.getElementById("lePageSubheading");
        const leHeaderRightReview = document.getElementById("leHeaderRightReview");
        const leHeaderRightView   = document.getElementById("leHeaderRightView");

        // Reset to review defaults (in case coming from view tab)
        [leTableWrap, lePagination].forEach(el => { if (el) el.style.display = ""; });
        if (leVsPanel) leVsPanel.style.display = "none";
        if (lePageHeading)    lePageHeading.textContent    = "Review & Approval";
        if (lePageSubheading) lePageSubheading.textContent = "Review submitted spring records and approve or reject.";
        if (leHeaderRightReview) leHeaderRightReview.style.display = "";
        if (leHeaderRightView)   leHeaderRightView.style.display   = "none";

        if (tab === "review") {
            leTabReview.classList.add("active");
            lePaneReview.classList.remove("le-hidden-pane");
            leContent.style.display = "";
        } else if (tab === "view") {
            leTabView.classList.add("active");
            lePaneReview.classList.remove("le-hidden-pane"); // keep stats + filters + bulk actions
            leContent.style.display = "";                    // keep full header + toolbar + selection bar
            // Swap heading and right-side actions for View Springs mode
            if (lePageHeading)    lePageHeading.textContent    = "Spring Schedule";
            if (lePageSubheading) lePageSubheading.textContent = "All springs for this Job & Unit";
            if (leHeaderRightReview) leHeaderRightReview.style.display = "none";
            if (leHeaderRightView)   leHeaderRightView.style.display   = "";
            // Hide review table/pagination; VS panel appears directly below toolbar
            [leTableWrap, lePagination].forEach(el => { if (el) el.style.display = "none"; });
            if (leVsPanel) leVsPanel.style.display = "";
            loadLeViewSpringsTable();
        } else if (tab === "groups") {
            leTabGroups.classList.add("active");
            lePaneGroups.classList.remove("le-hidden-pane");
            leUgPanel.style.display = "";
            initUnitGroupsPanel();
        }
    };


    /* ══════════════════════════════════════════
       UNIT GROUPS (Master Unit Mapping)
    ══════════════════════════════════════════ */

    let ugAllUnits     = [];   // unit_no list for the selected job
    let ugAllGroups    = [];   // [{ master_unit_no, members: [...] }]
    let ugEditingMaster = null;

    async function initUnitGroupsPanel() {
        const jobSelect = document.getElementById("ugJobSelect");
        if (!jobSelect) return;

        if (jobSelect.options.length <= 1) {
            try {
                const res = await fetch('/api/master/jobs');
                const json = await res.json();
                jobSelect.innerHTML = '<option value="">— Select Job No. —</option>';
                (json.data || []).forEach(j => {
                    const opt = document.createElement('option');
                    opt.value = j.job_no; opt.textContent = j.job_no;
                    jobSelect.appendChild(opt);
                });
            } catch (err) { console.error("ug loadJobs:", err); }
        }

        const sessionJob = localStorage.getItem("jobno");
        if (sessionJob && jobSelect.querySelector(`option[value="${sessionJob}"]`)) {
            jobSelect.value = sessionJob;
            await loadUnitGroupsForJob(sessionJob);
        }
    }

    document.getElementById("ugJobSelect")?.addEventListener("change", function () {
        document.getElementById("ugFormCard").style.display = "none";
        ugEditingMaster = null;
        if (this.value) loadUnitGroupsForJob(this.value);
        else { ugAllUnits = []; ugAllGroups = []; renderUnitGroupsTable([]); }
    });

    async function loadUnitGroupsForJob(jobNo) {
        try {
            const [unitsRes, groupsRes] = await Promise.all([
                fetch(`/api/master/units?jobNo=${encodeURIComponent(jobNo)}`),
                fetch(`/api/master/unit-groups?jobNo=${encodeURIComponent(jobNo)}`)
            ]);
            const unitsJson  = await unitsRes.json();
            const groupsJson = await groupsRes.json();
            ugAllUnits  = (unitsJson.data || []).map(u => u.unit_no);
            ugAllGroups = groupsJson.data || [];
            renderUnitGroupsTable(ugAllGroups);

            const sidebarCount = document.getElementById("ugSidebarCount");
            if (sidebarCount) sidebarCount.textContent = ugAllGroups.length;
        } catch (err) {
            console.error("loadUnitGroupsForJob:", err);
            showToast("❌ Could not load unit groups");
        }
    }

    function renderUnitGroupsTable(groups) {
        const tbody    = document.getElementById("ugTableBody");
        const emptyRow = document.getElementById("ugTableEmpty");
        if (!tbody) return;

        tbody.querySelectorAll("tr:not(#ugTableEmpty)").forEach(r => r.remove());

        if (groups.length === 0) {
            emptyRow.querySelector("span").textContent = ugAllUnits.length
                ? "No unit groups defined for this job yet"
                : "Select a Job No. to manage unit groups";
            emptyRow.style.display = "";
            return;
        }
        emptyRow.style.display = "none";

        groups.forEach((g, idx) => {
            const tr = document.createElement("tr");
            const memberChips = g.members.map(m =>
                `<span class="ug-member-chip${m === g.master_unit_no ? ' ug-member-chip-master' : ''}">${m}</span>`
            ).join(" ");
            tr.innerHTML = `
                <td class="ug-td-num">${idx + 1}</td>
                <td><span class="ug-tag-chip">${g.master_unit_no}</span></td>
                <td>${memberChips}</td>
                <td>
                    <button class="ug-row-btn ug-edit-btn" data-master="${g.master_unit_no}">Edit</button>
                    <button class="ug-row-btn ug-delete-btn" data-master="${g.master_unit_no}">Delete</button>
                </td>`;
            tbody.appendChild(tr);
        });

        tbody.querySelectorAll(".ug-edit-btn").forEach(btn => {
            btn.addEventListener("click", () => openUnitGroupForm(btn.dataset.master));
        });
        tbody.querySelectorAll(".ug-delete-btn").forEach(btn => {
            btn.addEventListener("click", () => deleteUnitGroup(btn.dataset.master));
        });
    }

    function openUnitGroupForm(masterUnitNo) {
        ugEditingMaster = masterUnitNo || null;
        const card         = document.getElementById("ugFormCard");
        const title         = document.getElementById("ugFormTitle");
        const masterSelect = document.getElementById("ugMasterSelect");
        const memberGrid   = document.getElementById("ugMemberGrid");

        title.textContent = ugEditingMaster ? `Edit Group — Master ${ugEditingMaster}` : "Create Unit Group";

        const masterOptions = document.getElementById("ugMasterUnitOptions");
        masterOptions.innerHTML = ugAllUnits.map(u => `<option value="${u}">`).join("");
        masterSelect.value    = ugEditingMaster || "";
        masterSelect.disabled = !!ugEditingMaster;

        const existingGroup   = ugAllGroups.find(g => g.master_unit_no === masterUnitNo);
        const selectedMembers = existingGroup ? existingGroup.members : [];

        // A unit belongs to exactly one master. If it's already a member of a
        // DIFFERENT group, disable it here — it must be removed from that group
        // first before it can join this one.
        const otherMasterOf = {};
        ugAllGroups.forEach(g => {
            if (g.master_unit_no === masterUnitNo) return;
            g.members.forEach(m => { otherMasterOf[m] = g.master_unit_no; });
        });

        memberGrid.innerHTML = ugAllUnits.map(u => {
            const checked  = selectedMembers.includes(u) ? "checked" : "";
            const disabled = otherMasterOf[u] ? "disabled" : "";
            const warn     = otherMasterOf[u] ? `<span class="ug-member-warn">already in Master ${otherMasterOf[u]}</span>` : "";
            const itemCls  = otherMasterOf[u] ? "ug-member-item ug-member-item-disabled" : "ug-member-item";
            return `<label class="${itemCls}"><input type="checkbox" value="${u}" ${checked} ${disabled}> ${u} ${warn}</label>`;
        }).join("");

        card.style.display = "";
    }

    document.getElementById("ugNewGroupBtn")?.addEventListener("click", () => openUnitGroupForm(null));
    document.getElementById("ugCancelBtn")?.addEventListener("click", () => {
        document.getElementById("ugFormCard").style.display = "none";
        ugEditingMaster = null;
    });

    document.getElementById("ugSaveBtn")?.addEventListener("click", async function () {
        const jobNo         = document.getElementById("ugJobSelect").value;
        const masterUnitNo  = document.getElementById("ugMasterSelect").value.trim();
        const memberUnitNos = Array.from(document.querySelectorAll("#ugMemberGrid input[type=checkbox]:checked")).map(cb => cb.value);

        if (!jobNo) { showToast("⚠ Select a Job No. first"); return; }
        if (!masterUnitNo) { showToast("⚠ Enter a master unit number"); return; }
        if (memberUnitNos.length === 0) { showToast("⚠ Select at least one member unit"); return; }

        try {
            const createdBy = localStorage.getItem("employee_id") || "";
            const res = await fetch('/api/master/unit-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobNo, masterUnitNo, memberUnitNos, createdBy })
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "Save failed");

            showToast("✅ Unit group saved");
            document.getElementById("ugFormCard").style.display = "none";
            ugEditingMaster = null;
            await loadUnitGroupsForJob(jobNo);
        } catch (err) {
            console.error("Save unit group error:", err);
            showToast("❌ Could not save unit group");
        }
    });

    async function deleteUnitGroup(masterUnitNo) {
        const jobNo = document.getElementById("ugJobSelect").value;
        if (!jobNo) return;
        if (!confirm(`Dissolve unit group "${masterUnitNo}"? Member units will become standalone again.`)) return;

        try {
            const res = await fetch(`/api/master/unit-groups/${encodeURIComponent(masterUnitNo)}?jobNo=${encodeURIComponent(jobNo)}`, {
                method: 'DELETE'
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "Delete failed");

            showToast("🗑️ Unit group dissolved");
            await loadUnitGroupsForJob(jobNo);
        } catch (err) {
            console.error("Delete unit group error:", err);
            showToast("❌ Could not dissolve unit group");
        }
    }


    /* ══════════════════════════════════════════
       LE VIEW SPRINGS TABLE
    ══════════════════════════════════════════ */

    async function loadLeViewSpringsTable() {
        const jobNo  = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;

        const jobEl  = document.getElementById("leVsPanelJob");
        const unitEl = document.getElementById("leVsPanelUnit");
        if (jobEl)  jobEl.textContent  = jobNo;
        if (unitEl) unitEl.textContent = unitNo;

        try {
            // LE sees only submitted springs (excludes JE drafts)
            const res  = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&excludeStatus=saved&aggregate=true`);
            const json = await res.json();
            updateAggregateBanner(json.meta, "leAggregateBannerVs", "leAggMasterUnitVs", "leAggMembersVs");
            renderLeViewSpringsTable(json.data || []);
        } catch (err) { console.error("LE VS table load error:", err); }
    }

    function renderLeViewSpringsTable(data) {
        const tbody      = document.getElementById("leVsTableBody");
        const emptyRow   = document.getElementById("leVsTableEmpty");
        const countBadge = document.getElementById("leVsCountBadge");
        const sideCount  = document.getElementById("leVsSidebarCount");

        tbody.querySelectorAll("tr:not(#leVsTableEmpty)").forEach(r => r.remove());

        const total = data.length;
        const label = total + " spring" + (total !== 1 ? "s" : "");
        countBadge.textContent = label;
        if (sideCount) sideCount.textContent = total;

        if (total === 0) { emptyRow.style.display = ""; return; }
        emptyRow.style.display = "none";

        data.forEach((s, idx) => {
            const orderStatus = s.order_status || "Not Ordered";
            const orderKey    = orderStatus.toLowerCase().replace(/\s+/g, "-");
            const orderBadge  = `<span class="le-vs-order-badge le-vs-order-${orderKey}">${orderStatus}</span>`;

            const isOrdered = orderStatus === "Ordered" || orderStatus === "Delivered";
            const actionCell = isOrdered
                ? `<button class="le-vs-vendor-btn" onclick="openLeVendorModal(${s.id},'${s.spring_tag}')">
                       <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                       Vendor Data
                   </button>`
                : `<span style="font-size:11px;color:rgba(59,46,30,.3);">—</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="le-vs-td-num">${idx + 1}</td>
                <td><span class="le-vs-tag-chip">${s.spring_tag || "—"}</span></td>
                <td>${s.line_id || "—"}</td>
                <td>${s.unit_no || "—"}</td>
                <td>${s.area || "—"}</td>
                <td><span class="le-vs-type-chip">${s.spring_type || "—"}</span>Fig.${s.figure || "—"} &times; ${s.quantity || "—"}</td>
                <td>${s.dimension != null ? s.dimension : "—"}</td>
                <td>${s.stress_system || "—"}</td>
                <td><span class="le-vs-added-by">${s.created_by || "—"}</span></td>
                <td class="le-vs-mr-cell">${s.mr_no || "—"}</td>
                <td>${orderBadge}</td>
                <td>${actionCell}</td>`;
            tbody.appendChild(tr);
        });
    }

    document.getElementById("leVsRefreshBtn")?.addEventListener("click", loadLeViewSpringsTable);


    /* ── LE MR Excel Upload ───────────────────────── */

    const leUploadBtn  = document.getElementById("leVsUploadMrBtn");
    const leMrInput    = document.getElementById("leMrExcelFileInput");

    leUploadBtn?.addEventListener("click", () => leMrInput?.click());

    leMrInput?.addEventListener("change", async function () {
        const file = this.files[0];
        if (!file) return;
        this.value = "";

        const jobNo  = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) { showToast("⚠️ No active Job/Unit session"); return; }

        leUploadBtn.disabled = true;
        leUploadBtn.textContent = "Uploading…";

        try {
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = e => resolve(e.target.result.split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const res  = await fetch("/api/spring/upload-mr-excel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobNo, unitNo, fileBase64: base64 })
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "Upload failed");

            showToast(json.updated > 0
                ? `✅ Updated ${json.updated} of ${json.total} springs`
                : `ℹ️ No matching springs found in the file`);
            await loadLeViewSpringsTable();

        } catch (err) {
            console.error("LE MR upload error:", err);
            showToast("❌ Upload failed: " + err.message);
        } finally {
            leUploadBtn.disabled = false;
            leUploadBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload MR Excel`;
        }
    });


    /* ── LE Vendor Data Modal ─────────────────────── */

    window.openLeVendorModal = async function (springId, tag) {
        document.getElementById("leVdSpringId").value         = springId;
        document.getElementById("leVdModalTag").textContent   = tag;
        document.getElementById("leVdRecordId").value         = "";
        ["leVdVendorName","leVdPoNo","leVdPoDate","leVdSpringDesignation","leVdSpringConstant","leVdPresetLoad","leVdLoadVariation","leVdRemarks"]
            .forEach(id => { document.getElementById(id).value = ""; });

        try {
            const res  = await fetch(`/api/spring/vendor-data/${springId}`);
            const json = await res.json();
            if (json.ok && json.data) {
                const d = json.data;
                document.getElementById("leVdRecordId").value          = d.id || "";
                document.getElementById("leVdVendorName").value        = d.vendor_name || "";
                document.getElementById("leVdPoNo").value              = d.po_no || "";
                document.getElementById("leVdPoDate").value            = d.po_date ? d.po_date.substring(0,10) : "";
                document.getElementById("leVdSpringDesignation").value = d.spring_designation || "";
                document.getElementById("leVdSpringConstant").value    = d.spring_constant || "";
                document.getElementById("leVdPresetLoad").value        = d.preset_load || "";
                document.getElementById("leVdLoadVariation").value     = d.load_variation || "";
                document.getElementById("leVdRemarks").value           = d.remarks || "";
            }
        } catch (err) { console.error("LE vendor fetch error:", err); }

        document.getElementById("leVendorModal").style.display = "flex";
    };

    function closeLeVendorModal() { document.getElementById("leVendorModal").style.display = "none"; }

    document.getElementById("leVdModalClose")?.addEventListener("click", closeLeVendorModal);
    document.getElementById("leVdCancelBtn")?.addEventListener("click", closeLeVendorModal);

    document.getElementById("leVendorDataForm")?.addEventListener("submit", async function (e) {
        e.preventDefault();
        const springId = document.getElementById("leVdSpringId").value;
        const recordId = document.getElementById("leVdRecordId").value;
        const payload  = {
            springId,
            vendorName:        document.getElementById("leVdVendorName").value.trim(),
            poNo:              document.getElementById("leVdPoNo").value.trim(),
            poDate:            document.getElementById("leVdPoDate").value || null,
            springDesignation: document.getElementById("leVdSpringDesignation").value.trim(),
            springConstant:    document.getElementById("leVdSpringConstant").value.trim(),
            presetLoad:        document.getElementById("leVdPresetLoad").value.trim(),
            loadVariation:     document.getElementById("leVdLoadVariation").value.trim(),
            remarks:           document.getElementById("leVdRemarks").value.trim(),
            createdBy:         localStorage.getItem("employee_id") || ""
        };
        try {
            const url    = recordId ? `/api/spring/vendor-data/${recordId}` : `/api/spring/vendor-data`;
            const method = recordId ? "PUT" : "POST";
            const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const json   = await res.json();
            if (!json.ok) throw new Error(json.error || "Save failed");
            showToast("✅ Vendor data saved");
            closeLeVendorModal();
        } catch (err) { console.error("LE vendor save error:", err); showToast("❌ Failed to save vendor data"); }
    });

})();