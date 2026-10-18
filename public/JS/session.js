// Shared sign-in handling for every SSMS page (added 2026-10-18).
// The server signs users in with the shared single sign-on cookie (same account as
// ePULSE / MRCS); this script keeps the page's stored assignments in step with it.
//   Login page  : already signed in (e.g. through ePULSE) → go straight to the dashboard.
//   Other pages : refresh assignments; signed out or a different user → act on it.
//   Any page    : a 401 from the API sends the user back to the login page;
//                 the logout button also signs out on the server (all modules).
(function () {
    const LOGIN = "/Login.html";
    const onLogin = /\/login\.html$/i.test(location.pathname);

    function store(assignments) {
        localStorage.setItem("assignments", JSON.stringify(assignments));
        localStorage.setItem("role", assignments[0].role);
        localStorage.setItem("employee_id", assignments[0].employee_id);
        localStorage.setItem("employee_name", assignments[0].employee_name || assignments[0].employee_id);
    }

    function toLogin() {
        localStorage.clear();
        if (!onLogin) location.href = LOGIN;
    }

    // Any API call that finds the session gone → back to the login page
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const res = await realFetch(input, init);
        const url = typeof input === "string" ? input : input.url;
        if (res.status === 401 && url.includes("/api/") && !url.includes("/api/auth/login")) toLogin();
        return res;
    };

    // Logout: tell the server first (sendBeacon survives the page's own redirect)
    document.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("#logoutBtn")) navigator.sendBeacon("/api/auth/logout");
    }, true);

    realFetch("/api/auth/assignments").then(async res => {
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) return toLogin();
        if (!json.ok || !json.data || !json.data.length) {
            if (res.status === 403 && !onLogin) { alert(json.error); navigator.sendBeacon("/api/auth/logout"); toLogin(); }
            return;
        }
        const sameUser = (localStorage.getItem("employee_id") || "").toUpperCase() === json.data[0].employee_id.toUpperCase();
        store(json.data);
        if (onLogin || !sameUser) location.href = "/dashboard.html";
    }).catch(() => { /* server unreachable — the page shows its own errors */ });
})();
