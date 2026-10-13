const form = document.querySelector("#login-form");
const status = document.querySelector("#status");
const button = form.querySelector("button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Checking...";
  status.className = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
      }),
    });
    const result = await response.json();
    status.textContent = result.message;
    status.className = response.ok ? "success" : "error";
    if (response.status === 429) {
      status.textContent += ` Try again in ${response.headers.get("Retry-After")} seconds.`;
    }
  } catch {
    status.textContent = "Could not reach the local server. Try again.";
    status.className = "error";
  } finally {
    button.disabled = false;
  }
});
