const form = document.getElementById("loginForm");

document.getElementById("togglePassword").addEventListener("click", function () {
    const pwInput = document.getElementById("password");
    const icon    = document.getElementById("eyeIcon");
    const showing = pwInput.type === "text";
    pwInput.type  = showing ? "password" : "text";
    icon.innerHTML = showing
        ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`
        : `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
           <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
           <line x1="1" y1="1" x2="23" y2="23"/>`;
});

form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const employee_id = document.getElementById("userid").value.trim();
    const password    = document.getElementById("password").value;

    try {
        const res = await fetch('/api/auth/login', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id, password })
        });

        const json = await res.json();

        if (!json.ok) {
            alert(json.error || "Login failed");
            return;
        }

        const assignments = json.data;

        // ✅ Store assignments (IMPORTANT)
        localStorage.setItem("assignments", JSON.stringify(assignments));

        // ✅ Store role and employee_id (take from first row)
        localStorage.setItem("role", assignments[0].role);
        localStorage.setItem("employee_id", assignments[0].employee_id);
        localStorage.setItem("employee_name", assignments[0].employee_name || assignments[0].employee_id);

        // ❌ DO NOT STORE job/unit HERE anymore

        // ✅ Redirect all roles to the unified Dashboard
        window.location.href = "/dashboard.html";

    } catch (err) {
        console.error(err);
        alert("Server error");
    }
});