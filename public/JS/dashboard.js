/* ============================================================
   SSMS — Analytics Dashboard
   JS/dashboard.js
   ============================================================ */

(function () {
    "use strict";

    /* ══════════════════════════════════════════
       AUTH GUARD
    ══════════════════════════════════════════ */
    const role        = localStorage.getItem("role");
    const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
    const employeeId  = localStorage.getItem("employee_id") || "";

    if (!role || assignments.length === 0) {
        window.location.href = "/Login.html";
        return;
    }

    // MAT users belong on Spring Index, not the dashboard
    if (role === "MAT") {
        window.location.href = "/spring-index.html";
        return;
    }

    /* ══════════════════════════════════════════
       NAV SETUP — role-based visibility
    ══════════════════════════════════════════ */
    // Role badge
    const roleBadge = document.getElementById("roleBadge");
    if (roleBadge) {
        roleBadge.textContent = role;
        roleBadge.className = "db-role-badge role-" + role.toLowerCase();
    }

    // User avatar / name
    const employeeName    = localStorage.getItem("employee_name") || employeeId;
    const userAvatar      = document.getElementById("userAvatar");
    const userNameDisplay = document.getElementById("userNameDisplay");
    if (userAvatar) {
        const parts = employeeName.trim().split(/\s+/);
        userAvatar.textContent = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : employeeName.slice(0, 2).toUpperCase();
    }
    if (userNameDisplay) userNameDisplay.textContent = employeeName;

    // Hide LE link for JE
    const leLink     = document.getElementById("leLink");
    const quickLeBtn = document.getElementById("quickLeBtn");
    if (role === "JE") {
        if (leLink)     leLink.style.display     = "none";
        if (quickLeBtn) quickLeBtn.style.display = "none";
    }

    // Team page — for anyone who is LE or GL on some unit
    const teamLink = document.getElementById("teamLink");
    if (teamLink && assignments.some(a => a.role === "GL" || a.role === "LE")) teamLink.style.display = "";

    // Logout
    document.getElementById("logoutBtn").addEventListener("click", () => {
        localStorage.clear();
        window.location.href = "/Login.html";
    });

    // Change Job / Unit — focus the context bar
    const changeJobUnitBtn = document.getElementById("changeJobUnitBtn");
    if (changeJobUnitBtn) {
        changeJobUnitBtn.addEventListener("click", () => {
            const dropdown = document.getElementById("userDropdown");
            if (dropdown) dropdown.classList.remove("open");
            const ctxJobNo = document.getElementById("ctxJobNo");
            if (ctxJobNo) {
                ctxJobNo.scrollIntoView({ behavior: "smooth", block: "center" });
                ctxJobNo.focus();
            }
        });
    }

    // Export
    document.getElementById("exportBtn").addEventListener("click", () => {
        const jobNo  = document.getElementById("ctxJobNo").value;
        const unitNo = document.getElementById("ctxUnitNo").value;
        if (!jobNo || !unitNo) { showToast("Select a Job & Unit first"); return; }
        const url  = `/api/spring/export?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}&aggregate=true`;
        const link = document.createElement("a");
        link.href  = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("Exporting approved springs…");
    });


    /* ══════════════════════════════════════════
       CONTEXT BAR — Job / Unit selectors
    ══════════════════════════════════════════ */
    const ctxJobNo  = document.getElementById("ctxJobNo");
    const ctxUnitNo = document.getElementById("ctxUnitNo");

    // Load job list
    fetch("/api/master/jobs")
        .then(r => r.json())
        .then(j => {
            if (!j.ok) return;
            j.data.forEach(row => {
                const opt = document.createElement("option");
                opt.value = row.job_no;
                opt.textContent = row.job_no;
                ctxJobNo.appendChild(opt);
            });

            // Restore from localStorage
            const savedJob  = localStorage.getItem("jobno");
            const savedUnit = localStorage.getItem("unit");
            if (savedJob)  ctxJobNo.value  = savedJob;
            if (savedUnit) ctxUnitNo.value = savedUnit;

            // Auto-load if context already set
            if (savedJob && savedUnit) {
                loadUnits(savedJob).then(() => {
                    ctxUnitNo.value = savedUnit;
                    loadDashboard(savedJob, savedUnit);
                });
            } else if (savedJob) {
                loadUnits(savedJob);
            }
        })
        .catch(() => {});

    ctxJobNo.addEventListener("change", () => {
        ctxUnitNo.innerHTML = '<option value="">— Unit No. —</option>';
        if (ctxJobNo.value) loadUnits(ctxJobNo.value);
    });

    function loadUnits(jobNo) {
        return fetch(`/api/master/units?jobNo=${encodeURIComponent(jobNo)}`)
            .then(r => r.json())
            .then(j => {
                if (!j.ok) return;
                ctxUnitNo.innerHTML = '<option value="">— Unit No. —</option>';
                j.data.forEach(row => {
                    const opt = document.createElement("option");
                    opt.value = row.unit_no;
                    opt.textContent = row.is_master
                        ? `${row.unit_no} — Master (${(row.master_members || []).join(", ")})`
                        : row.unit_no;
                    ctxUnitNo.appendChild(opt);
                });
            });
    }

    document.getElementById("ctxLoadBtn").addEventListener("click", () => {
        const jobNo  = ctxJobNo.value;
        const unitNo = ctxUnitNo.value;
        if (!jobNo)  { showToast("Please select a Job No."); return; }
        if (!unitNo) { showToast("Please select a Unit No."); return; }
        localStorage.setItem("jobno", jobNo);
        localStorage.setItem("unit", unitNo);
        loadDashboard(jobNo, unitNo);
    });

    document.getElementById("refreshBtn").addEventListener("click", () => {
        const jobNo  = ctxJobNo.value;
        const unitNo = ctxUnitNo.value;
        if (!jobNo || !unitNo) { showToast("No context loaded"); return; }
        loadDashboard(jobNo, unitNo);
    });


    /* ══════════════════════════════════════════
       CHART INSTANCES
    ══════════════════════════════════════════ */
    let statusChart = null;
    let typeChart   = null;
    let cshVshChart = null;

    /* ══════════════════════════════════════════
       MAIN LOAD FUNCTION
    ══════════════════════════════════════════ */
    function loadDashboard(jobNo, unitNo) {
        // UI state
        document.getElementById("dashPlaceholder").style.display = "none";
        document.getElementById("dashContent").style.display     = "none";
        document.getElementById("dashLoading").style.display     = "flex";

        // Update subtitle
        document.getElementById("dashSubtitle").textContent =
            `Showing analytics for Job ${jobNo} · Unit ${unitNo}`;

        // Context chip
        const chip  = document.getElementById("activeContextChip");
        const label = document.getElementById("activeContextLabel");
        chip.style.display  = "flex";
        label.textContent   = `${jobNo} / ${unitNo}`;

        // Build URL — JE sees only their own data (createdBy keeps it personal).
        // Everyone gets aggregate mode: if the selected unit is a master unit,
        // the backend widens the filter to the whole group; harmless otherwise.
        const createdBy = (role === "JE") ? `&createdBy=${encodeURIComponent(employeeId)}` : "";
        const url = `/api/spring/analytics?jobNo=${encodeURIComponent(jobNo)}&unitNo=${encodeURIComponent(unitNo)}${createdBy}&aggregate=true`;

        fetch(url)
            .then(r => r.json())
            .then(json => {
                if (!json.ok) throw new Error(json.error || "API error");
                updateDashAggregateBanner(json.meta);
                renderDashboard(json.data, jobNo, unitNo);
            })
            .catch(err => {
                document.getElementById("dashLoading").style.display = "none";
                document.getElementById("dashPlaceholder").style.display = "flex";
                showToast("Failed to load analytics: " + err.message);
            });
    }

    function updateDashAggregateBanner(meta) {
        const banner = document.getElementById("dashAggregateBanner");
        if (!banner) return;
        if (meta && meta.aggregated) {
            document.getElementById("dashAggMasterUnit").textContent = meta.masterUnitNo;
            document.getElementById("dashAggMembers").textContent    = meta.members.join(", ");
            banner.classList.remove("hidden");
        } else {
            banner.classList.add("hidden");
        }
    }

    /* ══════════════════════════════════════════
       RENDER
    ══════════════════════════════════════════ */
    function renderDashboard(data, jobNo, unitNo) {
        const { statusBreakdown, typeBreakdown, engineerBreakdown, lineBreakdown, recentActivity } = data;

        // Aggregate status
        const statusMap = {};
        statusBreakdown.forEach(r => { statusMap[r.status] = r.count; });
        const total    = Object.values(statusMap).reduce((a, b) => a + b, 0);
        const approved = statusMap["approved"]  || 0;
        const pending  = statusMap["submitted"] || 0;
        const rejected = statusMap["rejected"]  || 0;
        const hold     = statusMap["hold"]       || 0;
        const saved    = statusMap["saved"]      || 0;
        const lines    = lineBreakdown.length;

        // ── KPI Cards ──
        animateCount("kpiTotal",    total);
        animateCount("kpiApproved", approved);
        animateCount("kpiPending",  pending);
        animateCount("kpiRejected", rejected + hold);
        animateCount("kpiLines",    lines);

        const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
        document.getElementById("approvalRateBar").style.width = approvalRate + "%";
        document.getElementById("approvalRateLabel").textContent = `${approvalRate}% approval rate`;

        document.getElementById("kpiTotalDelta").innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            ${engineerBreakdown.length} engineer${engineerBreakdown.length !== 1 ? "s" : ""} active`;

        document.getElementById("kpiPendingDelta").innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${saved} saved, not submitted`;

        document.getElementById("kpiRejectedDelta").innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            ${rejected} rejected · ${hold} on hold`;

        document.getElementById("kpiLinesDelta").innerHTML = `
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            ${lineBreakdown.filter(l => l.approved === l.total && l.total > 0).length} fully approved`;

        // ── Status Donut ──
        document.getElementById("donutTotal").textContent = total;
        document.getElementById("statusBadge").textContent = `${jobNo} / ${unitNo}`;
        renderStatusDonut({ approved, pending, rejected, hold, saved });

        // ── Type Bar ──
        renderTypeBar(typeBreakdown);

        // ── CSH / VSH ──
        const cshTypes = ["CS1", "CS2", "CS3", "CS4"];
        let cshCount = 0, vshCount = 0;
        typeBreakdown.forEach(r => {
            if (cshTypes.includes(r.spring_type)) cshCount += r.count;
            else vshCount += r.count;
        });
        animateCount("cshCount", cshCount);
        animateCount("vshCount", vshCount);

        // CSH/VSH approved from engineer table
        const cshApproved = engineerBreakdown.length ? "—" : "—";
        document.getElementById("cshApproved").textContent = "—";
        document.getElementById("vshApproved").textContent = "—";
        document.getElementById("engCount").textContent    = engineerBreakdown.length;
        renderCshVsh(cshCount, vshCount);

        // ── Engineer Table ──
        renderEngineerTable(engineerBreakdown);

        // ── Line Progress ──
        renderLineProgress(lineBreakdown);

        // ── Activity Feed ──
        renderActivityFeed(recentActivity);

        // Last updated
        const lastWrap = document.getElementById("lastUpdatedWrap");
        const lastText = document.getElementById("lastUpdatedText");
        lastWrap.style.display = "flex";
        lastText.textContent   = "Updated " + new Date().toLocaleTimeString();

        // Show content
        document.getElementById("dashLoading").style.display  = "none";
        document.getElementById("dashContent").style.display  = "block";
    }


    /* ══════════════════════════════════════════
       STATUS DONUT
    ══════════════════════════════════════════ */
    function renderStatusDonut({ approved, pending, rejected, hold, saved }) {
        const ctx    = document.getElementById("statusDonutChart").getContext("2d");
        const labels = ["Approved", "Pending", "Rejected", "On Hold", "Saved"];
        const values = [approved,   pending,   rejected,   hold,      saved];
        const colors = ["#4e7553",  "#d4a96a",  "#b94040",  "#6b7fa3", "#c0b8ac"];

        if (statusChart) statusChart.destroy();

        statusChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data:            values,
                    backgroundColor: colors,
                    borderWidth:     3,
                    borderColor:     "#ffffff",
                    hoverBorderWidth: 4,
                    hoverOffset:     6
                }]
            },
            options: {
                cutout:       "70%",
                plugins:      { legend: { display: false }, tooltip: { callbacks: {
                    label: ctx => {
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        const pct   = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                        return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                    }
                }}},
                animation:    { animateRotate: true, duration: 900 }
            }
        });

        // Legend
        const legend = document.getElementById("statusLegend");
        legend.innerHTML = "";
        labels.forEach((lbl, i) => {
            if (values[i] === 0) return;
            const total = values.reduce((a, b) => a + b, 0);
            const pct   = total > 0 ? Math.round((values[i] / total) * 100) : 0;
            legend.insertAdjacentHTML("beforeend", `
                <div class="legend-item">
                    <div class="legend-dot" style="background:${colors[i]};"></div>
                    <span>${lbl} <strong>${pct}%</strong></span>
                </div>`);
        });
    }


    /* ══════════════════════════════════════════
       TYPE BAR CHART
    ══════════════════════════════════════════ */
    function renderTypeBar(typeBreakdown) {
        const ctx = document.getElementById("typeBarChart").getContext("2d");

        const ALL_TYPES = ["CS1","CS2","CS3","CS4","VS1","VS2","VS3","VS4","VS5"];
        const typeMap   = {};
        typeBreakdown.forEach(r => { typeMap[r.spring_type] = r.count; });

        const labels = ALL_TYPES.filter(t => (typeMap[t] || 0) > 0);
        const values = labels.map(t => typeMap[t] || 0);

        const cshTypes = new Set(["CS1","CS2","CS3","CS4"]);
        const bgColors = labels.map(t => cshTypes.has(t)
            ? "rgba(212,169,106,0.80)"
            : "rgba(107,127,163,0.80)");
        const borderColors = labels.map(t => cshTypes.has(t) ? "#c4913d" : "#4e6492");

        if (typeChart) typeChart.destroy();

        typeChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label:           "Springs",
                    data:            values,
                    backgroundColor: bgColors,
                    borderColor:     borderColors,
                    borderWidth:     2,
                    borderRadius:    6,
                    borderSkipped:   false
                }]
            },
            options: {
                indexAxis: "y",
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: {
                        label: ctx => ` ${ctx.parsed.x} spring${ctx.parsed.x !== 1 ? "s" : ""}`
                    }}
                },
                scales: {
                    x: {
                        grid:  { color: "rgba(59,46,30,.07)" },
                        ticks: { font: { family: "'DM Sans',sans-serif", size: 12 }, color: "#6b5440" },
                        beginAtZero: true
                    },
                    y: {
                        grid:  { display: false },
                        ticks: { font: { family: "'Courier New',monospace", size: 13, weight: "600" }, color: "#3b2e1e" }
                    }
                },
                animation: { duration: 800, easing: "easeOutQuart" }
            }
        });

        document.getElementById("typeBadge").textContent = labels.length + " types used";
    }


    /* ══════════════════════════════════════════
       CSH vs VSH MINI DONUT
    ══════════════════════════════════════════ */
    function renderCshVsh(csh, vsh) {
        const ctx = document.getElementById("cshVshChart").getContext("2d");
        if (cshVshChart) cshVshChart.destroy();

        cshVshChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels:   ["CSH", "VSH"],
                datasets: [{
                    data:            [csh, vsh],
                    backgroundColor: ["rgba(212,169,106,0.85)", "rgba(107,127,163,0.8)"],
                    borderWidth:     3,
                    borderColor:     "#fff",
                    hoverOffset:     4
                }]
            },
            options: {
                cutout:  "65%",
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.parsed}`
                    }}
                },
                animation: { animateRotate: true, duration: 800 }
            }
        });
    }


    /* ══════════════════════════════════════════
       ENGINEER TABLE
    ══════════════════════════════════════════ */
    function renderEngineerTable(rows) {
        const tbody = document.getElementById("engTableBody");

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--bark-light);font-size:13px;">No engineer data available</td></tr>`;
            return;
        }

        const maxTotal = Math.max(...rows.map(r => r.total), 1);

        tbody.innerHTML = rows.map(r => {
            const pct     = r.total > 0 ? Math.round((r.approved / r.total) * 100) : 0;
            const initials = (r.created_by || "?").slice(0, 2).toUpperCase();
            const barW    = Math.round((r.total / maxTotal) * 100);

            return `<tr>
                <td>
                    <div class="eng-name-cell">
                        <div class="eng-avatar">${initials}</div>
                        <div>
                            <div class="eng-id">${r.created_by || "Unknown"}</div>
                            <div class="eng-bar-wrap" style="width:80px;">
                                <div class="eng-bar-fill" style="width:${barW}%"></div>
                            </div>
                        </div>
                    </div>
                </td>
                <td><strong>${r.total}</strong></td>
                <td><span class="status-pill-sm pill-approved">${r.approved}</span></td>
                <td><span class="status-pill-sm pill-pending">${r.pending}</span></td>
                <td><span class="status-pill-sm pill-rejected">${r.rejected}</span></td>
                <td><strong style="color:${pct >= 70 ? "var(--sage-deep)" : pct >= 40 ? "#b8892e" : "var(--col-rejected)"}">${pct}%</strong></td>
            </tr>`;
        }).join("");
    }


    /* ══════════════════════════════════════════
       LINE PROGRESS
    ══════════════════════════════════════════ */
    function renderLineProgress(rows) {
        const container = document.getElementById("lineList");

        if (!rows || rows.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--bark-light);font-size:13px;">No line data available</div>`;
            return;
        }

        // Sort: fully approved first, then by % desc
        rows = [...rows].sort((a, b) => {
            const pA = a.total > 0 ? a.approved / a.total : 0;
            const pB = b.total > 0 ? b.approved / b.total : 0;
            return pB - pA;
        });

        container.innerHTML = rows.map(r => {
            const pct       = r.total > 0 ? Math.round((r.approved / r.total) * 100) : 0;
            const fillClass = pct === 100 ? "complete" : pct > 0 ? "partial" : "none";
            return `
                <div class="line-item">
                    <div class="line-item-header">
                        <span class="line-id-label">${r.line_id}</span>
                        <div class="line-stats">
                            <span class="line-stat">${r.approved}/${r.total}</span>
                            <span class="line-pct">${pct}%</span>
                        </div>
                    </div>
                    <div class="line-track">
                        <div class="line-fill ${fillClass}" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }).join("");
    }


    /* ══════════════════════════════════════════
       ACTIVITY FEED
    ══════════════════════════════════════════ */
    function renderActivityFeed(rows) {
        const feed = document.getElementById("activityFeed");
        document.getElementById("activityCount").textContent = rows.length + " records";

        if (!rows || rows.length === 0) {
            feed.innerHTML = `<div style="text-align:center;padding:24px;color:var(--bark-light);font-size:13px;">No recent activity</div>`;
            return;
        }

        feed.innerHTML = rows.map(r => {
            const dotClass = `dot-${r.status}`;
            const actClass = `act-${r.status}`;
            const metaParts = [];
            if (r.line_id)     metaParts.push(`Line: ${r.line_id}`);
            if (r.spring_type) metaParts.push(`Type: ${r.spring_type}`);
            if (r.node_no)     metaParts.push(`Node: ${r.node_no}`);
            if (r.created_by)  metaParts.push(`By: <strong>${r.created_by}</strong>`);
            if (r.reviewed_by && r.reviewed_by !== r.created_by)
                metaParts.push(`Rev: <strong>${r.reviewed_by}</strong>`);

            return `
                <div class="activity-item">
                    <div class="activity-dot-wrap">
                        <div class="activity-dot ${dotClass}"></div>
                        <div class="activity-line"></div>
                    </div>
                    <div class="activity-body">
                        <div class="activity-tag">${r.spring_tag}</div>
                        <div class="activity-meta">
                            <span class="activity-status ${actClass}">${r.status}</span>
                            ${metaParts.join(" · ")}
                        </div>
                    </div>
                </div>`;
        }).join("");
    }


    /* ══════════════════════════════════════════
       ANIMATED COUNTER
    ══════════════════════════════════════════ */
    function animateCount(id, target) {
        const el = document.getElementById(id);
        if (!el) return;

        const start    = 0;
        const duration = 900;
        const step     = 16;
        const steps    = Math.ceil(duration / step);
        let   current  = start;
        let   i        = 0;

        const timer = setInterval(() => {
            i++;
            current = Math.round(start + (target - start) * easeOut(i / steps));
            el.textContent = current.toLocaleString();
            if (i >= steps) {
                clearInterval(timer);
                el.textContent = target.toLocaleString();
            }
        }, step);
    }

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }


    /* ══════════════════════════════════════════
       TOAST
    ══════════════════════════════════════════ */
    function showToast(msg) {
        const t = document.getElementById("dbToast");
        t.textContent = msg;
        t.classList.add("show");
        setTimeout(() => t.classList.remove("show"), 3200);
    }

})();
