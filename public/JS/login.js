const form = document.getElementById("loginForm");

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