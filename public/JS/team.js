/* SSMS — Team page (LE / GL). Rules are enforced by the server (/api/team). */
(function () {
    "use strict";

    const assignments = JSON.parse(localStorage.getItem("assignments") || "[]");
    const managing = assignments.filter(a => a.role === "GL" || a.role === "LE");
    if (!managing.length) { location.href = "/dashboard.html"; return; }

    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    $("tmUser").textContent = localStorage.getItem("employee_name") || "";
    $("logoutBtn").addEventListener("click", () => { localStorage.clear(); location.href = "/Login.html"; });

    // One entry per job / unit the user manages
    const units = [...new Map(managing.map(a => [`${a.job_no}|${a.unit_no}`, a])).values()];
    $("tmUnit").innerHTML = units.map(a =>
        `<option value="${esc(a.job_no)}|${esc(a.unit_no)}">${esc(a.job_no)} / ${esc(a.unit_no)}</option>`).join("");

    let people = [];
    const current = () => { const [jobNo, unitNo] = $("tmUnit").value.split("|"); return { jobNo, unitNo }; };
    const qs = () => new URLSearchParams(current()).toString();
    function msg(text, kind) { $("tmMsg").textContent = text || ""; $("tmMsg").className = "tm-msg " + (kind || ""); }

    async function load() {
        msg("");
        const [teamRes, candRes] = await Promise.all([fetch(`/api/team?${qs()}`), fetch(`/api/team/candidates?${qs()}`)]);
        const team = await teamRes.json(), cand = await candRes.json();
        if (!team.ok) { $("tmBody").innerHTML = `<tr><td colspan="6">${esc(team.error)}</td></tr>`; return; }

        const canAdd = team.meta.canAdd;
        $("tmAddCard").hidden = !canAdd.length;
        $("tmRole").innerHTML = canAdd.map(r => `<option>${r}</option>`).join("");
        people = cand.ok ? cand.data : [];
        $("tmPeople").innerHTML = people.map(p => `<option value="${esc(p.employee_id)} — ${esc(p.employee_name)}"></option>`).join("");

        $("tmBody").innerHTML = team.data.length ? team.data.map(r => `
            <tr>
                <td>${esc(r.employee_name || "—")}</td>
                <td>${esc(r.employee_id)}</td>
                <td><span class="tm-role">${esc(r.role)}</span></td>
                <td>${esc(r.department)}</td>
                <td class="tm-src">${r.source === "pims" ? "PIMS" : esc(r.assigned_by || "—")}</td>
                <td>${r.can_remove ? `<button class="tm-btn tm-danger" data-id="${esc(r.employee_id)}" data-role="${esc(r.role)}">Remove</button>` : ""}</td>
            </tr>`).join("") : `<tr><td colspan="6">No one on this unit yet.</td></tr>`;
    }

    async function change(method, employeeId, role) {
        const res = await fetch("/api/team", {
            method, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...current(), employeeId, role })
        });
        return res.json();
    }

    $("tmAdd").addEventListener("click", async () => {
        const typed = $("tmPerson").value.trim();
        const id = typed.split(/\s+—\s+/)[0].trim();
        const person = people.find(p => p.employee_id.toUpperCase() === id.toUpperCase());
        if (!person) return msg("Pick a person from the list (your department only).", "err");
        $("tmAdd").disabled = true;
        try {
            const j = await change("POST", person.employee_id, $("tmRole").value);
            if (!j.ok) return msg(j.error, "err");
            $("tmPerson").value = "";
            await load();
            msg(j.alreadyMember ? `${person.employee_name} already has that role.` : `${person.employee_name} added as ${$("tmRole").value}.`, "ok");
        } finally { $("tmAdd").disabled = false; }
    });

    $("tmBody").addEventListener("click", async e => {
        const b = e.target.closest("button[data-id]");
        if (!b || !confirm(`Remove ${b.dataset.id} as ${b.dataset.role}?`)) return;
        const j = await change("DELETE", b.dataset.id, b.dataset.role);
        if (!j.ok) return msg(j.error, "err");
        await load();
        msg(`${b.dataset.id} removed.`, "ok");
    });

    $("tmUnit").addEventListener("change", load);
    load().catch(() => msg("Could not load the team.", "err"));
})();
