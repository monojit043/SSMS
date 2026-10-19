/* ============================================================
   SSMS — Spring Schedule Management System
   JS/details.js  |  Single unified form
   ============================================================ */

(function () {
    "use strict";

    let scene, camera, renderer, controls, springLine;
    let dynamicObjects = [];

    const role = localStorage.getItem("role");
    const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");

    if (!role || assignments.length === 0) {
        window.location.href = "/Login.html";
    }

    if (role !== "JE" && role !== "LE") {
        window.location.href = "/Login.html";
    };

    const logoutBtn = document.getElementById("logoutBtn");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", function () {
            localStorage.clear();
            window.location.href = "/Login.html";
        });
    }

    let _changingJobContext = false;

    const changeJobUnitBtn = document.getElementById("changeJobUnitBtn");
    if (changeJobUnitBtn) {
        changeJobUnitBtn.addEventListener("click", async function () {
            const dropdown = document.getElementById("userDropdown");
            if (dropdown) dropdown.classList.remove("open");

            // Refresh from server so any newly created master units show up
            // without requiring a fresh login.
            let assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
            const empId = getEmployeeId();
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
            _changingJobContext = true;
            openJobSelectionFromAssignments(assignments);
        });
    }

    // ── Populate navbar user info ──
    const _empId   = localStorage.getItem("employee_id") || "";
    const _empName = localStorage.getItem("employee_name") || _empId;
    const _avatarEl  = document.getElementById("userAvatar");
    const _nameEl    = document.getElementById("userNameDisplay");
    if (_avatarEl) {
        const _parts = _empName.trim().split(/\s+/);
        _avatarEl.textContent = _parts.length >= 2
            ? (_parts[0][0] + _parts[_parts.length - 1][0]).toUpperCase()
            : _empName.slice(0, 2).toUpperCase() || "JE";
    }
    if (_nameEl) _nameEl.textContent = _empName || "—";

    window.history.pushState(null, "", window.location.href);
    window.onpopstate = function () {
        window.history.pushState(null, "", window.location.href);
    };

    function getEmployeeId() {
        return localStorage.getItem("employee_id") ||
            (JSON.parse(localStorage.getItem("assignments") || "[]")[0]?.employee_id) || "";
    }

    let editingSpringId = null;
    let currentSpringList = [];
    let currentSpringIdx  = 0;
    let activeStatusFilter = null;
    let pipingData = {};
    let springData = {};
    let pipeLocationMode = 'main'; // 'main' | 'dummy'

    /* ══════════════════════════════════════════
       ELEMENT REFERENCES
    ══════════════════════════════════════════ */

    const jobModal = document.getElementById("jobModal");
    const jobForm = document.getElementById("jobForm");
    const modalJobNo = document.getElementById("modalJobNo");
    const modalUnitNo = document.getElementById("modalUnitNo");
    const sessionJobDisplay = document.getElementById("sessionJobDisplay");
    const sessionUnitDisplay = document.getElementById("sessionUnitDisplay");

    const tabEntry = document.getElementById("tabEntry");
    const tabView = document.getElementById("tabView");
    const paneEntry = document.getElementById("paneEntry");
    const paneView = document.getElementById("paneView");

    const tagDisplay = document.getElementById("tagDisplay");
    const navBadge = document.getElementById("navBadge");

    const springImage = document.getElementById("springImage");
    const previewPlaceholder = document.getElementById("previewPlaceholder");
    const arrPreviewType = document.getElementById("arrPreviewType");
    const arrPreviewFigure = document.getElementById("arrPreviewFigure");
    const arrTagTypeCode = document.getElementById("arrTagTypeCode");
    const arrTagGroup = document.getElementById("arrTagGroup");

    const springList = document.getElementById("springList");
    const springListEmpty = document.getElementById("springListEmpty");
    const springCountBadge = document.getElementById("springCountBadge");

    const masterForm = document.getElementById("masterForm");
    const springTypeSelect = document.getElementById("springType");
    const figureSelect = document.getElementById("figure");
    const springTagInput = document.getElementById("springTag");
    const copyBtn = document.getElementById("copyBtn");
    const resetFormBtn = document.getElementById("resetFormBtn");

    const lineHistoryDrawer = document.getElementById("lineHistoryDrawer");
    const lineHistoryTrigger = document.getElementById("lineHistoryTrigger");
    const lineHistoryClose = document.getElementById("lineHistoryClose");
    const lineHistoryList = document.getElementById("lineHistoryList");
    const lineHistoryEmpty = document.getElementById("lineHistoryEmpty");
    const lineHistoryMeta = document.getElementById("lineHistoryMeta");
    const triggerCount = document.getElementById("triggerCount");

    let recalcSpringEvaluator = () => {};   // set by initSpringEvaluator()

    const mainBody = document.querySelector(".main-body");
    const imagePanel = document.getElementById("imagePanel");
    const imagePanelToggle = document.getElementById("imagePanelToggle");
    const imagePanelTab = document.getElementById("imagePanelTab");

    const toggleBtn = document.getElementById('imagePanelToggle');
    const expandBtn = document.getElementById('imagePanelExpand');

    // Collapse
    toggleBtn.addEventListener('click', () => {
        mainBody.classList.toggle('panel-collapsed');
    });

    // Expand
    expandBtn.addEventListener('click', () => {
        mainBody.classList.remove('panel-collapsed');
    });


    /* ══════════════════════════════════════════
       IMAGE PANEL TOGGLE (retractable)
    ══════════════════════════════════════════ */

    let panelCollapsed = false;

    function toggleImagePanel() {
        panelCollapsed = !panelCollapsed;
        mainBody.classList.toggle("panel-collapsed", panelCollapsed);
        imagePanelTab.classList.toggle("hidden", !panelCollapsed);
    }

    if (imagePanelToggle) {
        imagePanelToggle.addEventListener("click", function (e) {
            e.stopPropagation();
            toggleImagePanel();
        });
    }

    if (imagePanelTab) {
        imagePanelTab.addEventListener("click", toggleImagePanel);
    }


    /* ══════════════════════════════════════════
       SPRING VIEW MODAL (eye button)
    ══════════════════════════════════════════ */

    const springViewModal = document.getElementById("springViewModal");
    const svmClose = document.getElementById("svmClose");

    function openSpringViewModal(entry) {
        if (!springViewModal) return;

        document.getElementById("svmTag").textContent = entry.spring_tag || "—";

        const badge = document.getElementById("svmStatusBadge");
        badge.textContent = entry.status || "—";
        badge.className = "svm-status-badge " + (entry.status || "");

        // Piping grid
        const pipingFields = [
            ["Line ID", entry.line_id],
            ["Stress System", entry.stress_system],
            ["Subline", entry.subline],
            ["Area No.", entry.area],
            ["Piping Class", entry.piping_class],
            ["Line Size", entry.line_size],
            ["Line Schedule", entry.line_schedule],
            ["Insulation", entry.insulation],
            ["Ins. Thickness", entry.insulation_thickness ? entry.insulation_thickness + " MM" : "—"],
            ["Design Temp", entry.design_temp],
        ];
        const pipingGrid = document.getElementById("svmPipingGrid");
        pipingGrid.innerHTML = "";
        pipingFields.forEach(([label, val]) => {
            const d = document.createElement("div");
            d.className = "svm-field";
            d.innerHTML = `<span class="svm-field-label">${label}</span><span class="svm-field-value">${val || "—"}</span>`;
            pipingGrid.appendChild(d);
        });

        // Spring grid
        const springFields = [
            ["Type", entry.spring_type],
            ["Figure", entry.figure],
            ["Quantity", entry.quantity],
            ["Node No.", entry.node_no],
            ["Spring on", entry.pipe_location_type === 'dummy' ? "Dummy Pipe" : "Main Line"],
            ["Pipe Size at Spring", entry.pipe_size_at_spring || "—"],
            ["Schedule at Spring", entry.pipe_sch_at_spring || "—"],
            ["Dummy Pipe Material", entry.pipe_location_type === 'dummy' ? (entry.dummy_pipe_material || "—") : "N/A"],
            ["Dimension", entry.dimension],
            ["Travel UP", entry.travel_up != null ? entry.travel_up + " MM" : "—"],
            ["Travel DOWN", entry.travel_down != null ? entry.travel_down + " MM" : "—"],
            ["Max Vert UP", entry.max_up != null ? entry.max_up + " MM" : "—"],
            ["Max Vert DOWN", entry.max_down != null ? entry.max_down + " MM" : "—"],
            ["Horiz Axial", entry.horiz_axial != null ? entry.horiz_axial + " MM" : "—"],
            ["Horiz Trans.", entry.horiz_trans != null ? entry.horiz_trans + " MM" : "—"],
            ["Op. Load", entry.operating_load != null ? entry.operating_load + " KG" : "—"],
            ["Hydro Load", entry.hydro_load != null ? entry.hydro_load + " KG" : "—"],
        ];
        const springGrid = document.getElementById("svmSpringGrid");
        springGrid.innerHTML = "";
        springFields.forEach(([label, val]) => {
            const d = document.createElement("div");
            d.className = "svm-field";
            d.innerHTML = `<span class="svm-field-label">${label}</span><span class="svm-field-value">${val || "—"}</span>`;
            springGrid.appendChild(d);
        });

        // Image
        const svmImg = document.getElementById("svmImage");
        const svmImgPH = document.getElementById("svmImgPlaceholder");
        if (entry.spring_type && entry.figure) {
            const src = "spring_images/" + entry.spring_type + "_" + entry.figure + ".jpg";
            svmImg.src = src;
            svmImg.classList.remove("hidden");
            svmImgPH.style.display = "none";
            svmImg.onerror = () => { svmImg.classList.add("hidden"); svmImgPH.style.display = "flex"; };
        } else {
            svmImg.classList.add("hidden");
            svmImgPH.style.display = "flex";
        }

        // Remarks
        const svmRemarksRow = document.getElementById("svmRemarksRow");
        const svmRemarksText = document.getElementById("svmRemarksText");
        if (svmRemarksRow && svmRemarksText) {
            const hasRemarks = entry.remarks && entry.remarks.trim();
            svmRemarksText.textContent = hasRemarks ? entry.remarks.trim() : "";
            svmRemarksRow.style.cssText = hasRemarks
                ? "display:flex !important;"
                : "display:none !important;";
        }

        // Added By
        const svmCreatedByEl = document.getElementById("svmCreatedBy");
        if (svmCreatedByEl) {
            svmCreatedByEl.textContent = entry.created_by || "—";
        }

        springViewModal.classList.remove("hidden");
    }

    if (svmClose) {
        svmClose.addEventListener("click", () => springViewModal.classList.add("hidden"));
    }
    if (springViewModal) {
        springViewModal.addEventListener("click", function (e) {
            if (e.target === springViewModal) springViewModal.classList.add("hidden");
        });
    }

    /* ══════════════════════════════════════════
       PIPE LOCATION TOGGLE  (Main Line vs Dummy Pipe)
    ══════════════════════════════════════════ */

    function applyPipeLocationMode(mode) {
        pipeLocationMode = mode;

        const pltMain    = document.getElementById("pltMain");
        const pltDummy   = document.getElementById("pltDummy");
        const pipeSizeEl = document.getElementById("pipeSizeAtSpring");
        const pipeSchEl  = document.getElementById("pipeSchAtSpring");
        const dummyMatEl = document.getElementById("dummyMaterial");
        const dummyGrp   = document.getElementById("dummyMatGroup");
        const dummyBadge = document.getElementById("dummyMatBadge");

        if (!pltMain || !pltDummy || !pipeSizeEl || !pipeSchEl) return;

        if (mode === 'main') {
            pltMain.classList.add("active");
            pltDummy.classList.remove("active");

            // Auto-fill from piping details and lock
            pipeSizeEl.value    = document.getElementById("lineSize")?.value || "";
            pipeSchEl.value     = document.getElementById("lineSchedule")?.value || "";
            pipeSizeEl.readOnly = true;
            pipeSchEl.readOnly  = true;

        } else {
            pltDummy.classList.add("active");
            pltMain.classList.remove("active");

            // Clear so user must enter dummy pipe dimensions explicitly
            pipeSizeEl.value       = "";
            pipeSchEl.value        = "";
            pipeSizeEl.readOnly    = false;
            pipeSchEl.readOnly     = false;
            pipeSizeEl.placeholder = "e.g. 6 inch";
            pipeSchEl.placeholder  = "e.g. SCH 40";
        }

        updateSectionStatus();
    }

    {
        const pltMain  = document.getElementById("pltMain");
        const pltDummy = document.getElementById("pltDummy");
        if (pltMain)  pltMain.addEventListener("click",  () => applyPipeLocationMode('main'));
        if (pltDummy) pltDummy.addEventListener("click", () => applyPipeLocationMode('dummy'));
    }

    // Alert when dummy pipe size equals line size (field 06)
    {
        const pipeSizeEl = document.getElementById("pipeSizeAtSpring");
        if (pipeSizeEl) {
            pipeSizeEl.addEventListener("change", () => {
                if (pipeLocationMode !== 'dummy') return;
                const lineSize  = (document.getElementById("lineSize")?.value || "").trim().toLowerCase();
                const dummySize = pipeSizeEl.value.trim().toLowerCase();
                if (lineSize && dummySize && lineSize === dummySize) {
                    showToast(`⚠️ Dummy pipe size "${pipeSizeEl.value.trim()}" is the same as the Line Size. Please verify.`, "warn");
                }
            });
        }
    }

    // Keep pipe size/schedule in sync when main pipe fields change (main mode only)
    ["lineSize", "lineSchedule"].forEach(srcId => {
        const el = document.getElementById(srcId);
        if (!el) return;
        el.addEventListener("input", () => {
            if (pipeLocationMode !== 'main') return;
            if (srcId === "lineSize")     document.getElementById("pipeSizeAtSpring").value = el.value;
            if (srcId === "lineSchedule") document.getElementById("pipeSchAtSpring").value  = el.value;
            updateSectionStatus();
        });
        el.addEventListener("change", () => {
            if (pipeLocationMode !== 'main') return;
            if (srcId === "lineSize")     document.getElementById("pipeSizeAtSpring").value = el.value;
            if (srcId === "lineSchedule") document.getElementById("pipeSchAtSpring").value  = el.value;
            updateSectionStatus();
        });
    });

    /* ══════════════════════════════════════════
       STRESS LINES
    ══════════════════════════════════════════ */

    let stressLineData = [];
    // Literal unit the currently selected line actually belongs to — only
    // ever differs from the session unit when the session unit is a master.
    let currentLineUnit = null;
    // The full set of literal units in scope for the current session (just the
    // session unit itself, or the whole group when the session unit is a master).
    let currentScopeMembers = [];
    // Same as above but with the virtual master unit itself excluded — the only
    // valid set of units a NEW line can actually be attributed to.
    let currentRealUnits = [];

    // Field 04 (Area / Zone): when PIMS has zones for the line (lines.line_no = <line id>-<zone>),
    // offer them in a dropdown; otherwise keep the plain box. The box (#area) always holds the
    // value that is saved — the dropdown just writes into it.
    let zoneRequest = 0;
    let zoneLineId = null;   // line whose zones the dropdown currently shows
    function showZoneDropdown(zones) {
        const areaEl = document.getElementById("area");
        const sel = document.getElementById("areaSelect");
        if (!areaEl || !sel) return;
        if (!zones || !zones.length) {
            sel.hidden = true; sel.disabled = true;
            areaEl.hidden = false;
            return;
        }
        // Keep a value already on the spring (editing) even if PIMS no longer lists it
        const current = (areaEl.value || "").trim().toUpperCase();
        const list = current && !zones.includes(current) ? [...zones, current] : zones;
        sel.innerHTML = `<option value="">Select zone…</option>` + list.map(z =>
            `<option value="${z}">${z}${zones.includes(z) ? "" : " (saved — not in PIMS)"}</option>`).join("");
        sel.value = current || (zones.length === 1 ? zones[0] : "");
        areaEl.value = sel.value;
        areaEl.readOnly = true;          // validation checks the dropdown instead
        areaEl.hidden = true;
        sel.hidden = false; sel.disabled = false;
        updateSectionStatus();
    }

    function loadLineZones(lineId) {
        const req = ++zoneRequest;
        const jobNo = localStorage.getItem("jobno") || "", unitNo = localStorage.getItem("unit") || "";
        fetch(`/api/master/line-zones?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&lineId=${encodeURIComponent(lineId)}`)
            .then(r => r.json())
            .then(json => {
                if (req !== zoneRequest) return;                  // a newer line was picked meanwhile
                const stillSame = (document.getElementById("dia")?.value || "") === lineId;
                if (json.ok && stillSame) { showZoneDropdown(json.data); zoneLineId = json.data.length ? lineId : null; }
            })
            .catch(() => {});                                     // PIMS unavailable — box stays
    }

    document.getElementById("areaSelect")?.addEventListener("change", e => {
        const areaEl = document.getElementById("area");
        if (areaEl) areaEl.value = e.target.value;
        updateSectionStatus();
    });

    // Applies a line selection: fills stress system, updates history & status
    function applyLineSelection(lineId, skipTagRegen) {
        const match = stressLineData.find(l => l.line_id === lineId);
        const stressInput = document.getElementById("stressSystem");

        if (match && match.is_critical === false) {
            // Non-critical lines have no enforced stress system — let JE type one if known.
            stressInput.value = match.stress_system || "";
            stressInput.readOnly = false;
            stressInput.placeholder = "Optional — type if known";
        } else {
            stressInput.value = match ? (match.stress_system || "") : "";
            stressInput.readOnly = true;
            stressInput.placeholder = "Auto-filled";
        }

        // Auto-fill Area/Zone from the trailing single-letter zone in the line ID
        // e.g. CL-101-02404-A → A,  P-101-12345-B → B
        // Read-only when zone is detected; editable when line has no zone suffix.
        const zoneMatch = (lineId || "").match(/-([A-Za-z])$/);
        const areaEl = document.getElementById("area");
        // Same line re-applied (e.g. the Line ID box losing focus) — keep the zone list and choice
        const sameZoneLine = !skipTagRegen && !!lineId && lineId === zoneLineId && !document.getElementById("areaSelect")?.hidden;
        if (areaEl && !sameZoneLine) {
            showZoneDropdown(null);   // back to the plain box until this line's zones are known
            zoneLineId = null;
            if (zoneMatch) {
                if (!skipTagRegen) areaEl.value = zoneMatch[1].toUpperCase();
                areaEl.readOnly = true;
                areaEl.style.background = "";   // let CSS handle readonly look
            } else {
                if (!skipTagRegen) areaEl.value = "";  // clear stale zone from previous line
                areaEl.readOnly = false;
                if (lineId) loadLineZones(lineId);   // PIMS zones → dropdown
            }
        }

        // Auto-fill piping spec fields from the ePULSE line list on PC-1 (new spring only)
        if (!skipTagRegen) {
            // Clear immediately so stale values from a previously selected line don't linger
            ['pipingclass', 'lineSize', 'insulation', 'insulationThickness', 'designtemp'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        }
        // "Not in line list" caution — shown only when the lookup ran and found nothing
        const llCaution = document.getElementById("cautionLineList");
        if (llCaution) llCaution.classList.add("hidden");
        if (!skipTagRegen && lineId) {
            fetch(`/api/master/line-spec?lineId=${encodeURIComponent(lineId)}&jobNo=${encodeURIComponent(localStorage.getItem("jobno") || "")}`)
                .then(r => r.json())
                .then(json => {
                    if (json.ok && !json.data && llCaution &&
                        (document.getElementById("dia")?.value || "") === lineId) {
                        llCaution.classList.remove("hidden");
                    }
                    if (!json.ok || !json.data) return;
                    const d = json.data;
                    const set = (id, val) => {
                        const el = document.getElementById(id);
                        if (el && val != null && val !== '') el.value = val;
                    };
                    set('pipingclass',          d.piping_class);
                    set('lineSize',             d.line_size);
                    set('insulation',           d.insulation);
                    set('insulationThickness',  d.insulation_thickness);
                    set('designtemp',           d.design_temp);
                    generateTag();          // refresh tag after fields change
                    updateSectionStatus();
                })
                .catch(() => {});           // silent — PIMS may be unavailable
        }

        // Resolve the line's real literal unit (only meaningful when the
        // session unit is a master). Falls back to the session unit otherwise.
        currentLineUnit = match ? (match.unit_no || null) : null;

        updateLineHistory(lineId || "");
        updateSectionStatus();
        // Skipped when restoring an existing spring for edit — that flow sets
        // the spring's own correct tag itself right after this call, and an
        // unawaited generateTag() resolving later would otherwise overwrite it.
        if (!skipTagRegen) generateTag();
    }

    // Populates combobox dropdown with a filtered list
    function renderComboOptions(list, emptyMessage) {
        const dropdown = document.getElementById("diaDropdown");
        if (!dropdown) return;
        dropdown.innerHTML = "";
        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "combobox-option no-results";
            empty.textContent = emptyMessage || "No matches found";
            dropdown.appendChild(empty);
            return;
        }
        list.forEach(line => {
            const div = document.createElement("div");
            div.className = "combobox-option";
            div.dataset.value = line.line_id;

            const textSpan = document.createElement("span");
            textSpan.textContent = line.line_id;
            div.appendChild(textSpan);

            if (line.is_critical === false) {
                const badge = document.createElement("span");
                badge.className = "combobox-badge-noncritical";
                badge.textContent = "Non-Critical";
                div.appendChild(badge);
            }

            div.addEventListener("mousedown", function (e) {
                e.preventDefault(); // keep focus on input
                selectComboLine(line.line_id);
            });
            dropdown.appendChild(div);
        });
    }

    function selectComboLine(lineId) {
        const input = document.getElementById("dia");
        const dropdown = document.getElementById("diaDropdown");
        input.value = lineId;
        dropdown.classList.remove("open");
        applyLineSelection(lineId);
    }

    async function loadStressLines(jobNo, unitNo) {
        try {
            const res = await fetch(`/api/master/stress-lines?jobNo=${jobNo}&unitNo=${unitNo}&aggregate=true`);
            const json = await res.json();
            stressLineData = json.data || [];
            currentScopeMembers = (json.meta && json.meta.members) ? json.meta.members : [unitNo];
            // The virtual master itself is never a valid literal unit for a new line.
            currentRealUnits = (json.meta && json.meta.aggregated)
                ? currentScopeMembers.filter(u => u !== json.meta.masterUnitNo)
                : currentScopeMembers;
        } catch (err) { console.error("Failed to load stress lines:", err); }
    }

    // ── Combobox event handlers ──────────────────────────────
    {
        const diaInput    = document.getElementById("dia");
        const diaDropdown = document.getElementById("diaDropdown");
        const diaToggle   = document.getElementById("diaToggle");
        let hlIdx = -1;

        function openDiaDropdown(filter) {
            const q = (filter || "").trim().toLowerCase();
            const list = q
                ? stressLineData.filter(l => l.line_id.toLowerCase().includes(q))
                : stressLineData;
            const emptyMessage = stressLineData.length === 0
                ? "No lines yet for this unit — type a line ID to add one"
                : "No matches found";
            renderComboOptions(list, emptyMessage);
            diaDropdown.classList.add("open");
            hlIdx = -1;
        }

        function closeDiaDropdown() {
            diaDropdown.classList.remove("open");
            hlIdx = -1;
        }

        function moveHighlight(dir) {
            const opts = diaDropdown.querySelectorAll(".combobox-option:not(.no-results)");
            if (!opts.length) return;
            hlIdx = Math.max(0, Math.min(hlIdx + dir, opts.length - 1));
            opts.forEach((o, i) => o.classList.toggle("highlighted", i === hlIdx));
            opts[hlIdx].scrollIntoView({ block: "nearest" });
        }

        diaInput.addEventListener("input", function () {
            openDiaDropdown(this.value);
            if (!this.value) applyLineSelection("");
        });

        diaInput.addEventListener("focus", function () {
            openDiaDropdown(this.value);
        });

        diaInput.addEventListener("blur", function () {
            // Delay so mousedown on an option fires first
            setTimeout(async () => {
                const typed = diaInput.value.trim();
                const exact = stressLineData.find(l => l.line_id === typed);

                if (exact) {
                    closeDiaDropdown();
                    applyLineSelection(typed);
                } else if (!typed) {
                    closeDiaDropdown();
                    applyLineSelection("");
                } else {
                    await handleUnmatchedLine(typed);
                }
            }, 160);
        });

        // Typed a line not found in the current scope — check the rest of the
        // job before assuming it's genuinely new (catches "wrong unit" mistakes).
        async function handleUnmatchedLine(typed) {
            const jobNo = localStorage.getItem("jobno");
            const excludeUnits = (currentScopeMembers.length ? currentScopeMembers : [localStorage.getItem("unit")]).join(",");

            try {
                const res = await fetch(`/api/master/line-lookup?jobNo=${encodeURIComponent(jobNo)}&lineId=${encodeURIComponent(typed)}&excludeUnits=${encodeURIComponent(excludeUnits)}`);
                const json = await res.json();

                if (json.ok && json.found) {
                    showToast(`⚠ Line "${typed}" already exists in Job ${jobNo}, Unit ${json.unitNo} (${json.isCritical ? "critical" : "non-critical"}). Switch units to use it.`);
                    closeDiaDropdown();
                    diaInput.value = ""; // reject the value — leaving it would let an unattributed line slip into the save
                    applyLineSelection("");
                } else {
                    renderAddNewLineUI(typed);
                }
            } catch (err) {
                console.error("handleUnmatchedLine error:", err);
                closeDiaDropdown();
            }
        }

        // Renders an inline "no line found anywhere in this job — add it as
        // non-critical?" affordance inside the dropdown.
        function renderAddNewLineUI(typed) {
            diaDropdown.innerHTML = "";

            const wrap = document.createElement("div");
            wrap.className = "combobox-add-new";

            const msg = document.createElement("p");
            msg.className = "combobox-add-msg";
            msg.textContent = `No line "${typed}" found anywhere in this job.`;
            wrap.appendChild(msg);

            const row = document.createElement("div");
            row.className = "combobox-add-row";

            let unitSelectEl = null;
            if (currentRealUnits.length > 1) {
                const label = document.createElement("label");
                label.textContent = "Add under unit:";
                row.appendChild(label);

                unitSelectEl = document.createElement("select");
                unitSelectEl.className = "combobox-add-unit-select";
                currentRealUnits.forEach(u => {
                    const opt = document.createElement("option");
                    opt.value = u; opt.textContent = u;
                    unitSelectEl.appendChild(opt);
                });
                row.appendChild(unitSelectEl);
            } else {
                const fixedUnit = currentRealUnits[0] || localStorage.getItem("unit");
                const span = document.createElement("span");
                span.className = "combobox-add-fixed-unit";
                span.textContent = `under Unit ${fixedUnit}`;
                row.appendChild(span);
            }

            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "combobox-add-btn";
            addBtn.textContent = "+ Add Line";
            addBtn.addEventListener("mousedown", function (e) {
                e.preventDefault(); // keep dropdown open through the click
                const targetUnit = unitSelectEl ? unitSelectEl.value : (currentRealUnits[0] || localStorage.getItem("unit"));
                registerNonCriticalLine(typed, targetUnit);
            });
            row.appendChild(addBtn);

            wrap.appendChild(row);
            diaDropdown.appendChild(wrap);
            diaDropdown.classList.add("open");
        }

        // Real line IDs follow PREFIX-UNITNO-NUMBER (e.g. FL-208-5401). If the typed
        // line's embedded unit segment looks numeric and doesn't match the target
        // unit, it's very likely a typo/wrong-unit mistake — confirm before adding.
        function embeddedUnitOf(lineId) {
            const parts = String(lineId || "").split("-");
            if (parts.length < 2) return null;
            const seg = parts[1].trim();
            return /^\d{2,4}$/.test(seg) ? seg : null;
        }

        async function registerNonCriticalLine(lineId, unitNo, force) {
            if (!force) {
                const embeddedUnit = embeddedUnitOf(lineId);
                if (embeddedUnit && embeddedUnit !== unitNo) {
                    const proceed = confirm(
                        `"${lineId}" looks like it belongs to Unit ${embeddedUnit}, not Unit ${unitNo}.\n\nAdd it under Unit ${unitNo} anyway?`
                    );
                    if (!proceed) return;
                    force = true;
                }
            }

            const jobNo = localStorage.getItem("jobno");
            const createdBy = getEmployeeId();
            try {
                const res = await fetch('/api/master/non-critical-lines', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobNo, unitNo, lineId, stressSystem: null, createdBy, force: !!force })
                });
                const json = await res.json();

                if (!json.ok && json.mismatch) {
                    // Defense-in-depth fallback — shouldn't normally trigger since the
                    // client already checked, but honor the server's verdict if it differs.
                    const proceedAnyway = confirm(json.error + "\n\nAdd it anyway?");
                    if (!proceedAnyway) return;
                    return registerNonCriticalLine(lineId, unitNo, true);
                }
                if (!json.ok) throw new Error(json.error || "Failed to add line");

                stressLineData.push({ line_id: lineId, stress_system: null, unit_no: unitNo, is_critical: false });
                diaInput.value = lineId;
                applyLineSelection(lineId);
                closeDiaDropdown();
                showToast(`✅ Added "${lineId}" as a new non-critical line under Unit ${unitNo}`);
            } catch (err) {
                console.error("registerNonCriticalLine error:", err);
                showToast("❌ Could not add line");
            }
        }

        diaInput.addEventListener("keydown", function (e) {
            const opts = diaDropdown.querySelectorAll(".combobox-option:not(.no-results)");
            if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); }
            else if (e.key === "Enter" && hlIdx >= 0 && opts[hlIdx]) {
                e.preventDefault();
                selectComboLine(opts[hlIdx].dataset.value);
            } else if (e.key === "Escape") { closeDiaDropdown(); }
        });

        diaToggle.addEventListener("mousedown", function (e) {
            e.preventDefault();
            if (diaDropdown.classList.contains("open")) {
                closeDiaDropdown();
            } else {
                diaInput.focus();
                openDiaDropdown(diaInput.value);
            }
        });

        document.addEventListener("click", function (e) {
            if (!e.target.closest("#diaComboWrap")) closeDiaDropdown();
        });
    }
    // ────────────────────────────────────────────────────────

    // ── Material combobox ────────────────────────────────────
    {
        const PIPE_MATERIALS = [
            "ASTM A 106 GR.B",
            "A672GR.B60 CL.12 (200 BHN MAX)",
            "ASTM A 672 GR.B60 CL.12",
            "ASTM A 672 GR.B60 CL.22",
            "ASTM A 312 TP316L",
            "ASTM A 358 TP316L CL.1",
            "ASTM A 312 TP304",
            "ASTM A 358 TP304 CL.1",
            "ASTM A 312 TP316",
            "ASTM A 358 TP316 CL.1",
            "SA-106/SA-106M GR.B",
            "IS-3589 GR.410",
            "ASTM A312 GR.TP316/316L DUAL",
            "ASTM A358 TP316/316L CL.1 DUAL",
            "ASTM A312 GR.TP304/304L",
            "ASTM A358 TP304/304L CL.1",
            "ASTM A 333 GR.6",
            "ASTM A 671 GR.CC60 CL.32",
            "ASTM A 106 GR.B  (PE COATED)",
            "IS-3589 GR.410 (PE COATED)",
            "ASTM A 672 GR.B60 CL.32",
            "ASTM A 312 TP304L",
            "ASTM A 358 TP304L CL.1",
            "ASTM A 790 (UNS S32750)",
            "ASTM A 335 GR.P11",
            "ASTM A 691 GR.1.25CR CL.42",
            "ASTM D1784 CL 23447",
            "A672GR.B60 CL.12 (PE COATED)",
            "ASTM A 335 GR.P22",
            "ASTM A 691 GR2.25CR CL.42",
            "ASTM A 312 TP321H",
            "ASTM A 358 TP 321H CL.1",
            "ASTM A 312 TP321",
            "ASTM A 358 TP321 CL.1",
            "SA-335/SA-335M GR.P22",
            "SA-312/SA-312M TP316",
            "ASTM A 335 GR.P91",
            "ASTM A 691 GR.P91 CL.42",
            "ASTM A 106 GR.B(GALV)"
        ];

        const matInput    = document.getElementById("dummyMaterial");
        const matDropdown = document.getElementById("matDropdown");
        const matToggle   = document.getElementById("matToggle");
        let matHlIdx = -1;

        function renderMatOptions(list) {
            matDropdown.innerHTML = "";
            if (!list.length) {
                const empty = document.createElement("div");
                empty.className = "combobox-option no-results";
                empty.textContent = "No matches found";
                matDropdown.appendChild(empty);
                return;
            }
            list.forEach(mat => {
                const div = document.createElement("div");
                div.className = "combobox-option";
                div.textContent = mat;
                div.dataset.value = mat;
                div.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    matInput.value = mat;
                    closeMatDropdown();
                    matInput.dispatchEvent(new Event("change"));
                });
                matDropdown.appendChild(div);
            });
        }

        function openMatDropdown(filter) {
            const q = (filter || "").trim().toLowerCase();
            const list = q ? PIPE_MATERIALS.filter(m => m.toLowerCase().includes(q)) : PIPE_MATERIALS;
            renderMatOptions(list);
            matDropdown.classList.add("open");
            matHlIdx = -1;
        }

        function closeMatDropdown() {
            matDropdown.classList.remove("open");
            matHlIdx = -1;
        }

        function moveMatHighlight(dir) {
            const opts = matDropdown.querySelectorAll(".combobox-option:not(.no-results)");
            if (!opts.length) return;
            matHlIdx = Math.max(0, Math.min(matHlIdx + dir, opts.length - 1));
            opts.forEach((o, i) => o.classList.toggle("highlighted", i === matHlIdx));
            opts[matHlIdx].scrollIntoView({ block: "nearest" });
        }

        matInput.addEventListener("input", function () { openMatDropdown(this.value); });
        matInput.addEventListener("focus", function () { openMatDropdown(this.value); });
        matInput.addEventListener("blur", function () {
            setTimeout(() => {
                closeMatDropdown();
                // If typed value doesn't match any material exactly, clear it
                if (matInput.value && !PIPE_MATERIALS.includes(matInput.value)) {
                    matInput.value = "";
                }
            }, 160);
        });
        matInput.addEventListener("keydown", function (e) {
            const opts = matDropdown.querySelectorAll(".combobox-option:not(.no-results)");
            if (e.key === "ArrowDown") { e.preventDefault(); moveMatHighlight(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); moveMatHighlight(-1); }
            else if (e.key === "Enter" && matHlIdx >= 0 && opts[matHlIdx]) {
                e.preventDefault();
                matInput.value = opts[matHlIdx].dataset.value;
                closeMatDropdown();
                matInput.dispatchEvent(new Event("change"));
            } else if (e.key === "Escape") { closeMatDropdown(); }
        });
        matToggle.addEventListener("mousedown", function (e) {
            e.preventDefault();
            if (matDropdown.classList.contains("open")) {
                closeMatDropdown();
            } else {
                matInput.focus();
                openMatDropdown(matInput.value);
            }
        });
        document.addEventListener("click", function (e) {
            if (!e.target.closest("#matComboWrap")) closeMatDropdown();
        });
    }
    // ────────────────────────────────────────────────────────


    /* ══════════════════════════════════════════
       JOB / UNIT MODAL
    ══════════════════════════════════════════ */


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
            if (typeof loadSubmittedSprings === "function") {
                loadSubmittedSprings(jobNo, unitNo);
            }

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

            if (typeof loadSubmittedSprings === "function") {
                loadSubmittedSprings(a.job_no, a.unit_no);
            }

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

        jobModal.classList.remove("modal-hidden");
        jobModal.style.display = "flex";
    }

    jobForm.addEventListener("submit", function (e) {
        e.preventDefault();
        const job = modalJobNo.value, unit = modalUnitNo.value;
        if (!job || !unit) return;
        localStorage.setItem("jobno", job);
        localStorage.setItem("unit", unit);
        currentLineUnit = null;
        closeModal(job, unit);
        generateTag();
        loadStressLines(job, unit);
        updateLineHistory("");
        if (_changingJobContext) {
            _changingJobContext = false;
            if (typeof switchSidebarTab === "function") switchSidebarTab("view");
        }
    });

    function closeModal(job, unit) {
        sessionJobDisplay.textContent = job;
        sessionUnitDisplay.textContent = unit;
        jobModal.classList.add("modal-hidden");
        setTimeout(() => { jobModal.style.display = "none"; }, 320);
        renderSpringList();
    }


    /* ══════════════════════════════════════════
       SIDEBAR TABS
    ══════════════════════════════════════════ */

    window.switchSidebarTab = function (tab) {
        const mainBody  = document.getElementById("mainBody");
        const vsPanel   = document.getElementById("viewSpringsPanel");
        if (tab === "entry") {
            tabEntry.classList.add("active"); tabView.classList.remove("active");
            paneEntry.classList.remove("hidden-pane"); paneView.classList.add("hidden-pane");
            mainBody.style.display = "";
            vsPanel.style.display  = "none";
        } else {
            tabView.classList.add("active"); tabEntry.classList.remove("active");
            paneView.classList.remove("hidden-pane"); paneEntry.classList.add("hidden-pane");
            mainBody.style.display = "none";
            vsPanel.style.display  = "";
            renderSpringList();
            loadViewSpringsTable();
        }
    };


    /* ══════════════════════════════════════════
       SECTION STATUS INDICATORS
    ══════════════════════════════════════════ */

    function updateSectionStatus() {
        const lineFields = ["dia", "subline", "area"];
        const pipeFields = ["pipingclass", "lineSize", "lineSchedule", "insulation", "designtemp"]; // insulationThickness is optional — not tracked for section status
        const arrFields = ["springType", "figure", "quantity", "nodeNo", "pipeSizeAtSpring", "pipeSchAtSpring"];
        const dimFields = ["dimension", "maxVertUp", "maxVertDown", "horizAxial", "horizTransverse"];
        const loadFields = ["operatingLoad"];

        function allFilled(ids) {
            return ids.every(id => { const el = document.getElementById(id); return el && el.value && el.value.trim() !== ""; });
        }

        const tUp = document.getElementById("travelUp");
        const tDn = document.getElementById("travelDown");
        const travelOk = (tUp && tUp.value.trim()) || (tDn && tDn.value.trim());

        ["ssLine", "ssPipe", "ssArrangement", "ssDimension", "ssLoad"].forEach((id, i) => {
            const groups = [lineFields, pipeFields, arrFields, dimFields, loadFields];
            const el = document.getElementById(id);
            if (!el) return;
            if (id === "ssDimension") {
                el.classList.toggle("filled", allFilled(groups[i]) && travelOk);
            } else {
                el.classList.toggle("filled", allFilled(groups[i]));
            }
        });
    }

    masterForm.querySelectorAll("input, select").forEach(el => {
        el.addEventListener("change", updateSectionStatus);
        el.addEventListener("input", updateSectionStatus);
    });


    /* ══════════════════════════════════════════
       DIMENSIONAL PARAMETER RULES
    ══════════════════════════════════════════ */

    // 1-decimal-place enforcer for travel/max-vert fields
    function enforceOneDecimal(el) {
        el.addEventListener("input", function () {
            const v = this.value;
            // Strip anything beyond 1 decimal digit
            const m = v.match(/^-?\d*\.?\d{0,1}/);
            if (m && m[0] !== v) this.value = m[0];
        });
    }
    ["travelUp", "travelDown", "maxVertUp", "maxVertDown", "horizAxial", "horizTransverse"].forEach(id => {
        const el = document.getElementById(id);
        if (el) enforceOneDecimal(el);
    });

    // Mutual exclusivity: travelUp ↔ travelDown
    const _travelUp   = document.getElementById("travelUp");
    const _travelDown = document.getElementById("travelDown");
    const _groupUp    = document.getElementById("travelUpGroup");
    const _groupDown  = document.getElementById("travelDownGroup");

    function applyTravelMutex(filledEl, pairedEl, pairedGroup) {
        const hasFilled = filledEl.value.trim() !== "";
        pairedEl.disabled = hasFilled;
        if (hasFilled) {
            pairedEl.value = "";
            pairedGroup && pairedGroup.classList.add("travel-disabled");
        } else {
            pairedGroup && pairedGroup.classList.remove("travel-disabled");
        }
        updateSectionStatus();
    }

    if (_travelUp && _travelDown) {
        _travelUp.addEventListener("input",  () => applyTravelMutex(_travelUp,   _travelDown, _groupDown));
        _travelUp.addEventListener("change", () => applyTravelMutex(_travelUp,   _travelDown, _groupDown));
        _travelDown.addEventListener("input",  () => applyTravelMutex(_travelDown, _travelUp, _groupUp));
        _travelDown.addEventListener("change", () => applyTravelMutex(_travelDown, _travelUp, _groupUp));
    }

    // Min 5 mm caution for maxVert fields
    function checkMinTravel(inputEl, cautionId) {
        const caution = document.getElementById(cautionId);
        if (!caution) return;
        const val = parseFloat(inputEl.value);
        const bad = inputEl.value === "" || isNaN(val) || val < 5;
        caution.classList.toggle("hidden", !bad);
    }

    const _maxVertUp   = document.getElementById("maxVertUp");
    const _maxVertDown = document.getElementById("maxVertDown");
    if (_maxVertUp) {
        _maxVertUp.addEventListener("input", () => checkMinTravel(_maxVertUp, "cautionMaxUp"));
        _maxVertUp.addEventListener("blur",  () => checkMinTravel(_maxVertUp, "cautionMaxUp"));
    }
    if (_maxVertDown) {
        _maxVertDown.addEventListener("input", () => checkMinTravel(_maxVertDown, "cautionMaxDown"));
        _maxVertDown.addEventListener("blur",  () => checkMinTravel(_maxVertDown, "cautionMaxDown"));
    }

    // Dimension must be a multiple of 10 mm
    function checkDimensionMultiple(el) {
        const caution = document.getElementById("cautionDimension");
        if (!caution) return;
        const val = parseFloat(el.value);
        const bad = el.value === "" || isNaN(val) || val % 10 !== 0;
        caution.classList.toggle("hidden", !bad);
    }

    const _dimEl = document.getElementById("dimension");
    if (_dimEl) {
        _dimEl.addEventListener("input", () => checkDimensionMultiple(_dimEl));
        _dimEl.addEventListener("blur",  () => checkDimensionMultiple(_dimEl));
    }

    // Hydro load caution — always show when field is focused; also warn if filled value ≤ 2× op load
    function checkHydroLoadCaution() {
        const caution   = document.getElementById("cautionHydroLoad");
        const hydroEl   = document.getElementById("hydroLoad");
        if (!caution || !hydroEl) return;
        const opVal     = parseFloat(document.getElementById("operatingLoad")?.value);
        const hydroVal  = parseFloat(hydroEl.value);
        const isFocused = document.activeElement === hydroEl;
        // Show when: field is focused (blank or otherwise), OR when a value is entered but ≤ 2× op load
        const warn = isFocused || (!isNaN(hydroVal) && hydroEl.value !== "" && (!isNaN(opVal) ? hydroVal <= opVal * 2 : true));
        caution.classList.toggle("hidden", !warn);
    }

    const _hydroEl = document.getElementById("hydroLoad");
    const _opLoadEl = document.getElementById("operatingLoad");
    if (_hydroEl) {
        _hydroEl.addEventListener("focus", checkHydroLoadCaution);
        _hydroEl.addEventListener("input", checkHydroLoadCaution);
        _hydroEl.addEventListener("blur",  checkHydroLoadCaution);
    }
    if (_opLoadEl) {
        _opLoadEl.addEventListener("input", checkHydroLoadCaution);
    }


    /* ══════════════════════════════════════════
       IMAGE PREVIEW
    ══════════════════════════════════════════ */

    function updateImage() {
        const type = springTypeSelect ? springTypeSelect.value : "";
        const figure = figureSelect ? figureSelect.value : "";

        if (type && figure) {
            const src = "spring_images/" + type + "_" + figure + ".jpg";
            springImage.src = src;
            springImage.classList.remove("hidden");
            previewPlaceholder.style.display = "none";
            springImage.onerror = () => { springImage.classList.add("hidden"); previewPlaceholder.style.display = "flex"; };

            const csTypes = ["CS1", "CS2", "CS3", "CS4"];
            const typeCode = csTypes.includes(type) ? "CSH" : "VSH";
            const group = csTypes.includes(type) ? "Constant Spring" : "Variable Spring";
            if (arrPreviewType) arrPreviewType.textContent = type;
            if (arrPreviewFigure) arrPreviewFigure.textContent = "Figure " + figure;
            if (arrTagTypeCode) arrTagTypeCode.textContent = typeCode;
            if (arrTagGroup) arrTagGroup.textContent = group;
        } else {
            springImage.src = ""; springImage.classList.add("hidden");
            previewPlaceholder.style.display = "flex";
            if (arrPreviewType) arrPreviewType.textContent = "—";
            if (arrPreviewFigure) arrPreviewFigure.textContent = "Select type & figure";
            if (arrTagTypeCode) arrTagTypeCode.textContent = "—";
            if (arrTagGroup) arrTagGroup.textContent = "—";
        }
    }


    /* ══════════════════════════════════════════
       TAG GENERATION
    ══════════════════════════════════════════ */

    async function generateTag() {
        const jobNo = localStorage.getItem("jobno");
        const unit = localStorage.getItem("unit");
        const springType = springTypeSelect ? springTypeSelect.value : "";

        if (!jobNo || !unit || !springType) {
            if (springTagInput) springTagInput.value = "";
            if (tagDisplay) tagDisplay.textContent = "—";
            return;
        }
        // When the session unit is a master, the picked line determines the
        // real literal unit; before any line is picked, fall back to the session unit.
        const effectiveUnit = currentLineUnit || unit;
        try {
            const res = await fetch(`/api/spring/next-tag?jobNo=${jobNo}&unitNo=${effectiveUnit}&springType=${springType}`);
            const json = await res.json();
            const tag = json.tag;
            if (springTagInput) springTagInput.value = tag;
            if (tagDisplay) tagDisplay.textContent = tag;
            // keep copy banner in sync
            const copyNewTagEl = document.getElementById("copyNewTag");
            if (copyNewTagEl && copySourceBanner && !copySourceBanner.classList.contains("hidden")) {
                copyNewTagEl.textContent = tag;
            }

            const groupCaution = document.getElementById("tagGroupCaution");
            if (groupCaution) {
                if (json.meta && json.meta.grouped) {
                    document.getElementById("tagGroupLiteralUnit").textContent = json.meta.literalUnitNo;
                    document.getElementById("tagGroupMasterUnit").textContent  = json.meta.masterUnitNo;
                    groupCaution.classList.remove("hidden");
                } else {
                    groupCaution.classList.add("hidden");
                }
            }
        } catch (err) { console.error("Tag error:", err); }
    }


    /* ══════════════════════════════════════════
       COPY TAG (main form tag input button)
    ══════════════════════════════════════════ */

    if (copyBtn) {
        copyBtn.addEventListener("click", function () {
            const val = springTagInput.value;
            if (!val) return;
            navigator.clipboard.writeText(val).then(() => {
                copyBtn.classList.add("copied");
                copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                setTimeout(() => {
                    copyBtn.classList.remove("copied");
                    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
                }, 2000);
            }).catch(() => { springTagInput.select(); document.execCommand("copy"); });
        });
    }


    /* ══════════════════════════════════════════
       FORM SUBMIT — SAVE SPRING
    ══════════════════════════════════════════ */

    function toNumber(val) { return (val === "" || val == null) ? null : Number(val); }

    if (masterForm) {
        masterForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            if (!validateForm(masterForm)) return;
            if (!validateAngle()) return;   // 🔥 ADD THIS

            // Design-temp restriction: CS4/VS4 + Figure 1 blocked at ≥ 204 °C
            const _temp = parseTempValue(document.getElementById("designtemp")?.value);
            const _type = document.getElementById("springType")?.value;
            const _fig  = document.getElementById("figure")?.value;
            if (!isNaN(_temp) && _temp >= 204 && (_type === "CS4" || _type === "VS4") && _fig === "1") {
                showToast("❌ Figure 1 is not allowed for " + _type + " at ≥ 204 °C");
                return;
            }

            try {
                const jobNo = localStorage.getItem("jobno");
                // Always save against the real literal unit. When the session
                // unit is a master, the picked line resolved currentLineUnit.
                const unitNo = currentLineUnit || localStorage.getItem("unit");

                const payload = {
                    jobNo, unitNo,
                    line_id: document.getElementById("dia").value,
                    stress_system: document.getElementById("stressSystem").value,
                    subline: document.getElementById("subline").value,
                    area: document.getElementById("area").value,
                    piping_class: document.getElementById("pipingclass").value,
                    line_size: document.getElementById("lineSize").value,
                    line_schedule: document.getElementById("lineSchedule").value,
                    insulation: document.getElementById("insulation").value,
                    insulation_thickness: document.getElementById("insulationThickness").value.trim() || null,
                    design_temp: document.getElementById("designtemp").value,
                    spring_type: springTypeSelect.value,
                    figure: figureSelect.value,
                    quantity: toNumber(document.getElementById("quantity").value),
                    node_no: document.getElementById("nodeNo").value,
                    pipe_location_type: pipeLocationMode,
                    pipe_size_at_spring: document.getElementById("pipeSizeAtSpring").value.trim() || null,
                    pipe_sch_at_spring: document.getElementById("pipeSchAtSpring").value.trim() || null,
                    dummy_pipe_material: document.getElementById("dummyMaterial").value.trim() || null,
                    dimension: document.getElementById("dimension").value,
                    travel_up: toNumber(document.getElementById("travelUp").value),
                    travel_down: toNumber(document.getElementById("travelDown").value),
                    max_up: toNumber(document.getElementById("maxVertUp").value),
                    max_down: toNumber(document.getElementById("maxVertDown").value),
                    horiz_axial: toNumber(document.getElementById("horizAxial").value),
                    horiz_trans: toNumber(document.getElementById("horizTransverse").value),
                    operating_load: toNumber(document.getElementById("operatingLoad").value),
                    hydro_load: toNumber(document.getElementById("hydroLoad").value),
                    spring_tag: springTagInput.value,
                    remarks: document.getElementById("remarks")?.value?.trim() || '',
                    created_by: localStorage.getItem("employee_id") ||
                               (JSON.parse(localStorage.getItem("assignments") || "[]")[0]?.employee_id) || ''
                };

                let url = '/api/spring/save';
                let method = 'POST';
                if (editingSpringId) { url = `/api/spring/update/${editingSpringId}`; method = 'PUT'; }

                const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const json = await res.json();
                if (!json.ok) throw new Error(json.error || "Save failed");

                showToast("✅ Spring saved successfully!");
                editingSpringId = null;
                hideCopyBanner();

                await renderSpringList();
                const _savedLineId = document.getElementById("dia")?.value || "";
                masterForm.reset();
                currentLineUnit = null;
                applyPipeLocationMode('main');
                await generateTag();
                updateImage();
                updateSectionStatus();
                window.scrollTo({ top: 0, behavior: "smooth" });
                if (_savedLineId) await updateLineHistory(_savedLineId);

            } catch (err) {
                console.error("Save error:", err);
                showToast("❌ Failed to save spring");
            }
        });
    }


    /* ══════════════════════════════════════════
       SUBMIT CONFIRM MODAL
    ══════════════════════════════════════════ */

    const submitBtn = document.getElementById("submitFinalBtn");
    const modal = document.getElementById("submitConfirmModal");
    const cancelBtn = document.getElementById("cancelSubmitBtn");
    const confirmBtn = document.getElementById("confirmSubmitBtn");

    if (submitBtn) {
        submitBtn.addEventListener("click", function () {
            if (!editingSpringId) { showToast("⚠️ Please save or select a spring before submitting"); return; }
            modal.classList.add("active");
        });
    }
    if (cancelBtn) cancelBtn.addEventListener("click", () => modal.classList.remove("active"));
    if (modal) modal.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("active"); });

    if (confirmBtn) {
        confirmBtn.addEventListener("click", async function () {
            if (!validateAngle()) return;
            try {
                const res = await fetch(`/api/spring/submit/${editingSpringId}`, { method: "PUT" });
                const json = await res.json();
                if (!json.ok) throw new Error();
                showToast("🚀 Submitted successfully");
                modal.classList.remove("active");
                const _submittedLineId = document.getElementById("dia")?.value || "";
                await renderSpringList();
                editingSpringId = null;
                if (_submittedLineId) await updateLineHistory(_submittedLineId);
            } catch (err) { console.error("Submit error:", err); showToast("❌ Submit failed"); }
        });
    }


    /* ══════════════════════════════════════════
       COPY SOURCE BANNER
    ══════════════════════════════════════════ */

    const copySourceBanner = document.getElementById("copySourceBanner");
    const copySourceTagEl = document.getElementById("copySourceTag");
    const copyNewTagEl2 = document.getElementById("copyNewTag");
    const copyBannerDismiss = document.getElementById("copyBannerDismiss");

    function showCopyBanner(sourceTag, newTag) {
        if (!copySourceBanner) return;
        copySourceTagEl.textContent = sourceTag || "—";
        copyNewTagEl2.textContent = newTag || "—";
        copySourceBanner.classList.remove("hidden");
        copySourceBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    function hideCopyBanner() {
        if (copySourceBanner) copySourceBanner.classList.add("hidden");
    }
    if (copyBannerDismiss) {
        copyBannerDismiss.addEventListener("click", function () {
            hideCopyBanner();
            masterForm.reset();
            currentLineUnit = null;
            applyPipeLocationMode('main');
            editingSpringId = null;
            updateImage();
            generateTag();
            updateSectionStatus();
        });
    }


    /* ══════════════════════════════════════════
       RESET FORM
    ══════════════════════════════════════════ */

    if (resetFormBtn) {
        resetFormBtn.addEventListener("click", function () {
            if (!confirm("Reset all form fields?")) return;
            masterForm.reset();
            currentLineUnit = null;
            applyPipeLocationMode('main');
            // Re-enable both travel fields and clear mutex state
            const _tu = document.getElementById("travelUp");
            const _td = document.getElementById("travelDown");
            const _gu = document.getElementById("travelUpGroup");
            const _gd = document.getElementById("travelDownGroup");
            if (_tu) _tu.disabled = false;
            if (_td) _td.disabled = false;
            _gu && _gu.classList.remove("travel-disabled");
            _gd && _gd.classList.remove("travel-disabled");
            // Hide caution lines
            ["cautionMaxUp", "cautionMaxDown", "cautionDimension"].forEach(id => {
                const c = document.getElementById(id);
                if (c) c.classList.add("hidden");
            });
            // Restore area field to editable state after reset
            const _area = document.getElementById("area");
            if (_area) _area.readOnly = false;
            showZoneDropdown(null);
            document.getElementById("cautionLineList")?.classList.add("hidden");
            updateImage();
            generateTag();
            updateSectionStatus();
        });
    }


    /* ══════════════════════════════════════════
       LINE HISTORY DRAWER
    ══════════════════════════════════════════ */

    /* -- draggable vertical position -- */
    (function initTriggerDrag() {
        const STORAGE_KEY = 'lineHistoryTriggerTop';
        let isDragging = false;
        let dragStartY = 0;
        let dragStartTop = 0;

        function clampTop(px) {
            const btnH = lineHistoryTrigger.offsetHeight || 48;
            return Math.max(8, Math.min(window.innerHeight - btnH - 8, px));
        }

        function applyTop(px) {
            lineHistoryTrigger.style.top = px + 'px';
            lineHistoryTrigger.style.transform = '';
        }

        // Restore saved position or default to vertical centre
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
            applyTop(clampTop(parseFloat(saved)));
        } else {
            // Replace CSS top:50% with a concrete px so drag math is simple
            const btnH = lineHistoryTrigger.offsetHeight || 48;
            applyTop(clampTop(Math.round(window.innerHeight / 2 - btnH / 2)));
        }

        lineHistoryTrigger.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            isDragging = false;
            dragStartY = e.clientY;
            dragStartTop = parseFloat(lineHistoryTrigger.style.top) || 0;

            function onMove(e) {
                const delta = e.clientY - dragStartY;
                if (!isDragging && Math.abs(delta) > 4) {
                    isDragging = true;
                    lineHistoryTrigger.classList.add('dragging');
                }
                if (isDragging) {
                    applyTop(clampTop(dragStartTop + delta));
                }
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (isDragging) {
                    lineHistoryTrigger.classList.remove('dragging');
                    localStorage.setItem(STORAGE_KEY, parseFloat(lineHistoryTrigger.style.top));
                }
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Touch support
        lineHistoryTrigger.addEventListener('touchstart', function (e) {
            isDragging = false;
            dragStartY = e.touches[0].clientY;
            dragStartTop = parseFloat(lineHistoryTrigger.style.top) || 0;

            function onMove(e) {
                const delta = e.touches[0].clientY - dragStartY;
                if (!isDragging && Math.abs(delta) > 4) {
                    isDragging = true;
                    lineHistoryTrigger.classList.add('dragging');
                }
                if (isDragging) {
                    e.preventDefault();
                    applyTop(clampTop(dragStartTop + delta));
                }
            }

            function onEnd() {
                lineHistoryTrigger.removeEventListener('touchmove', onMove);
                lineHistoryTrigger.removeEventListener('touchend', onEnd);
                if (isDragging) {
                    lineHistoryTrigger.classList.remove('dragging');
                    localStorage.setItem(STORAGE_KEY, parseFloat(lineHistoryTrigger.style.top));
                }
            }

            lineHistoryTrigger.addEventListener('touchmove', onMove, { passive: false });
            lineHistoryTrigger.addEventListener('touchend', onEnd);
        }, { passive: true });

        // Suppress click when drag just ended
        lineHistoryTrigger.addEventListener('click', function (e) {
            if (isDragging) { isDragging = false; e.stopImmediatePropagation(); }
        }, true);
    })();

    lineHistoryTrigger.addEventListener("click", () => lineHistoryDrawer.classList.toggle("drawer-open"));
    lineHistoryClose.addEventListener("click", () => lineHistoryDrawer.classList.remove("drawer-open"));

    async function updateLineHistory(lineId) {
        const jobNo = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");

        if (!lineId) {
            triggerCount.textContent = "0";
            lineHistoryMeta.textContent = "Select a Line ID to see history";
            lineHistoryEmpty.style.display = "flex";
            lineHistoryList.querySelectorAll(".history-card").forEach(c => c.remove());
            return;
        }

        try {
            const createdBy = getEmployeeId();
            const res = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&createdBy=${encodeURIComponent(createdBy)}&aggregate=true`);
            const json = await res.json();
            const data = json.data || [];
            const matches = data.filter(e => e.line_id === lineId);

            triggerCount.textContent = matches.length;
            lineHistoryMeta.textContent = matches.length
                ? `${matches.length} spring(s) already on Line ${lineId}`
                : `No springs yet on Line ${lineId}`;

            lineHistoryList.querySelectorAll(".history-card").forEach(c => c.remove());

            if (matches.length === 0) {
                lineHistoryEmpty.style.display = "flex";
            } else {
                lineHistoryEmpty.style.display = "none";

                matches.forEach(entry => {
                    const card = document.createElement("div");
                    card.className = "history-card";
                    card.innerHTML = `
                        <div class="history-card-header">
                            <div>
                                <span class="history-card-tag">${entry.spring_tag}</span>
                                <span class="status-badge ${entry.status || ''}">${entry.status || '—'}</span>
                            </div>
                        </div>
                        <div class="history-card-detail">
                            Node: ${entry.node_no || "—"} &nbsp;·&nbsp; Qty: ${entry.quantity || "—"} &nbsp;·&nbsp;
                            ${new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <span class="history-card-badge">${entry.spring_type} / Fig ${entry.figure}</span>
                        <div class="history-actions">
                            <button class="hc-btn hc-view-btn" data-id="${entry.id}" title="View details">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                </svg>
                            </button>
                            <button class="hc-btn hc-edit-btn" data-id="${entry.id}" title="Edit this spring">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="hc-btn hc-delete-btn" data-id="${entry.id}" title="Delete this spring">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                    <path d="M10 11v6M14 11v6"/>
                                </svg>
                            </button>
                            <button class="hc-copy-btn" data-id="${entry.id}" title="Copy as new spring">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                Copy
                            </button>
                        </div>`;

                    // View (eye)
                    card.querySelector(".hc-view-btn").addEventListener("click", function () {
                        const id = this.dataset.id;
                        const selected = matches.find(e => e.id == id);
                        if (!selected) return;
                        openSpringViewModal(selected);
                    });

                    // Delete
                    card.querySelector(".hc-delete-btn").addEventListener("click", async function () {
                        const id = this.dataset.id;
                        if (!confirm("Delete this spring?")) return;
                        try {
                            const res = await fetch(`/api/spring/delete/${id}`, { method: "DELETE" });
                            const json = await res.json();
                            if (!json.ok) throw new Error("Delete failed");
                            showToast("🗑️ Deleted successfully");
                            await renderSpringList();
                            await updateLineHistory(lineId);
                        } catch (err) { showToast("❌ Delete failed"); }
                    });

                    // Edit
                    const editBtn = card.querySelector(".hc-edit-btn");
                    if (editBtn) {
                        editBtn.addEventListener("click", function () {
                            const id = this.dataset.id;
                            const selected = matches.find(e => e.id == id);
                            if (!selected) return;

                            editingSpringId = id;

                            const saveBtn = document.getElementById("saveSpringBtn");
                            const submitBtn2 = document.getElementById("submitFinalBtn");
                            const locked = ["submitted", "approved"].includes(selected.status);
                            if (saveBtn) saveBtn.disabled = locked;
                            if (submitBtn2) submitBtn2.disabled = locked;

                            if (selected.line_id) {
                                document.getElementById("dia").value = selected.line_id;
                                applyLineSelection(selected.line_id, true); // skip — this edit handler sets the correct existing tag below
                                // Authoritative source: the spring's own stored literal unit,
                                // regardless of whether it's still present in stressLineData.
                                currentLineUnit = selected.unit_no || currentLineUnit;
                            }
                            if (selected.subline) document.getElementById("subline").value = selected.subline || "";
                            if (selected.area) document.getElementById("area").value = selected.area || "";

                            document.getElementById("pipingclass").value = selected.piping_class || "";
                            document.getElementById("lineSize").value = selected.line_size || "";
                            document.getElementById("lineSchedule").value = selected.line_schedule || "";
                            document.getElementById("insulation").value = selected.insulation || "";
                            document.getElementById("insulationThickness").value = selected.insulation_thickness || "";
                            document.getElementById("designtemp").value = selected.design_temp || "";

                            document.getElementById("springType").value = selected.spring_type || "";
                            document.getElementById("figure").value = selected.figure || "";

                            // Restore pipe location toggle
                            applyPipeLocationMode(selected.pipe_location_type === 'dummy' ? 'dummy' : 'main');
                            if (selected.pipe_size_at_spring) document.getElementById("pipeSizeAtSpring").value = selected.pipe_size_at_spring;
                            if (selected.pipe_sch_at_spring)  document.getElementById("pipeSchAtSpring").value  = selected.pipe_sch_at_spring;
                            if (selected.dummy_pipe_material) document.getElementById("dummyMaterial").value = selected.dummy_pipe_material;

                            document.getElementById("dimension").value = selected.dimension || "";
                            document.getElementById("travelUp").value = selected.travel_up || "";
                            document.getElementById("travelDown").value = selected.travel_down || "";
                            document.getElementById("maxVertUp").value = selected.max_up || "";
                            document.getElementById("maxVertDown").value = selected.max_down || "";
                            document.getElementById("horizAxial").value = selected.horiz_axial || "";
                            document.getElementById("horizTransverse").value = selected.horiz_trans || "";
                            document.getElementById("operatingLoad").value = selected.operating_load || "";
                            document.getElementById("hydroLoad").value = selected.hydro_load || "";
                            document.getElementById("quantity").value = selected.quantity || "";
                            document.getElementById("nodeNo").value = selected.node_no || "";
                            document.getElementById("remarks").value = selected.remarks || "";
                            springTagInput.value = selected.spring_tag;
                            if (tagDisplay) tagDisplay.textContent = selected.spring_tag || "—";

                            // Restore slider from accepted variation note in remarks
                            const _varMatch = (selected.remarks || "").match(/Max Op Load Variation\s*=\s*(\d+)%/);
                            const _slider = document.getElementById("evalSlider");
                            const _sliderVal = document.getElementById("evalSliderVal");
                            if (_slider) {
                                _slider.value = _varMatch ? _varMatch[1] : "15";
                                if (_sliderVal) _sliderVal.textContent = (_varMatch ? _varMatch[1] : "15") + "%";
                            }

                            recalcSpringEvaluator();
                            updateImage();
                            update3D();
                            updateAngleInfo();
                            reapplyTravelMutex();
                            updateSectionStatus();
                            lineHistoryDrawer.classList.remove("drawer-open");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                            showToast("✏️ Editing spring — update fields and save");
                        });
                    }

                    // Copy
                    const copyBtnCard = card.querySelector(".hc-copy-btn");
                    if (copyBtnCard) {
                        copyBtnCard.addEventListener("click", async function () {
                            const id = this.dataset.id;
                            const selected = matches.find(e => e.id == id);
                            if (!selected) return;

                            fillForm(selected);
                            editingSpringId = null;
                            // Default to the source spring's literal unit until the
                            // user picks a (possibly different) Line ID for the copy.
                            currentLineUnit = selected.unit_no || currentLineUnit;
                            await generateTag();
                            showCopyBanner(selected.spring_tag, springTagInput.value);
                            showToast(`📄 Copied from ${selected.spring_tag} — new tag generated`);
                            lineHistoryDrawer.classList.remove("drawer-open");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                        });
                    }

                    lineHistoryList.appendChild(card);
                });
            }
        } catch (err) { console.error("History load error:", err); }
    }


    /* ══════════════════════════════════════════
       FILL FORM (for edit / copy)
    ══════════════════════════════════════════ */

    function fillForm(data) {
        document.getElementById("subline").value = data.subline || "";
        document.getElementById("area").value = data.area || "";
        document.getElementById("pipingclass").value = data.piping_class || "";
        document.getElementById("lineSize").value = data.line_size || "";
        document.getElementById("lineSchedule").value = data.line_schedule || "";
        document.getElementById("insulation").value = data.insulation || "";
        document.getElementById("insulationThickness").value = data.insulation_thickness || "";
        document.getElementById("designtemp").value = data.design_temp || "";
        document.getElementById("springType").value = data.spring_type || "";
        document.getElementById("figure").value = data.figure || "";

        // Restore pipe location
        applyPipeLocationMode(data.pipe_location_type === 'dummy' ? 'dummy' : 'main');
        if (data.pipe_size_at_spring) document.getElementById("pipeSizeAtSpring").value = data.pipe_size_at_spring;
        if (data.pipe_sch_at_spring)  document.getElementById("pipeSchAtSpring").value  = data.pipe_sch_at_spring;
        if (data.dummy_pipe_material) document.getElementById("dummyMaterial").value = data.dummy_pipe_material;

        document.getElementById("dimension").value = data.dimension || "";
        document.getElementById("travelUp").value = data.travel_up || "";
        document.getElementById("travelDown").value = data.travel_down || "";
        document.getElementById("maxVertUp").value = data.max_up || "";
        document.getElementById("maxVertDown").value = data.max_down || "";
        document.getElementById("horizAxial").value = data.horiz_axial || "";
        document.getElementById("horizTransverse").value = data.horiz_trans || "";
        document.getElementById("operatingLoad").value = data.operating_load || "";
        document.getElementById("hydroLoad").value = data.hydro_load || "";
        document.getElementById("quantity").value = data.quantity || "";
        document.getElementById("nodeNo").value = data.node_no || "";
        document.getElementById("remarks").value = data.remarks || "";
        pipingData["Line ID"] = data.line_id;
        pipingData["Stress Critical No"] = data.stress_system;

        recalcSpringEvaluator();
        updateImage();
        update3D();
        updateAngleInfo();
        reapplyTravelMutex();
        updateSectionStatus();
    }

    // Re-apply mutex state after programmatic population
    function reapplyTravelMutex() {
        const up   = document.getElementById("travelUp");
        const down = document.getElementById("travelDown");
        const gUp  = document.getElementById("travelUpGroup");
        const gDn  = document.getElementById("travelDownGroup");
        if (!up || !down) return;
        if (up.value.trim()) {
            down.disabled = true;
            down.value = "";
            gDn && gDn.classList.add("travel-disabled");
            gUp && gUp.classList.remove("travel-disabled");
        } else if (down.value.trim()) {
            up.disabled = true;
            up.value = "";
            gUp && gUp.classList.add("travel-disabled");
            gDn && gDn.classList.remove("travel-disabled");
        } else {
            up.disabled = false;
            down.disabled = false;
            gUp && gUp.classList.remove("travel-disabled");
            gDn && gDn.classList.remove("travel-disabled");
        }
    }


    /* ══════════════════════════════════════════
       SPRING LIST — RENDER (View Springs tab)
    ══════════════════════════════════════════ */

    async function renderSpringList() {
        const jobNo = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;

        try {
            const createdBy = getEmployeeId();
            const res = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&createdBy=${encodeURIComponent(createdBy)}&aggregate=true`);
            const json = await res.json();
            const data = json.data || [];

            const searchValue = document.getElementById("springSearchInput")?.value?.toLowerCase() || "";
            let filteredData = searchValue
                ? data.filter(e =>
                    (e.spring_tag || "").toLowerCase().includes(searchValue) ||
                    (e.line_id || "").toLowerCase().includes(searchValue) ||
                    (e.spring_type || "").toLowerCase().includes(searchValue))
                : data;
            if (activeStatusFilter) {
                filteredData = filteredData.filter(e => (e.status || "saved") === activeStatusFilter);
            }

            springList.querySelectorAll(".spring-card").forEach(c => c.remove());

            if (filteredData.length === 0) {
                springListEmpty.style.display = "flex";
                springCountBadge.textContent = "0";
                currentSpringList = [];
                updateSummaryBar(data);
                return;
            }
            springListEmpty.style.display = "none";

            currentSpringList = filteredData;
            updateSummaryBar(data);

            filteredData.forEach((entry, idx) => {
                const card = document.createElement("div");
                card.className = "spring-card";
                const dotStatus = entry.status || "saved";
                const remarkSnippet = entry.remarks && entry.remarks.trim()
                    ? `<div class="spring-card-remark">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          ${entry.remarks.trim().substring(0, 60)}${entry.remarks.trim().length > 60 ? '…' : ''}
                       </div>`
                    : '';
                const bidBadge = entry.bid_count > 0
                    ? `<span class="spring-card-bid-badge" title="${entry.bid_count} vendor bid${entry.bid_count !== 1 ? 's' : ''} received">
                           <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="1"/></svg>
                           ${entry.bid_count} bid${entry.bid_count !== 1 ? 's' : ''}
                       </span>`
                    : '';
                card.innerHTML = `
                    <div class="spring-card-header">
                        <span class="spring-card-tag">${entry.spring_tag}</span>
                        <span class="spring-status-dot status-${dotStatus}" title="${dotStatus}"></span>
                    </div>
                    <div class="spring-card-meta">Line: ${entry.line_id || "—"}</div>
                    <div class="spring-card-footer">
                        <span class="spring-card-type">${entry.spring_type} / Fig ${entry.figure}</span>
                        ${bidBadge}
                    </div>
                    ${remarkSnippet}`;
                card.addEventListener("click", () => openSpringDetail(entry, idx));
                springList.appendChild(card);
            });

            springCountBadge.textContent = filteredData.length;

        } catch (err) { console.error("Render error:", err); }
    }



    /* ══════════════════════════════════════════
       SPRING DETAIL MODAL
    ══════════════════════════════════════════ */

    const springDetailOverlay = document.getElementById("springDetailOverlay");

    function openSpringDetail(e, idx) {
        currentSpringIdx = idx ?? 0;
        document.getElementById("sdetailTag").textContent = e.spring_tag || "—";
        document.getElementById("sdetailTypeBadge").textContent =
            [e.spring_type, e.figure ? `Fig ${e.figure}` : null].filter(Boolean).join(" / ");
        document.getElementById("sdetailNavPos").textContent =
            `${currentSpringIdx + 1} / ${currentSpringList.length}`;
        document.getElementById("sdetailPrev").disabled = currentSpringIdx === 0;
        document.getElementById("sdetailNext").disabled = currentSpringIdx === currentSpringList.length - 1;

        const fmt = v => (v != null && v !== "") ? v : "—";

        const groups = [
            {
                title: "Line Info",
                rows: [
                    ["Line ID",          e.line_id,             false],
                    ["Stress System",    e.stress_system,       false],
                    ["Subline",          e.subline,             false],
                    ["Area",             e.area,                false],
                    ["Piping Class",     e.piping_class,        false],
                    ["Line Size",        e.line_size,           false],
                    ["Line Schedule",    e.line_schedule,       false],
                    ["Insulation",       e.insulation,          false],
                    ["Ins. Thickness",   e.insulation_thickness,false],
                    ["Design Temp",      e.design_temp,         false],
                ]
            },
            {
                title: "Spring Configuration",
                rows: [
                    ["Pipe Location",      e.pipe_location_type,   false],
                    ["Pipe Size @ Spring", e.pipe_size_at_spring,  false],
                    ["Pipe Sch @ Spring",  e.pipe_sch_at_spring,   false],
                    ["Dummy Pipe Mat.",    e.dummy_pipe_material,  false],
                    ["Dimension",          e.dimension,            false],
                    ["Quantity",           e.quantity,             false],
                    ["Node No",            e.node_no,              false],
                ]
            },
            {
                title: "Travel & Loads",
                rows: [
                    ["Travel Up",      e.travel_up,      false],
                    ["Travel Down",    e.travel_down,    false],
                    ["Max Up",         e.max_up,         false],
                    ["Max Down",       e.max_down,       false],
                    ["Horiz Axial",    e.horiz_axial,    false],
                    ["Horiz Trans",    e.horiz_trans,    false],
                    ["Operating Load", e.operating_load, false],
                    ["Hydro Load",     e.hydro_load,     false],
                ]
            },
            {
                title: "Status & Review",
                rows: [
                    ["Status",          e.status,         false],
                    ["MR No",           e.mr_no,          false],
                    ["Order Status",    e.order_status,   false],
                    ["Created By",      e.created_by,     false],
                    ["Reviewed By",     e.reviewed_by,    false],
                    ["Review Remarks",  e.review_remarks, true ],
                ]
            }
        ];

        const body = document.getElementById("sdetailBody");
        body.innerHTML = groups.map(g => {
            const rowsHtml = g.rows.map(([label, val, full]) =>
                `<div class="sdetail-row${full ? " full" : ""}">
                    <span class="sdetail-label">${label}</span>
                    <span class="sdetail-val">${fmt(val)}</span>
                 </div>`
            ).join("");
            return `<div class="sdetail-group">
                        <div class="sdetail-group-title">${g.title}</div>
                        <div class="sdetail-grid">${rowsHtml}</div>
                    </div>`;
        }).join("");

        if (e.remarks && e.remarks.trim()) {
            body.innerHTML += `<div class="sdetail-group">
                <div class="sdetail-group-title">Remarks</div>
                <div class="sdetail-remarks-box">${e.remarks.trim()}</div>
            </div>`;
        }

        /* Bid data: async-append below existing content */
        if (e.spring_tag) {
            const bidGroup = document.createElement("div");
            bidGroup.className = "sdetail-group";
            bidGroup.innerHTML = `<div class="sdetail-group-title">Vendor Bids</div><div class="sdetail-bid-loading">Loading bid data…</div>`;
            body.appendChild(bidGroup);

            const jobNo = localStorage.getItem("jobno") || "";
            const url   = `/api/spring/bid-data?springTag=${encodeURIComponent(e.spring_tag)}${jobNo ? `&jobNo=${encodeURIComponent(jobNo)}` : ""}`;
            fetch(url)
                .then(r => r.json())
                .then(json => {
                    if (!json.ok || !json.data?.length) {
                        bidGroup.innerHTML = `<div class="sdetail-group-title">Vendor Bids</div><div class="sdetail-bid-loading">No bid data yet.</div>`;
                        return;
                    }
                    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
                    const rows = json.data.map(b => `
                        <tr>
                            <td class="sdb-vendor">${esc(b.vendor_name)}</td>
                            <td>${b.spring_designation || "—"}</td>
                            <td>${b.spring_constant   || "—"}</td>
                            <td>${b.preset_load       || "—"}</td>
                            <td>${b.load_variation_pct || "—"}</td>
                        </tr>`).join("");
                    bidGroup.innerHTML = `
                        <div class="sdetail-group-title">Vendor Bids (${json.data.length} vendor${json.data.length !== 1 ? "s" : ""})</div>
                        <div style="overflow-x:auto;">
                        <table class="sdetail-bid-table">
                            <thead><tr>
                                <th>Vendor</th>
                                <th>Spring Designation</th>
                                <th>Constant (kg/mm)</th>
                                <th>Preset Load (kg)</th>
                                <th>Load Variation (%)</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table></div>`;
                })
                .catch(() => {
                    bidGroup.innerHTML = `<div class="sdetail-group-title">Vendor Bids</div><div class="sdetail-bid-loading">Could not load bid data.</div>`;
                });
        }

        springDetailOverlay.classList.add("active");
    }

    function closeSpringDetail() { springDetailOverlay.classList.remove("active"); }

    document.getElementById("sdetailClose").addEventListener("click", closeSpringDetail);
    springDetailOverlay.addEventListener("click", function (ev) { if (ev.target === this) closeSpringDetail(); });

    document.getElementById("sdetailPrev").addEventListener("click", () => {
        if (currentSpringIdx > 0) openSpringDetail(currentSpringList[currentSpringIdx - 1], currentSpringIdx - 1);
    });
    document.getElementById("sdetailNext").addEventListener("click", () => {
        if (currentSpringIdx < currentSpringList.length - 1) openSpringDetail(currentSpringList[currentSpringIdx + 1], currentSpringIdx + 1);
    });

    document.getElementById("sdetailEditBtn").addEventListener("click", () => {
        const selected = currentSpringList[currentSpringIdx];
        if (!selected) return;

        editingSpringId = selected.id;
        const saveBtn   = document.getElementById("saveSpringBtn");
        const submitBtn = document.getElementById("submitFinalBtn");
        const locked = ["submitted", "approved"].includes(selected.status);
        if (saveBtn)   saveBtn.disabled   = locked;
        if (submitBtn) submitBtn.disabled = locked;

        if (selected.line_id) {
            document.getElementById("dia").value = selected.line_id;
            applyLineSelection(selected.line_id, true); // skip — this edit handler sets the correct existing tag below
            // Authoritative source: the spring's own stored literal unit,
            // regardless of whether it's still present in stressLineData.
            currentLineUnit = selected.unit_no || currentLineUnit;
        }
        document.getElementById("subline").value            = selected.subline            || "";
        document.getElementById("area").value               = selected.area               || "";
        document.getElementById("pipingclass").value        = selected.piping_class       || "";
        document.getElementById("lineSize").value           = selected.line_size          || "";
        document.getElementById("lineSchedule").value       = selected.line_schedule      || "";
        document.getElementById("insulation").value         = selected.insulation         || "";
        document.getElementById("insulationThickness").value= selected.insulation_thickness|| "";
        document.getElementById("designtemp").value         = selected.design_temp        || "";
        document.getElementById("springType").value         = selected.spring_type        || "";
        document.getElementById("figure").value             = selected.figure             || "";
        applyPipeLocationMode(selected.pipe_location_type === 'dummy' ? 'dummy' : 'main');
        if (selected.pipe_size_at_spring) document.getElementById("pipeSizeAtSpring").value = selected.pipe_size_at_spring;
        if (selected.pipe_sch_at_spring)  document.getElementById("pipeSchAtSpring").value  = selected.pipe_sch_at_spring;
        if (selected.dummy_pipe_material) document.getElementById("dummyMaterial").value    = selected.dummy_pipe_material;
        document.getElementById("dimension").value          = selected.dimension          || "";
        document.getElementById("travelUp").value           = selected.travel_up          || "";
        document.getElementById("travelDown").value         = selected.travel_down        || "";
        document.getElementById("maxVertUp").value          = selected.max_up             || "";
        document.getElementById("maxVertDown").value        = selected.max_down           || "";
        document.getElementById("horizAxial").value         = selected.horiz_axial        || "";
        document.getElementById("horizTransverse").value    = selected.horiz_trans        || "";
        document.getElementById("operatingLoad").value      = selected.operating_load     || "";
        document.getElementById("hydroLoad").value          = selected.hydro_load         || "";
        document.getElementById("quantity").value           = selected.quantity           || "";
        document.getElementById("nodeNo").value             = selected.node_no            || "";
        document.getElementById("remarks").value            = selected.remarks            || "";
        springTagInput.value = selected.spring_tag;
        if (tagDisplay) tagDisplay.textContent = selected.spring_tag || "—";

        // Restore slider from accepted variation note in remarks
        const _varMatch2 = (selected.remarks || "").match(/Max Op Load Variation\s*=\s*(\d+)%/);
        const _slider2 = document.getElementById("evalSlider");
        const _sliderVal2 = document.getElementById("evalSliderVal");
        if (_slider2) {
            _slider2.value = _varMatch2 ? _varMatch2[1] : "15";
            if (_sliderVal2) _sliderVal2.textContent = (_varMatch2 ? _varMatch2[1] : "15") + "%";
        }

        recalcSpringEvaluator();
        updateImage(); update3D(); updateAngleInfo(); reapplyTravelMutex(); updateSectionStatus();
        closeSpringDetail();
        switchSidebarTab("entry");
        window.scrollTo({ top: 0, behavior: "smooth" });
        showToast("✏️ Editing spring — update fields and save");
    });

    document.getElementById("sdetailPrintBtn").addEventListener("click", () => {
        printSpringDetail(currentSpringList[currentSpringIdx]);
    });

    function printSpringDetail(e) {
        const fmt = v => (v != null && v !== '') ? v : '—';
        const statusLabel = { saved:'Saved', submitted:'Submitted', approved:'Approved', rejected:'Rejected' };
        const sections = [
            { title: 'Line Information', fields: [
                ['Line ID', e.line_id], ['Stress System', e.stress_system], ['Subline', e.subline],
                ['Area', e.area], ['Piping Class', e.piping_class], ['Line Size', e.line_size],
                ['Line Schedule', e.line_schedule], ['Insulation', e.insulation],
                ['Ins. Thickness', e.insulation_thickness], ['Design Temp', e.design_temp],
            ]},
            { title: 'Spring Configuration', fields: [
                ['Spring Type', e.spring_type], ['Figure', e.figure],
                ['Pipe Location', e.pipe_location_type], ['Pipe Size @ Spring', e.pipe_size_at_spring],
                ['Pipe Sch @ Spring', e.pipe_sch_at_spring], ['Dummy Pipe Material', e.dummy_pipe_material],
                ['Dimension', e.dimension], ['Quantity', e.quantity], ['Node No', e.node_no],
            ]},
            { title: 'Travel & Loads', fields: [
                ['Travel Up', e.travel_up], ['Travel Down', e.travel_down],
                ['Max Up', e.max_up], ['Max Down', e.max_down],
                ['Horiz Axial', e.horiz_axial], ['Horiz Trans', e.horiz_trans],
                ['Operating Load', e.operating_load], ['Hydro Load', e.hydro_load],
            ]},
            { title: 'Status & Review', fields: [
                ['Status', statusLabel[e.status] || e.status], ['MR No', e.mr_no],
                ['Order Status', e.order_status], ['Created By', e.created_by],
                ['Reviewed By', e.reviewed_by], ['Review Remarks', e.review_remarks],
            ]},
        ];
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Spring ${fmt(e.spring_tag)} — SSMS</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;font-size:12px;color:#1a1a1a;background:#fff;padding:30px 40px}
.ph{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:14px;margin-bottom:20px}
.pt{font-size:24px;font-weight:700;letter-spacing:.5px}
.ps{font-size:12px;color:#555;margin-top:4px}
.pm{text-align:right;font-size:11px;color:#555}
.pm strong{display:block;font-size:13px;color:#1a1a1a}
.sections{display:grid;grid-template-columns:1fr 1fr;gap:20px 30px}
.sec{break-inside:avoid}
.st{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;border-bottom:1px solid #e0e0e0;padding-bottom:5px;margin-bottom:8px}
.fr{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f4f4f4;gap:10px}
.fl{color:#777;font-size:11px;flex-shrink:0}
.fv{font-weight:600;text-align:right;font-size:11px}
.rb{margin-top:20px;padding:12px;border:1px solid #ddd;border-radius:6px;background:#fafafa}
.rt{font-style:italic;color:#444;line-height:1.6;margin-top:6px}
.pf{margin-top:24px;border-top:1px solid #ddd;padding-top:10px;font-size:10px;color:#aaa;display:flex;justify-content:space-between}
@media print{body{padding:15px 20px}}
</style></head><body>
<div class="ph">
  <div><div class="pt">${fmt(e.spring_tag)}</div>
  <div class="ps">${fmt(e.spring_type)} / Fig ${fmt(e.figure)} &nbsp;|&nbsp; Line: ${fmt(e.line_id)}</div></div>
  <div class="pm"><strong>Spring Schedule Management System</strong>
  Job: ${fmt(localStorage.getItem('jobno'))} &nbsp;|&nbsp; Unit: ${fmt(localStorage.getItem('unit'))}<br>
  Printed: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
</div>
<div class="sections">
${sections.map(s=>`<div class="sec"><div class="st">${s.title}</div>${s.fields.map(([l,v])=>`<div class="fr"><span class="fl">${l}</span><span class="fv">${fmt(v)}</span></div>`).join('')}</div>`).join('')}
</div>
${e.remarks&&e.remarks.trim()?`<div class="rb"><div class="st">Remarks</div><div class="rt">${e.remarks.trim()}</div></div>`:''}
<div class="pf"><span>Generated by SSMS — Spring Schedule Management System</span>
<span>Status: ${statusLabel[e.status]||e.status||'—'}</span></div>
</body></html>`;
        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 400);
    }

    function updateSummaryBar(data) {
        const bar = document.getElementById("springSummaryBar");
        if (!bar) return;
        const counts = {};
        data.forEach(e => { counts[e.status] = (counts[e.status] || 0) + 1; });
        const cfg = [
            { key:'submitted', label:'Submitted', cls:'ssb-submitted' },
            { key:'approved',  label:'Approved',  cls:'ssb-approved'  },
            { key:'rejected',  label:'Rejected',  cls:'ssb-rejected'  },
            { key:'saved',     label:'Saved',     cls:'ssb-saved'     },
        ];
        bar.innerHTML = cfg
            .filter(c => counts[c.key])
            .map(c => {
                const active = activeStatusFilter === c.key ? ' ssb-chip-active' : '';
                return `<span class="ssb-chip ${c.cls}${active}" data-status="${c.key}" style="cursor:pointer;" title="Filter by ${c.label}"><span class="ssb-chip-count">${counts[c.key]}</span>&nbsp;${c.label}</span>`;
            })
            .join('');

        bar.querySelectorAll('.ssb-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const key = chip.dataset.status;
                activeStatusFilter = (activeStatusFilter === key) ? null : key;
                renderSpringList();
                loadViewSpringsTable();
            });
        });

        // Tab badge — alert JE when any rejected springs need attention
        const alertCount = (counts['rejected'] || 0);
        const tabBadge = document.getElementById("tabViewAlert");
        if (tabBadge) {
            if (alertCount > 0) {
                tabBadge.textContent = alertCount;
                tabBadge.style.display = "inline-flex";
            } else {
                tabBadge.style.display = "none";
            }
        }
    }

    document.addEventListener("keydown", function (ev) {
        if (!springDetailOverlay.classList.contains("active")) return;
        if (ev.key === "Escape") { closeSpringDetail(); return; }
        if (ev.key === "ArrowLeft"  && currentSpringIdx > 0)
            openSpringDetail(currentSpringList[currentSpringIdx - 1], currentSpringIdx - 1);
        if (ev.key === "ArrowRight" && currentSpringIdx < currentSpringList.length - 1)
            openSpringDetail(currentSpringList[currentSpringIdx + 1], currentSpringIdx + 1);
    });


    /* ══════════════════════════════════════════
       SPRING SEARCH
    ══════════════════════════════════════════ */

    const springSearchInput = document.getElementById("springSearchInput");
    const springSearchClear = document.getElementById("springSearchClear");

    const noResultEl = document.createElement("div");
    noResultEl.className = "spring-search-no-result";
    noResultEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><span>No matches found</span>`;
    springList.appendChild(noResultEl);

    springSearchInput.addEventListener("input", function () {
        springSearchClear.classList.toggle("visible", this.value.trim().length > 0);
        renderSpringList();
    });
    springSearchClear.addEventListener("click", function () {
        springSearchInput.value = "";
        springSearchClear.classList.remove("visible");
        renderSpringList();
        springSearchInput.focus();
    });


    /* ══════════════════════════════════════════
       SAVE CSV
    ══════════════════════════════════════════ */

    const saveSpringsCsvBtn = document.getElementById("saveSpringsCsvBtn");
    if (saveSpringsCsvBtn) {
        saveSpringsCsvBtn.addEventListener("click", async function () {
            const jobNo = localStorage.getItem("jobno") || "JOB";
            const unitNo = localStorage.getItem("unit") || "UNIT";
            const createdBy = getEmployeeId();
            showToast("⏳ Preparing Excel…");
            try {
                const res = await fetch(`/api/spring/export-all?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&createdBy=${encodeURIComponent(createdBy)}&aggregate=true`);
                if (!res.ok) { showToast("❌ Export failed"); return; }
                const blob = await res.blob();
                if (blob.size === 0) { showToast("No springs to export"); return; }
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${jobNo}_${unitNo}_${createdBy}_Springs.xlsx`;
                document.body.appendChild(link); link.click();
                document.body.removeChild(link); URL.revokeObjectURL(url);
                showToast("✅ Excel downloaded");
            } catch (err) { showToast("❌ Could not download Excel"); }
        });
    }


    /* ══════════════════════════════════════════
       COPY ALL TAGS
    ══════════════════════════════════════════ */

    const copyAllTagsBtn = document.getElementById("copyAllTagsBtn");
    if (copyAllTagsBtn) {
        copyAllTagsBtn.addEventListener("click", async function () {
            const jobNo = localStorage.getItem("jobno") || "";
            const unitNo = localStorage.getItem("unit") || "";
            let data = [];
            try {
                const createdBy = getEmployeeId();
                const res = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&createdBy=${encodeURIComponent(createdBy)}`);
                const json = await res.json();
                data = json.data || [];
            } catch (err) { showToast("❌ Could not fetch spring tags"); return; }
            if (data.length === 0) { showToast("No spring tags to copy"); return; }
            const text = data.map(e => e.spring_tag).join("\n");
            navigator.clipboard.writeText(text).then(() => {
                const orig = copyAllTagsBtn.innerHTML;
                copyAllTagsBtn.classList.add("btn-copied");
                copyAllTagsBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied!`;
                setTimeout(() => { copyAllTagsBtn.classList.remove("btn-copied"); copyAllTagsBtn.innerHTML = orig; }, 2200);
                showToast(`✅ ${data.length} tag(s) copied`);
            }).catch(() => showToast("❌ Copy failed"));
        });
    }


    /* ══════════════════════════════════════════
       FORM VALIDATION
    ══════════════════════════════════════════ */

    // IDs that are intentionally optional — never blocked by validateForm
    // pipeSizeAtSpring / pipeSchAtSpring are always filled (auto or manual)
    const OPTIONAL_FIELDS = new Set(["hydroLoad", "remarks", "insulationThickness", "stressSystem"]);

    function validateForm(form) {
        const inputs = form.querySelectorAll("input:not([readonly]):not([disabled]), select:not([disabled])");
        let valid = true;
        inputs.forEach(el => {
            if (OPTIONAL_FIELDS.has(el.id)) return;   // skip optional fields
            if (!el.value.trim()) {
                el.style.borderColor = "#c0392b";
                el.style.boxShadow = "0 0 0 3px rgba(192,57,43,0.12)";
                valid = false;
                el.addEventListener("input", function fix() {
                    el.style.borderColor = ""; el.style.boxShadow = "";
                    el.removeEventListener("input", fix);
                });
            }
        });

        // At least one of travelUp/travelDown must be filled
        const tupEl = document.getElementById("travelUp");
        const tdnEl = document.getElementById("travelDown");
        if (tupEl && tdnEl && !tupEl.value.trim() && !tdnEl.value.trim()) {
            [tupEl, tdnEl].forEach(el => {
                el.style.borderColor = "#c0392b";
                el.style.boxShadow = "0 0 0 3px rgba(192,57,43,0.12)";
                el.addEventListener("input", function fix() {
                    el.style.borderColor = ""; el.style.boxShadow = "";
                    el.removeEventListener("input", fix);
                });
            });
            showToast("⚠️ Enter Travel at Op. Temp — UP or DOWN.");
            valid = false;
        }

        // Min 5mm block for maxVert fields
        let maxVertFailed = false;
        ["maxVertUp", "maxVertDown"].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const val = parseFloat(el.value);
            if (el.value === "" || isNaN(val) || val < 5) {
                valid = false;
                maxVertFailed = true;
                el.style.borderColor = "#c0392b";
                el.style.boxShadow = "0 0 0 3px rgba(192,57,43,0.12)";
                el.addEventListener("input", function fix() {
                    el.style.borderColor = ""; el.style.boxShadow = "";
                    el.removeEventListener("input", fix);
                });
                // also ensure caution is visible
                const cautionId = id === "maxVertUp" ? "cautionMaxUp" : "cautionMaxDown";
                const caution = document.getElementById(cautionId);
                if (caution) caution.classList.remove("hidden");
            }
        });
        if (maxVertFailed) showToast("⚠️ Max Vertical Travel must be ≥ 5 mm.");

        // Dimension must be a multiple of 10
        const dimEl = document.getElementById("dimension");
        if (dimEl) {
            const dimVal = parseFloat(dimEl.value);
            if (dimEl.value === "" || isNaN(dimVal) || dimVal % 10 !== 0) {
                valid = false;
                dimEl.style.borderColor = "#c0392b";
                dimEl.style.boxShadow = "0 0 0 3px rgba(192,57,43,0.12)";
                dimEl.addEventListener("input", function fix() {
                    dimEl.style.borderColor = ""; dimEl.style.boxShadow = "";
                    dimEl.removeEventListener("input", fix);
                });
                const caution = document.getElementById("cautionDimension");
                if (caution) caution.classList.remove("hidden");
                showToast("⚠️ Dimension must be a multiple of 10 mm.");
            }
        }

        // Pipe material at spring location is required in all modes
        {
            const dummyEl = document.getElementById("dummyMaterial");
            if (dummyEl && !dummyEl.value.trim()) {
                valid = false;
                dummyEl.style.borderColor = "#c0392b";
                dummyEl.style.boxShadow = "0 0 0 3px rgba(192,57,43,0.12)";
                dummyEl.addEventListener("change", function fix() {
                    dummyEl.style.borderColor = ""; dummyEl.style.boxShadow = "";
                    dummyEl.removeEventListener("change", fix);
                });
                showToast("⚠️ Enter Pipe Material at Spring Location.");
            }
        }

        return valid;
    }


    /* ══════════════════════════════════════════
       TOAST
    ══════════════════════════════════════════ */

    function showToast(message, type) {
        const existing = document.getElementById("ssms-toast");
        if (existing) existing.remove();
        const toast = document.createElement("div");
        toast.id = "ssms-toast";
        toast.textContent = message;
        const isWarn = type === "warn";
        Object.assign(toast.style, {
            position: "fixed", bottom: "32px", right: "40px",
            background: isWarn ? "#7a4f00" : "#3b2e1e",
            color: "#f5f0e8", padding: "14px 24px",
            borderRadius: "10px", fontSize: "13px", fontFamily: "'DM Sans',sans-serif",
            fontWeight: "500", letterSpacing: "0.5px",
            boxShadow: isWarn ? "0 8px 32px rgba(122,79,0,0.4)" : "0 8px 32px rgba(59,46,30,0.35)",
            border: isWarn ? "1px solid rgba(255,180,0,0.5)" : "1px solid rgba(212,169,106,0.3)",
            zIndex: "9999", opacity: "0", transform: "translateY(10px)",
            transition: "opacity 0.3s ease, transform 0.3s ease",
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; }));
        const duration = isWarn ? 5000 : 3000;
        setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(10px)"; setTimeout(() => toast.remove(), 350); }, duration);
    }


    /* ══════════════════════════════════════════
       DASHBOARD
    ══════════════════════════════════════════ */

    async function loadDashboard() {
        const jobNo = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;
        try {
            const res = await fetch(`/api/spring/dashboard?jobNo=${jobNo}&unitNo=${unitNo}`);
            const json = await res.json();
            if (!json.ok) throw new Error("Failed");
            const d = json.data;
            document.getElementById("totalSprings").textContent = d.total_springs;
            document.getElementById("totalLines").textContent = d.total_lines;
            document.getElementById("cshCount").textContent = d.csh_count;
            document.getElementById("vshCount").textContent = d.vsh_count;
        } catch (err) { console.error("Dashboard error:", err); }
    }

    const dashboardLink = document.getElementById("dashboardLink");
    const dashboardSection = document.getElementById("dashboardSection");
    const mainApp = document.getElementById("mainContent");

    if (dashboardLink) {
        dashboardLink.addEventListener("click", function (e) {
            e.preventDefault();
            if (mainApp) mainApp.style.display = "none";
            if (dashboardSection) dashboardSection.style.display = "block";
            document.querySelectorAll(".nav-links a").forEach(a => a.classList.remove("nav-active"));
            dashboardLink.classList.add("nav-active");
            loadDashboard();
        });
    }

    const homeLink = document.getElementById("homeLink");
    if (homeLink) {
        homeLink.addEventListener("click", function (e) {
            e.preventDefault();
            if (dashboardSection) dashboardSection.style.display = "none";
            if (mainApp) mainApp.style.display = "";
            document.querySelectorAll(".nav-links a").forEach(a => a.classList.remove("nav-active"));
            document.querySelector('.nav-links a[href="/spring-details.html"]')?.classList.add("nav-active");
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    }


    /* ══════════════════════════════════════════
       EVENT LISTENERS
    ══════════════════════════════════════════ */

    if (springTypeSelect) {
        springTypeSelect.addEventListener("change", () => {
            updateImage();
            if (editingSpringId) {
                // In edit mode: keep the same sequence number, just swap the type code
                const csTypes = ["CS1", "CS2", "CS3", "CS4"];
                const newCode = csTypes.includes(springTypeSelect.value) ? "CSH" : "VSH";
                const newTag  = (springTagInput ? springTagInput.value : "")
                                    .replace(/-(CSH|VSH)-/, `-${newCode}-`);
                if (springTagInput) springTagInput.value = newTag;
                if (tagDisplay) tagDisplay.textContent = newTag || "—";
            } else {
                generateTag();
            }
            updateSectionStatus();
        });
    }
    if (figureSelect) {
        figureSelect.addEventListener("change", () => { updateImage(); updateSectionStatus(); });
    }

    function parseTempValue(str) {
        const m = String(str || "").match(/[\d.]+/);
        return m ? parseFloat(m[0]) : NaN;
    }

    function applyFigureRestriction() {
        const temp       = parseTempValue(document.getElementById("designtemp")?.value);
        const springType = document.getElementById("springType")?.value;
        const figSelect  = document.getElementById("figure");
        const caution    = document.getElementById("cautionFigure");
        if (!figSelect) return;

        const restricted = !isNaN(temp) && temp >= 204 && (springType === "CS4" || springType === "VS4");
        const opt1 = figSelect.querySelector('option[value="1"]');

        if (restricted) {
            if (opt1) opt1.disabled = true;
            if (figSelect.value === "1") {
                figSelect.value = "";
                showToast("⚠ Figure 1 is not allowed for " + springType + " at ≥ 204 °C");
            }
            caution?.classList.remove("hidden");
        } else {
            if (opt1) opt1.disabled = false;
            caution?.classList.add("hidden");
        }
    }

    ["designtemp", "springType", "figure"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(id === "designtemp" ? "input" : "change", applyFigureRestriction);
    });

    function validateAngle() {

        const angle = updateAngleInfo();

        if (angle === undefined) {
            showToast("⚠ Enter Dimension (spring length)");
            return false;
        }

        if (angle > 5) {
            showToast("❌ Angle exceeds 5° limit");
            return false;
        }

        return true;
    }

    ["horizAxial", "horizTransverse", "dimension"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", validateAngle);
        }
    });


    ["horizAxial", "horizTransverse", "dimension"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => {
                update3D();
                updateAngleInfo();   // 🔥 ADD THIS BACK
            });
        }
    });

    function init3D() {

        const container = document.getElementById("threeContainer");
        if (!container) return;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0c0e1c);

        const w = container.clientWidth || 312;
        const h = container.clientHeight || 312;

        camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 1000);
        camera.position.set(1.5, 1.4, 3.0);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.innerHTML = "";
        container.appendChild(renderer.domElement);

        // Controls with smooth damping
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;

        // Ambient fill
        const ambient = new THREE.AmbientLight(0xffffff, 0.30);
        scene.add(ambient);

        // Key light (warm, top-right)
        const keyLight = new THREE.DirectionalLight(0xfff0dd, 1.3);
        keyLight.position.set(4, 7, 5);
        keyLight.castShadow = true;
        scene.add(keyLight);

        // Fill light (cool, left)
        const fillLight = new THREE.PointLight(0x4466cc, 0.55, 18);
        fillLight.position.set(-3, 2, -1);
        scene.add(fillLight);

        // Rim light (back edge highlight)
        const rimLight = new THREE.DirectionalLight(0x99aeff, 0.4);
        rimLight.position.set(-4, 2, -5);
        scene.add(rimLight);

        // Ground grid
        const grid = new THREE.GridHelper(4, 14, 0x1e2244, 0x131630);
        grid.position.y = -0.04;
        scene.add(grid);

        animate();
    }

    function update3D() {
        if (!scene) return;

        const hAxial = Number(document.getElementById("horizAxial").value) || 0;
        const hTrans = Number(document.getElementById("horizTransverse").value) || 0;
        const length = Number(document.getElementById("dimension").value);

        // Remove all previously added dynamic objects
        dynamicObjects.forEach(obj => {
            scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
        dynamicObjects = [];
        springLine = null;

        if (!length) return;

        const scale = 0.002;
        const targetVec = new THREE.Vector3(hAxial * scale, length * scale, hTrans * scale);
        const totalLength = targetVec.length();

        const horizontal = Math.sqrt(hAxial * hAxial + hTrans * hTrans);
        const angleDeg = Math.atan2(horizontal, length) * (180 / Math.PI);

        let color = 0x3a8e52;
        if (angleDeg > 3) color = 0xd08000;
        if (angleDeg > 5) color = 0xcc2525;

        // ── Helical spring coil ──
        const turns = 10;
        const coilRadius = 0.14;
        const tubeRadius = 0.022;
        const segments = 400;
        const endFrac = 1 / turns; // taper one full turn at each end
        const curvePoints = [];

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const helixAngle = t * Math.PI * 2 * turns;
            let r = coilRadius;
            if (t < endFrac) r = coilRadius * (t / endFrac);
            if (t > 1 - endFrac) r = coilRadius * ((1 - t) / endFrac);
            curvePoints.push(new THREE.Vector3(
                r * Math.cos(helixAngle),
                t * totalLength,
                r * Math.sin(helixAngle)
            ));
        }

        const curve = new THREE.CatmullRomCurve3(curvePoints);
        const springGeo = new THREE.TubeGeometry(curve, 300, tubeRadius, 12, false);
        const springMat = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.88,
            roughness: 0.11,
        });
        springLine = new THREE.Mesh(springGeo, springMat);
        springLine.castShadow = true;
        springLine.receiveShadow = true;

        // Rotate spring to match target direction
        const direction = targetVec.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
        springLine.applyQuaternion(quaternion);

        dynamicObjects.push(springLine);
        scene.add(springLine);

        // ── End plates ──
        const plateGeo = new THREE.CylinderGeometry(coilRadius * 1.1, coilRadius * 1.1, tubeRadius * 3, 32);
        const plateMat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.72, roughness: 0.22 });

        const bottomPlate = new THREE.Mesh(plateGeo, plateMat);
        bottomPlate.castShadow = true;
        dynamicObjects.push(bottomPlate);
        scene.add(bottomPlate);

        const topPlate = new THREE.Mesh(plateGeo, plateMat);
        topPlate.position.copy(direction.clone().multiplyScalar(totalLength));
        topPlate.quaternion.copy(quaternion);
        topPlate.castShadow = true;
        dynamicObjects.push(topPlate);
        scene.add(topPlate);

        // ── Angle annotation ──
        if (angleDeg > 0.2) {
            // Dashed vertical reference line
            const vertPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, totalLength * 0.65, 0)];
            const vertGeo = new THREE.BufferGeometry().setFromPoints(vertPts);
            const vertMat = new THREE.LineDashedMaterial({
                color: 0x7788ee, dashSize: 0.045, gapSize: 0.028,
                transparent: true, opacity: 0.65
            });
            const vertLine = new THREE.Line(vertGeo, vertMat);
            vertLine.computeLineDistances();
            dynamicObjects.push(vertLine);
            scene.add(vertLine);

            // Arc from vertical to spring direction
            const arcRadius = totalLength * 0.42;
            const arcAngleRad = angleDeg * Math.PI / 180;
            const rotAxis = up.clone().cross(direction).normalize();
            const arcPts = [];
            const arcSegs = 64;
            for (let i = 0; i <= arcSegs; i++) {
                const a = (i / arcSegs) * arcAngleRad;
                arcPts.push(up.clone().applyAxisAngle(rotAxis, a).multiplyScalar(arcRadius));
            }
            const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
            const arcMat = new THREE.LineBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.92 });
            const arcLine = new THREE.Line(arcGeo, arcMat);
            dynamicObjects.push(arcLine);
            scene.add(arcLine);

            // Floating angle label sprite
            const labelPos = up.clone()
                .applyAxisAngle(rotAxis, arcAngleRad / 2)
                .multiplyScalar(arcRadius * 1.55);

            const cv = document.createElement("canvas");
            cv.width = 220; cv.height = 76;
            const ctx = cv.getContext("2d");
            const labelColor = angleDeg <= 3 ? "#7ecf8a" : angleDeg <= 5 ? "#ffc86b" : "#e08080";
            const borderRgba = angleDeg <= 3 ? "rgba(126,207,138,0.55)" : angleDeg <= 5 ? "rgba(255,200,107,0.55)" : "rgba(224,128,128,0.55)";

            // Pill background
            ctx.beginPath();
            ctx.moveTo(18, 4); ctx.lineTo(202, 4);
            ctx.quadraticCurveTo(216, 4, 216, 18);
            ctx.lineTo(216, 58); ctx.quadraticCurveTo(216, 72, 202, 72);
            ctx.lineTo(18, 72); ctx.quadraticCurveTo(4, 72, 4, 58);
            ctx.lineTo(4, 18); ctx.quadraticCurveTo(4, 4, 18, 4);
            ctx.closePath();
            ctx.fillStyle = "rgba(8, 10, 28, 0.85)";
            ctx.fill();
            ctx.strokeStyle = borderRgba;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.font = "bold 32px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = labelColor;
            ctx.fillText(`${angleDeg.toFixed(1)}\u00B0`, 110, 38);

            const tex = new THREE.CanvasTexture(cv);
            const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.copy(labelPos);
            sprite.scale.set(0.38, 0.14, 1);
            dynamicObjects.push(sprite);
            scene.add(sprite);
        }
    }

    function updateAngleInfo() {

        const el = document.getElementById("angleInfo");
        if (!el) return;

        const hAxial = Number(document.getElementById("horizAxial").value) || 0;
        const hTrans = Number(document.getElementById("horizTransverse").value) || 0;
        const length = Number(document.getElementById("dimension").value);

        if (!length) {
            el.innerHTML = "Angle: --°";
            return;
        }

        const horizontal = Math.sqrt(hAxial * hAxial + hTrans * hTrans);
        const angle = Math.atan(horizontal / length) * (180 / Math.PI);

        // Color + message
        if (angle <= 3) {
            el.textContent = `${angle.toFixed(2)}° Safe`;
            el.style.cssText = "background:rgba(40,167,69,.18);border-color:rgba(40,167,69,.4);color:#7ecf8a;";
        } else if (angle <= 5) {
            el.textContent = `${angle.toFixed(2)}° Near limit`;
            el.style.cssText = "background:rgba(255,165,0,.15);border-color:rgba(255,165,0,.4);color:#ffc86b;";
        } else {
            el.textContent = `${angle.toFixed(2)}° Exceeds 5°`;
            el.style.cssText = "background:rgba(185,64,64,.18);border-color:rgba(185,64,64,.5);color:#e08080;";
        }

        return angle;
    }



    function animate() {
        requestAnimationFrame(animate);

        if (controls) controls.update();
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }
    document.addEventListener("DOMContentLoaded", () => {
        init3D();
        update3D();
        updateAngleInfo();   // 🔥 ADD THIS
    });

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

    const notesDrawer  = document.getElementById("notesDrawer");
    const notesNavBtn  = document.getElementById("notesNavBtn");
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
        const stdTab    = document.getElementById("notesTabStd");
        const customTab = document.getElementById("notesTabCustom");
        const stdPane   = document.getElementById("notesPaneStd");
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
        if (!data.length) {
            if (empty) empty.style.display = "flex";
            return;
        }
        if (empty) empty.style.display = "none";
        const myId   = localStorage.getItem("employee_id") || "";
        const myRole = localStorage.getItem("role") || "";
        data.forEach((note, idx) => {
            const card = document.createElement("div");
            card.className = "notes-custom-card";
            const noteNum = STANDARD_NOTES.length + idx + 1;
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
            const input  = document.getElementById("noteAddInput");
            const text   = input?.value?.trim();
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
       VIEW SPRINGS TABLE
    ══════════════════════════════════════════ */

    async function loadViewSpringsTable() {
        const jobNo  = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) return;

        const jobEl  = document.getElementById("vsPanelJob");
        const unitEl = document.getElementById("vsPanelUnit");
        if (jobEl)  jobEl.textContent  = jobNo;
        if (unitEl) unitEl.textContent = unitNo;

        try {
            const createdBy = getEmployeeId();
            const res  = await fetch(`/api/spring/list?jobNo=${jobNo}&unitNo=${unitNo}&createdBy=${encodeURIComponent(createdBy)}&aggregate=true`);
            const json = await res.json();
            updateVsAggregateBanner(json.meta);
            renderViewSpringsTable(json.data || []);
        } catch (err) { console.error("VS table load error:", err); }
    }

    function updateVsAggregateBanner(meta) {
        const banner = document.getElementById("vsAggregateBanner");
        if (!banner) return;
        if (meta && meta.aggregated) {
            document.getElementById("vsAggMasterUnit").textContent = meta.masterUnitNo;
            document.getElementById("vsAggMembers").textContent    = meta.members.join(", ");
            banner.classList.remove("hidden");
        } else {
            banner.classList.add("hidden");
        }
    }

    function renderViewSpringsTable(data) {
        const tbody      = document.getElementById("vsTableBody");
        const emptyRow   = document.getElementById("vsTableEmpty");
        const countBadge = document.getElementById("vsCountBadge");

        if (activeStatusFilter) {
            data = data.filter(e => (e.status || "saved") === activeStatusFilter);
        }

        tbody.querySelectorAll("tr:not(#vsTableEmpty)").forEach(r => r.remove());
        countBadge.textContent = data.length + " spring" + (data.length !== 1 ? "s" : "");

        if (data.length === 0) { emptyRow.style.display = ""; return; }
        emptyRow.style.display = "none";

        data.forEach((s, idx) => {
            const orderStatus = s.order_status || "Not Ordered";
            const orderKey    = orderStatus.toLowerCase().replace(/\s+/g, "-");
            const orderBadge  = `<span class="vs-order-badge vs-order-${orderKey}">${orderStatus}</span>`;

            const isOrdered = orderStatus === "Ordered" || orderStatus === "Delivered";
            const actionCell = isOrdered
                ? `<button class="vs-vendor-btn" onclick="openVendorModal(${s.id},'${s.spring_tag}')">
                       <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                       Vendor Data
                   </button>`
                : `<span style="font-size:11px;color:rgba(59,46,30,.3);">—</span>`;

            const statusKey   = (s.status || "saved").toLowerCase();
            const statusLabel = statusKey.charAt(0).toUpperCase() + statusKey.slice(1);
            const statusBadge = `<span class="vs-status-badge vs-status-${statusKey}">${statusLabel}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="vs-td-num">${idx + 1}</td>
                <td><span class="vs-tag-chip">${s.spring_tag || "—"}</span></td>
                <td>${s.line_id || "—"}</td>
                <td>${s.unit_no || "—"}</td>
                <td>${s.area || "—"}</td>
                <td><span class="vs-type-chip">${s.spring_type || "—"}</span>Fig.${s.figure || "—"} &times; ${s.quantity || "—"}</td>
                <td>${s.dimension != null ? s.dimension : "—"}</td>
                <td>${s.stress_system || "—"}</td>
                <td>${statusBadge}</td>
                <td class="vs-mr-cell">${s.mr_no || "—"}</td>
                <td class="vs-bid-cell">${s.bid_count > 0
                    ? `<span class="vs-bid-badge" title="${s.bid_count} vendor bid${s.bid_count !== 1 ? 's' : ''} received">${s.bid_count} vendor${s.bid_count !== 1 ? 's' : ''}</span>`
                    : `<span class="vs-bid-none">—</span>`}</td>
                <td>${orderBadge}</td>
                <td>${actionCell}</td>`;
            tbody.appendChild(tr);
        });
    }

    document.getElementById("vsRefreshBtn")?.addEventListener("click", loadViewSpringsTable);


    /* ── MR Excel Upload ──────────────────────────── */

    const vsUploadBtn     = document.getElementById("vsUploadMrBtn");
    const mrExcelInput    = document.getElementById("mrExcelFileInput");

    vsUploadBtn?.addEventListener("click", () => mrExcelInput?.click());

    mrExcelInput?.addEventListener("change", async function () {
        const file = this.files[0];
        if (!file) return;
        this.value = ""; // reset so same file can be re-selected

        const jobNo  = localStorage.getItem("jobno");
        const unitNo = localStorage.getItem("unit");
        if (!jobNo || !unitNo) { showToast("⚠️ No active Job/Unit session"); return; }

        vsUploadBtn.disabled = true;
        vsUploadBtn.textContent = "Uploading…";

        try {
            // Read file as base64
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = e => resolve(e.target.result.split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const res  = await fetch("/api/spring/upload-mr-excel", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ jobNo, unitNo, fileBase64: base64 })
            });
            const json = await res.json();

            if (!json.ok) throw new Error(json.error || "Upload failed");

            const msg = json.updated > 0
                ? `✅ Updated ${json.updated} of ${json.total} springs`
                : `ℹ️ No matching springs found in the file`;
            showToast(msg);

            await loadViewSpringsTable();

        } catch (err) {
            console.error("MR Excel upload error:", err);
            showToast("❌ Upload failed: " + err.message);
        } finally {
            vsUploadBtn.disabled = false;
            vsUploadBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload MR Excel`;
        }
    });


    /* ══════════════════════════════════════════
       VENDOR / ORDER DATA MODAL
    ══════════════════════════════════════════ */

    window.openVendorModal = async function (springId, tag) {
        document.getElementById("vdSpringId").value  = springId;
        document.getElementById("vdModalTag").textContent = tag;
        document.getElementById("vdRecordId").value  = "";
        ["vdVendorName","vdPoNo","vdPoDate","vdSpringDesignation","vdSpringConstant","vdPresetLoad","vdLoadVariation","vdRemarks"]
            .forEach(id => { document.getElementById(id).value = ""; });

        try {
            const res  = await fetch(`/api/spring/vendor-data/${springId}`);
            const json = await res.json();
            if (json.ok && json.data) {
                const d = json.data;
                document.getElementById("vdRecordId").value           = d.id || "";
                document.getElementById("vdVendorName").value         = d.vendor_name || "";
                document.getElementById("vdPoNo").value               = d.po_no || "";
                document.getElementById("vdPoDate").value             = d.po_date ? d.po_date.substring(0,10) : "";
                document.getElementById("vdSpringDesignation").value  = d.spring_designation || "";
                document.getElementById("vdSpringConstant").value     = d.spring_constant || "";
                document.getElementById("vdPresetLoad").value         = d.preset_load || "";
                document.getElementById("vdLoadVariation").value      = d.load_variation || "";
                document.getElementById("vdRemarks").value            = d.remarks || "";
            }
        } catch (err) { console.error("Vendor fetch error:", err); }

        document.getElementById("vendorModal").style.display = "flex";
    };

    function closeVendorModal() { document.getElementById("vendorModal").style.display = "none"; }

    document.getElementById("vdModalClose")?.addEventListener("click", closeVendorModal);
    document.getElementById("vdCancelBtn")?.addEventListener("click", closeVendorModal);

    document.getElementById("vendorDataForm")?.addEventListener("submit", async function (e) {
        e.preventDefault();
        const springId  = document.getElementById("vdSpringId").value;
        const recordId  = document.getElementById("vdRecordId").value;
        const payload   = {
            springId,
            vendorName:        document.getElementById("vdVendorName").value.trim(),
            poNo:              document.getElementById("vdPoNo").value.trim(),
            poDate:            document.getElementById("vdPoDate").value || null,
            springDesignation: document.getElementById("vdSpringDesignation").value.trim(),
            springConstant:    document.getElementById("vdSpringConstant").value.trim(),
            presetLoad:        document.getElementById("vdPresetLoad").value.trim(),
            loadVariation:     document.getElementById("vdLoadVariation").value.trim(),
            remarks:           document.getElementById("vdRemarks").value.trim(),
            createdBy:         getEmployeeId()
        };
        try {
            const url    = recordId ? `/api/spring/vendor-data/${recordId}` : `/api/spring/vendor-data`;
            const method = recordId ? "PUT" : "POST";
            const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const json   = await res.json();
            if (!json.ok) throw new Error(json.error || "Save failed");
            showToast("✅ Vendor data saved");
            closeVendorModal();
        } catch (err) { console.error("Vendor save error:", err); showToast("❌ Failed to save vendor data"); }
    });


    /* ══════════════════════════════════════════
       INIT
    ══════════════════════════════════════════ */

    /* ══════════════════════════════════════════
       SPRING EVALUATION CALCULATOR
    ══════════════════════════════════════════ */
    function initSpringEvaluator() {
        const opLoadEl    = document.getElementById("operatingLoad");
        const travelUpEl  = document.getElementById("travelUp");
        const travelDownEl= document.getElementById("travelDown");
        const slider      = document.getElementById("evalSlider");
        if (!slider) return;

        const sliderValEl   = document.getElementById("evalSliderVal");
        const evalOpLoadEl  = document.getElementById("evalOpLoad");
        const evalTravelEl  = document.getElementById("evalTravel");
        const evalDirEl     = document.getElementById("evalDirection");
        const evalErrorEl   = document.getElementById("evalError");
        const evalResultsEl = document.getElementById("evalResults");
        const evalPresetEl  = document.getElementById("evalPresetLoad");
        const evalStiffEl   = document.getElementById("evalStiffness");
        const evalAcceptBtn = document.getElementById("evalAcceptBtn");

        function recalc() {
            const variation = parseInt(slider.value, 10);
            sliderValEl.textContent = variation + "%";

            const opLoadRaw = opLoadEl.value.trim();
            const upRaw     = travelUpEl.value.trim();
            const downRaw   = travelDownEl.value.trim();
            const opLoad    = opLoadRaw !== "" ? parseFloat(opLoadRaw) : NaN;

            evalOpLoadEl.textContent = !isNaN(opLoad)
                ? opLoad.toLocaleString() + " KG" : "—";

            function showError(msg) {
                evalErrorEl.textContent  = msg;
                evalErrorEl.style.display  = "block";
                evalResultsEl.style.display = "none";
                if (evalAcceptBtn) evalAcceptBtn.style.display = "none";
                evalTravelEl.textContent = "—";
                evalDirEl.textContent    = "—";
                evalDirEl.className      = "eval-direction";
            }

            function showResults(presetLoad, stiffness, travel, dir) {
                evalErrorEl.style.display  = "none";
                evalResultsEl.style.display = "flex";
                if (evalAcceptBtn) evalAcceptBtn.style.display = "block";
                evalTravelEl.textContent   = Math.abs(travel).toFixed(2) + " MM";
                evalDirEl.textContent      = dir;
                evalDirEl.className        = "eval-direction " + dir.toLowerCase();
                evalPresetEl.textContent   = presetLoad.toFixed(2) + " KG";
                evalStiffEl.textContent    = stiffness.toFixed(3) + " KG/mm";
            }

            if (isNaN(opLoad)) { showError("Enter Operating Load to calculate."); return; }

            const upVal   = upRaw   !== "" ? parseFloat(upRaw)   : null;
            const downVal = downRaw !== "" ? parseFloat(downRaw) : null;
            const hasUp   = upVal   !== null && upVal   !== 0;
            const hasDown = downVal !== null && downVal !== 0;

            if (upRaw === "" && downRaw === "")    { showError("Travel value is missing."); return; }
            if (hasUp && hasDown)                  { showError("Only one of UP Travel or DOWN Travel can have a value."); return; }
            if (!hasUp && !hasDown)                { showError("Travel cannot be zero."); return; }

            const varFrac = variation / 100;
            let dir, travel, presetLoad, stiffness;

            if (hasUp) {
                dir       = "UP";
                travel    = Math.abs(upVal);
                presetLoad = opLoad * (1 + varFrac);
            } else {
                dir       = "DOWN";
                travel    = Math.abs(downVal);
                presetLoad = opLoad * (1 - varFrac);
            }

            stiffness = varFrac > 0 ? (opLoad * varFrac) / travel : 0;
            showResults(presetLoad, stiffness, travel, dir);
        }

        recalcSpringEvaluator = recalc;
        opLoadEl.addEventListener("input", recalc);
        travelUpEl.addEventListener("input", recalc);
        travelDownEl.addEventListener("input", recalc);
        slider.addEventListener("input", recalc);
        recalc();

        if (evalAcceptBtn) {
            evalAcceptBtn.addEventListener("click", function () {
                const variation = parseInt(slider.value, 10);
                const remarksEl = document.getElementById("remarks");
                if (remarksEl) {
                    const note = `Max Op Load Variation = ${variation}%`;
                    const existing = remarksEl.value.trim();
                    if (/Max Op Load Variation\s*=\s*\d+%/.test(existing)) {
                        remarksEl.value = existing.replace(/Max Op Load Variation\s*=\s*\d+%/, note);
                    } else {
                        remarksEl.value = existing ? existing + "\n" + note : note;
                    }
                }
            });
        }
    }

    generateTag();
    // loadJobs();
    renderSpringList();
    updateImage();
    updateSectionStatus();
    initSpringEvaluator();

})();