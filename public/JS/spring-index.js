(function () {
    /* ── Auth gate ── */
    const role        = localStorage.getItem("role");
    const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
    if (!role || assignments.length === 0) { window.location.href = "/Login.html"; return; }
    if (role !== "MAT") { window.location.href = "/dashboard.html"; return; }

    /* ── Hide non-MAT nav links ── */
    ["jeNavItem", "leNavItem"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    /* ── Navbar user info ── */
    const roleBadgeEl  = document.getElementById("roleBadge");
    const userAvatarEl = document.getElementById("userAvatar");
    const userNameEl   = document.getElementById("userNameDisplay");
    const name = localStorage.getItem("employee_name") || localStorage.getItem("employee_id") || "—";
    if (roleBadgeEl)  { roleBadgeEl.textContent = role; roleBadgeEl.className = "db-role-badge role-" + role.toLowerCase(); }
    if (userAvatarEl) userAvatarEl.textContent = name.slice(0, 2).toUpperCase();
    if (userNameEl)   userNameEl.textContent   = name;

    /* ── User dropdown ── */
    const userDropdown    = document.getElementById("userDropdown");
    const userChipTrigger = document.getElementById("userChipTrigger");
    if (userChipTrigger) {
        userChipTrigger.addEventListener("click", () => userDropdown.classList.toggle("open"));
        document.addEventListener("click", e => { if (!userDropdown.contains(e.target)) userDropdown.classList.remove("open"); });
    }
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "/Login.html";
    });

    /* ── Elements ── */
    const siJobSelect    = document.getElementById("siJobSelect");
    const siUnitsSection = document.getElementById("siUnitsSection");
    const siUnitsGrid    = document.getElementById("siUnitsGrid");
    const siSelectAllBtn = document.getElementById("siSelectAllBtn");
    const siExportEil    = document.getElementById("siExportEil");
    const siExportIpmcs  = document.getElementById("siExportIpmcs");
    const siStatus       = document.getElementById("siStatus");
    const siPlaceholder  = document.getElementById("siPlaceholder");
    const siSpringsCard  = document.getElementById("siSpringsCard");
    const siSpringsBody  = document.getElementById("siSpringsBody");
    const siSpringsCount = document.getElementById("siSpringsCount");
    const siSpringsEmpty = document.getElementById("siSpringsEmpty");
    const siSelectAllRows = document.getElementById("siSelectAllRows");
    const siStatApproved = document.getElementById("siStatApproved");
    const siStatMrd      = document.getElementById("siStatMrd");
    const siStatSelected = document.getElementById("siStatSelected");
    const siEilHint      = document.getElementById("siEilHint");
    const siMrIndexCard    = document.getElementById("siMrIndexCard");
    const siMrIndexBody    = document.getElementById("siMrIndexBody");
    const siMrIndexCount   = document.getElementById("siMrIndexCount");
    const siMrPlaceholder  = document.getElementById("siMrPlaceholder");
    const siMrSidebarList  = document.getElementById("siMrSidebarList");
    const siMrSidebarEmpty = document.getElementById("siMrSidebarEmpty");
    const siTabPrep        = document.getElementById("siTabPrep");
    const siTabMr          = document.getElementById("siTabMr");
    const siContentPanePrep = document.getElementById("siContentPanePrep");
    const siContentPaneMr   = document.getElementById("siContentPaneMr");
    const siSidebarPanePrep = document.getElementById("siSidebarPanePrep");
    const siSidebarPaneMr   = document.getElementById("siSidebarPaneMr");
    const siMrModal      = document.getElementById("siMrModal");
    const siMrInput      = document.getElementById("siMrInput");
    const siMrSubtitle   = document.getElementById("siMrSubtitle");
    const siMrCancel     = document.getElementById("siMrCancel");
    const siMrConfirm    = document.getElementById("siMrConfirm");
    const siDropModal        = document.getElementById("siDropModal");
    const siDropModalMsg     = document.getElementById("siDropModalMsg");
    const siDropModalCancel  = document.getElementById("siDropModalCancel");
    const siDropModalConfirm = document.getElementById("siDropModalConfirm");

    let selectedJob     = "";
    let allUnits        = [];
    let springsDebounce = null;
    let activeTab       = "prep"; /* "prep" | "mr" */

    /* ── Tab switching ── */
    function switchTab(tab) {
        activeTab = tab;
        const isPrepTab = tab === "prep";
        siTabPrep.classList.toggle("active",  isPrepTab);
        siTabMr.classList.toggle("active",   !isPrepTab);
        siSidebarPanePrep.style.display = isPrepTab ? "" : "none";
        siSidebarPaneMr.style.display   = isPrepTab ? "none" : "";
        siContentPanePrep.style.display  = isPrepTab ? "" : "none";
        siContentPaneMr.style.display    = isPrepTab ? "none" : "";
        if (!isPrepTab && selectedJob) loadMrIndex(selectedJob);
    }

    siTabPrep?.addEventListener("click", () => switchTab("prep"));
    siTabMr?.addEventListener("click",   () => switchTab("mr"));
    let selectedTags    = new Set();
    let totalSprings    = 0;
    let pendingDropTags = [];

    /* ── Helpers ── */
    function showStatus(msg, type = "info") {
        siStatus.textContent = msg;
        siStatus.className   = "si-status " + type;
    }
    function hideStatus() { siStatus.className = "si-status"; }

    function getCheckedUnits() {
        return [...siUnitsGrid.querySelectorAll("input[type=checkbox]:checked")]
            .map(cb => cb.value);
    }

    function updateExportBtns() {
        const enabled = selectedJob && getCheckedUnits().length > 0;
        siExportIpmcs.disabled = !enabled;
        /* EIL needs a selection — updated in updateSelectionCount */
        if (!enabled) siExportEil.disabled = true;
    }

    function showPlaceholder() {
        siPlaceholder.style.display = "";
        siSpringsCard.style.display = "none";
    }

    function hidePlaceholder() {
        siPlaceholder.style.display = "none";
        siSpringsCard.style.display = "";
    }

    /* ── Load jobs ── */
    async function loadJobs() {
        try {
            const res  = await fetch("/api/master/jobs");
            const json = await res.json();
            (json.data || []).forEach(row => {
                const opt = document.createElement("option");
                opt.value = row.job_no; opt.textContent = row.job_no;
                siJobSelect.appendChild(opt);
            });
        } catch { showStatus("Failed to load jobs", "error"); }
    }

    /* ── Load units for job ── */
    async function loadUnits(jobNo) {
        siUnitsGrid.innerHTML = '<span class="si-units-empty">Loading…</span>';
        siUnitsSection.style.display = "";
        allUnits = [];

        try {
            const res  = await fetch(`/api/master/units?jobNo=${encodeURIComponent(jobNo)}`);
            const json = await res.json();
            allUnits = (json.data || []).map(r => r.unit_no);
            renderUnitChips();
        } catch {
            siUnitsGrid.innerHTML = '<span class="si-units-empty">Failed to load units.</span>';
        }
        updateExportBtns();
    }

    function renderUnitChips() {
        siUnitsGrid.innerHTML = "";
        if (allUnits.length === 0) {
            siUnitsGrid.innerHTML = '<span class="si-units-empty">No units found for this job.</span>';
            return;
        }
        allUnits.forEach(u => {
            const label = document.createElement("label");
            label.className = "si-unit-chip";
            label.innerHTML = `<input type="checkbox" value="${u}"><span>${u}</span>`;
            label.querySelector("input").addEventListener("change", () => {
                updateSelectAllLabel();
                updateExportBtns();
                hideStatus();
                scheduleSpringsLoad();
            });
            siUnitsGrid.appendChild(label);
        });
        updateSelectAllLabel();
    }

    function updateSelectAllLabel() {
        const checked = getCheckedUnits().length;
        siSelectAllBtn.textContent = (checked === allUnits.length && allUnits.length > 0)
            ? "Deselect All" : "Select All";
    }

    /* ── Select All / Deselect All ── */
    siSelectAllBtn.addEventListener("click", () => {
        const checkboxes = siUnitsGrid.querySelectorAll("input[type=checkbox]");
        const allChecked = getCheckedUnits().length === allUnits.length;
        checkboxes.forEach(cb => cb.checked = !allChecked);
        updateSelectAllLabel();
        updateExportBtns();
        hideStatus();
        scheduleSpringsLoad();
    });

    /* ── Job select ── */
    siJobSelect.addEventListener("change", () => {
        selectedJob = siJobSelect.value;
        siExportEil.disabled = siExportIpmcs.disabled = true;
        showPlaceholder();
        resetStats();
        selectedTags.clear();
        updateSelectionCount();
        hideStatus();
        siMrIndexCard.style.display = "none";
        if (siMrPlaceholder) siMrPlaceholder.style.display = "";
        if (siMrSidebarList) siMrSidebarList.innerHTML = "";
        if (siMrSidebarEmpty) siMrSidebarEmpty.style.display = "";
        if (selectedJob) {
            loadUnits(selectedJob);
            loadMrIndex(selectedJob);
        } else {
            siUnitsSection.style.display = "none";
            siUnitsGrid.innerHTML = "";
            allUnits = [];
        }
    });

    function resetStats() {
        if (siStatApproved) siStatApproved.textContent = "—";
        if (siStatMrd)      siStatMrd.textContent      = "—";
        if (siStatSelected) siStatSelected.textContent = "—";
    }

    /* ── MR Index ── */
    async function loadMrIndex(jobNo) {
        try {
            const res  = await fetch(`/api/spring/mr-index?jobNo=${encodeURIComponent(jobNo)}`);
            const json = await res.json();
            renderMrIndex(json.data || []);
        } catch { /* silently ignore */ }
    }

    const siMrToggleAll = document.getElementById("siMrToggleAll");
    let mrAllExpanded = true;

    function renderMrIndex(rows) {
        /* Sidebar compact list */
        if (siMrSidebarEmpty) siMrSidebarEmpty.style.display = rows.length ? "none" : "";
        if (siMrSidebarList) {
            siMrSidebarList.innerHTML = rows.map(r => `
                <div class="si-mr-sidebar-item">
                    <span class="si-mr-sidebar-num">${escapeHtml(r.mr_no)}</span>
                    <span class="si-mr-sidebar-ct">${r.spring_count} spr.</span>
                </div>`).join("");
        }

        /* Main content pane */
        if (rows.length === 0) {
            siMrIndexCard.style.display  = "none";
            if (siMrPlaceholder) siMrPlaceholder.style.display = "";
            return;
        }
        if (siMrPlaceholder) siMrPlaceholder.style.display = "none";
        siMrIndexCard.style.display = "";
        siMrIndexCount.textContent  = `${rows.length} MR${rows.length !== 1 ? "s" : ""}`;
        mrAllExpanded = true;
        if (siMrToggleAll) siMrToggleAll.textContent = "Collapse All";

        const html = rows.map((r, gi) => {
            const groupId   = `mrg-${gi}`;
            const unitsList = (r.units || []).map(u => escapeHtml(u)).join(", ");
            const meta      = `${r.spring_count} spring${r.spring_count !== 1 ? "s" : ""}  ·  Units: ${unitsList}`;

            const mrNoEsc = escapeHtml(r.mr_no);
            const hdr = `
            <tr class="si-mr-group-hdr" data-group="${groupId}">
                <td colspan="9">
                    <div class="si-mr-group-inner">
                        <svg class="si-mr-group-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                        <span class="si-mr-group-num">${mrNoEsc}</span>
                        <span class="si-mr-group-meta">${meta}</span>
                        <button class="si-mr-drop-all-btn" data-mr-no="${mrNoEsc}" data-group="${groupId}" title="Non-bid: remove all springs from this MR">Drop Entire MR</button>
                    </div>
                </td>
            </tr>`;

            const springRows = (r.springs || []).map(s => {
                const stag = escapeHtml(s.spring_tag || "");
                return `
            <tr class="si-mr-spring-row" data-member="${groupId}" data-tag="${stag}">
                <td class="si-mr-spring-tag">${stag || "—"}</td>
                <td>${escapeHtml(s.unit_no || "—")}</td>
                <td>${escapeHtml(s.line_id || "—")}</td>
                <td><span class="si-mr-type-badge">${escapeHtml(s.spring_type || "—")}</span></td>
                <td>${escapeHtml(String(s.node_no ?? "—"))}</td>
                <td>${s.travel_up   != null ? s.travel_up   : "—"}</td>
                <td>${s.travel_down != null ? s.travel_down : "—"}</td>
                <td>${s.operating_load != null ? s.operating_load : "—"}</td>
                <td>
                    <button class="si-mr-drop-btn" data-tag="${stag}" data-mr-no="${mrNoEsc}" title="Non-bid: remove from MR">&#215;</button>
                </td>
            </tr>`;
            }).join("");

            return hdr + springRows;
        }).join("");

        siMrIndexBody.innerHTML = html;
    }

    /* Single delegated listener — survives re-renders; most-specific checks first */
    siMrIndexBody.addEventListener("click", e => {
        const dropBtn = e.target.closest(".si-mr-drop-btn");
        if (dropBtn) { e.stopPropagation(); openDropModal([dropBtn.dataset.tag], dropBtn.dataset.mrNo, false); return; }
        const dropAllBtn = e.target.closest(".si-mr-drop-all-btn");
        if (dropAllBtn) {
            e.stopPropagation();
            const groupId  = dropAllBtn.dataset.group;
            const tags = [...siMrIndexBody.querySelectorAll(`[data-member="${groupId}"][data-tag]`)]
                .map(r => r.dataset.tag).filter(Boolean);
            openDropModal(tags, dropAllBtn.dataset.mrNo, true);
            return;
        }
        const hdrRow = e.target.closest(".si-mr-group-hdr");
        if (hdrRow) toggleMrGroup(hdrRow);
    });

    function toggleMrGroup(hdrRow) {
        const groupId  = hdrRow.dataset.group;
        const chevron  = hdrRow.querySelector(".si-mr-group-chevron");
        const isOpen   = !chevron.classList.contains("collapsed");
        const memberRows = siMrIndexBody.querySelectorAll(`[data-member="${groupId}"]`);
        memberRows.forEach(r => r.classList.toggle("hidden", isOpen));
        chevron.classList.toggle("collapsed", isOpen);
    }

    siMrToggleAll?.addEventListener("click", () => {
        mrAllExpanded = !mrAllExpanded;
        siMrToggleAll.textContent = mrAllExpanded ? "Collapse All" : "Expand All";
        siMrIndexBody.querySelectorAll(".si-mr-group-hdr").forEach(hdrRow => {
            const groupId    = hdrRow.dataset.group;
            const chevron    = hdrRow.querySelector(".si-mr-group-chevron");
            const memberRows = siMrIndexBody.querySelectorAll(`[data-member="${groupId}"]`);
            memberRows.forEach(r => r.classList.toggle("hidden", !mrAllExpanded));
            chevron.classList.toggle("collapsed", !mrAllExpanded);
        });
    });

    /* ── Springs table ── */
    function scheduleSpringsLoad() {
        clearTimeout(springsDebounce);
        springsDebounce = setTimeout(() => {
            const units = getCheckedUnits();
            if (selectedJob && units.length > 0) {
                loadSprings(selectedJob, units);
            } else {
                showPlaceholder();
                resetStats();
            }
        }, 350);
    }

    async function loadSprings(jobNo, units) {
        hidePlaceholder();
        siSpringsEmpty.style.display = "none";
        siSpringsBody.innerHTML = `<tr><td colspan="11" class="si-table-loading"><span class="si-spinner"></span> Loading…</td></tr>`;
        try {
            const params = new URLSearchParams({ jobNo, unitNos: units.join(","), status: "approved" });
            const res  = await fetch(`/api/spring/list?${params}`);
            const json = await res.json();
            renderSprings(json.data || []);
        } catch {
            siSpringsBody.innerHTML = `<tr><td colspan="11" class="si-table-loading si-table-error">Failed to load springs.</td></tr>`;
        }
    }

    function renderSprings(rows) {
        selectedTags.clear();
        if (siSelectAllRows) siSelectAllRows.checked = false;
        totalSprings = rows.length;

        /* Update stats */
        const mrdCount = rows.filter(r => r.mr_no).length;
        if (siStatApproved) siStatApproved.textContent = rows.length;
        if (siStatMrd)      siStatMrd.textContent      = mrdCount;
        updateSelectionCount();

        if (rows.length === 0) {
            siSpringsBody.innerHTML = "";
            siSpringsEmpty.style.display = "";
            return;
        }
        siSpringsEmpty.style.display = "none";
        siSpringsBody.innerHTML = rows.map(r => {
            const tag   = r.spring_tag || "";
            const isMrd = !!r.mr_no;
            const mrCell = isMrd
                ? `<span class="si-mr-badge">${escapeHtml(r.mr_no)}</span>`
                : `<span style="opacity:.35">—</span>`;
            const cbAttrs = isMrd
                ? `disabled title="Already assigned to MR ${escapeHtml(r.mr_no)}"`
                : (selectedTags.has(tag) ? "checked" : "");
            return `
            <tr data-tag="${escapeHtml(tag)}"${isMrd ? ' class="si-row-mrd"' : ''}>
                <td class="si-check-td"><input type="checkbox" class="si-row-cb" data-tag="${escapeHtml(tag)}" ${cbAttrs}></td>
                <td class="si-tag-cell">${tag || "—"}</td>
                <td>${mrCell}</td>
                <td>${r.unit_no || "—"}</td>
                <td>${r.line_id || "—"}</td>
                <td><span class="si-type-badge">${r.spring_type || "—"}</span></td>
                <td>${r.node_no || "—"}</td>
                <td>${r.travel_up != null ? r.travel_up : "—"}</td>
                <td>${r.travel_down != null ? r.travel_down : "—"}</td>
                <td>${r.operating_load != null ? r.operating_load : "—"}</td>
                <td class="si-remarks-cell">${r.remarks ? escapeHtml(r.remarks) : "—"}</td>
            </tr>`;
        }).join("");
    }

    /* ── Row selection ── */
    siSpringsBody.addEventListener("change", e => {
        const cb = e.target.closest(".si-row-cb");
        if (!cb) return;
        const tag = cb.dataset.tag;
        if (cb.checked) selectedTags.add(tag);
        else            selectedTags.delete(tag);
        const tr = cb.closest("tr");
        if (tr) tr.classList.toggle("si-row-selected", cb.checked);
        syncSelectAllCheckbox();
        updateSelectionCount();
    });

    siSelectAllRows?.addEventListener("change", () => {
        const cbs = siSpringsBody.querySelectorAll(".si-row-cb:not(:disabled)");
        cbs.forEach(cb => {
            cb.checked = siSelectAllRows.checked;
            const tag = cb.dataset.tag;
            if (siSelectAllRows.checked) selectedTags.add(tag);
            else                         selectedTags.delete(tag);
            const tr = cb.closest("tr");
            if (tr) tr.classList.toggle("si-row-selected", cb.checked);
        });
        updateSelectionCount();
    });

    function syncSelectAllCheckbox() {
        const cbs     = [...siSpringsBody.querySelectorAll(".si-row-cb:not(:disabled)")];
        const checked = cbs.filter(c => c.checked).length;
        if (siSelectAllRows) {
            siSelectAllRows.indeterminate = checked > 0 && checked < cbs.length;
            siSelectAllRows.checked       = cbs.length > 0 && checked === cbs.length;
        }
    }

    function updateSelectionCount() {
        const n = selectedTags.size;
        if (siSpringsCount) {
            siSpringsCount.textContent = n > 0
                ? `${n} of ${totalSprings} selected`
                : `${totalSprings} spring${totalSprings !== 1 ? "s" : ""}`;
        }
        if (siStatSelected) siStatSelected.textContent = n > 0 ? n : (totalSprings > 0 ? "0" : "—");
        if (siEilHint) siEilHint.textContent = n > 0
            ? `${n} spring${n !== 1 ? "s" : ""} selected`
            : "Select springs from table";
        siExportEil.disabled = !(selectedJob && getCheckedUnits().length > 0 && n > 0);
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    /* ── Drop-from-MR modal ── */
    function openDropModal(tags, mrNo, isAll) {
        pendingDropTags = tags;
        const s = tags.length;
        const label = isAll
            ? `Remove all ${s} spring${s !== 1 ? "s" : ""} from MR ${mrNo}?`
            : `Remove spring ${escapeHtml(tags[0])} from MR ${mrNo}?`;
        if (siDropModalMsg) siDropModalMsg.textContent = label;
        if (siDropModal) siDropModal.style.display = "flex";
    }

    function closeDropModal() {
        pendingDropTags = [];
        if (siDropModal) siDropModal.style.display = "none";
    }

    siDropModalCancel?.addEventListener("click", closeDropModal);
    siDropModal?.addEventListener("click", e => { if (e.target === siDropModal) closeDropModal(); });

    siDropModalConfirm?.addEventListener("click", async () => {
        const tags = [...pendingDropTags];
        closeDropModal();
        if (!tags.length) return;
        try {
            const res  = await fetch("/api/spring/drop-mr", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ springTags: tags })
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "Unknown error");
            showStatus(`Removed ${tags.length} spring${tags.length !== 1 ? "s" : ""} from MR.`, "info");
        } catch (err) {
            showStatus("Failed to remove from MR: " + err.message, "error");
            return;
        }
        /* Refresh both views */
        if (selectedJob) {
            loadMrIndex(selectedJob);
            const units = getCheckedUnits();
            if (units.length > 0) loadSprings(selectedJob, units);
        }
    });

    /* ── MR Modal ── */
    function openMrModal() {
        const n = selectedTags.size;
        siMrSubtitle.textContent = `${n} spring${n !== 1 ? "s" : ""} selected. Enter the Material Requisition number for this export.`;
        siMrInput.value = "";
        siMrModal.style.display = "flex";
        siMrInput.focus();
    }

    function closeMrModal() {
        siMrModal.style.display = "none";
    }

    siMrCancel?.addEventListener("click", closeMrModal);

    siMrModal?.addEventListener("click", e => {
        if (e.target === siMrModal) closeMrModal();
    });

    siMrInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") siMrConfirm.click();
        if (e.key === "Escape") closeMrModal();
    });

    siMrConfirm?.addEventListener("click", async () => {
        const mrNo = siMrInput.value.trim();
        if (!mrNo) { siMrInput.focus(); siMrInput.style.borderColor = "#b94040"; return; }
        siMrInput.style.borderColor = "";
        closeMrModal();

        const tags  = [...selectedTags];
        const units = getCheckedUnits();

        /* Save MR number to DB against selected springs */
        try {
            await fetch("/api/spring/assign-mr", {
                method:  "PATCH",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ springTags: tags, mrNo })
            });
        } catch { /* non-blocking — export still proceeds */ }

        /* Trigger file download */
        const params = new URLSearchParams({
            jobNo:      selectedJob,
            unitNos:    units.join(","),
            springTags: tags.join(","),
            mrNo
        });
        const link = document.createElement("a");
        link.href  = `/api/spring/export-eil?${params}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showStatus(`MR ${mrNo} saved — exporting ${tags.length} spring${tags.length !== 1 ? "s" : ""}…`, "info");
        /* Refresh MR index and springs table to reflect new MR assignment */
        if (selectedJob) {
            loadMrIndex(selectedJob);
            const units = getCheckedUnits();
            if (units.length > 0) loadSprings(selectedJob, units);
        }
    });

    /* ── IPMCS export ── */
    siExportIpmcs.addEventListener("click", () => {
        const units = getCheckedUnits();
        if (!selectedJob || units.length === 0) {
            showStatus("Select a job and at least one unit first.", "error"); return;
        }
        showStatus("Preparing IPMCS export…", "info");
        const params = new URLSearchParams({ jobNo: selectedJob, unitNos: units.join(",") });
        const link   = document.createElement("a");
        link.href    = `/api/spring/export-all?${params}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => showStatus("IPMCS export started — check your downloads.", "info"), 800);
    });

    /* ── EIL button ── */
    siExportEil.addEventListener("click", () => {
        if (selectedTags.size === 0) {
            showStatus("Select at least one spring from the table, then click EIL Standard.", "error");
            return;
        }
        openMrModal();
    });

    /* ── Bid Upload ── */
    const siVendorName   = document.getElementById("siVendorName");
    const siBidFile      = document.getElementById("siBidFile");
    const siBidFileName  = document.getElementById("siBidFileName");
    const siBidUploadBtn = document.getElementById("siBidUploadBtn");
    const siBidStatus    = document.getElementById("siBidStatus");

    function showBidStatus(msg, type) {
        if (!siBidStatus) return;
        siBidStatus.textContent = msg;
        siBidStatus.className   = "si-bid-status " + (type || "");
    }

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    siBidFile?.addEventListener("change", () => {
        const f = siBidFile.files[0];
        if (siBidFileName) siBidFileName.textContent = f ? f.name : "Choose filled EIL Excel…";
        showBidStatus("", "");
    });

    siBidUploadBtn?.addEventListener("click", async () => {
        const vendor = siVendorName?.value.trim();
        const file   = siBidFile?.files[0];
        if (!selectedJob) { showBidStatus("Select a job first.", "error"); return; }
        if (!vendor)      { showBidStatus("Enter vendor name.", "error"); siVendorName?.focus(); return; }
        if (!file)        { showBidStatus("Choose an Excel file.", "error"); return; }

        showBidStatus("Uploading…", "info");
        siBidUploadBtn.disabled = true;

        try {
            const base64 = await fileToBase64(file);
            const res    = await fetch("/api/spring/upload-bid", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ vendorName: vendor, jobNo: selectedJob, fileBase64: base64 })
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "Upload failed");
            showBidStatus(`Saved ${json.processed} spring${json.processed !== 1 ? "s" : ""} for ${vendor}.`, "ok");
            siBidFile.value = "";
            if (siBidFileName) siBidFileName.textContent = "Choose filled EIL Excel…";
        } catch (err) {
            showBidStatus(err.message, "error");
        } finally {
            siBidUploadBtn.disabled = false;
        }
    });

    /* ── Init ── */
    loadJobs();
})();
