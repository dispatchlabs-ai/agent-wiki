const form = document.querySelector("#agent-consent");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = new URLSearchParams(new FormData(form));
  body.set("decision", event.submitter.value);
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((button) => (button.disabled = true));
  try {
    const response = await fetch("/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Connection failed");
    location.assign(result.redirect);
  } catch (error) {
    form.querySelector("[role=status]").textContent = error.message;
    buttons.forEach((button) => (button.disabled = false));
  }
});
