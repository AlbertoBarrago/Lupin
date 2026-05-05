document.addEventListener("DOMContentLoaded", () => {
	const form = document.getElementById("myForm");
	const nameInput = document.getElementById("name");
	const emailInput = document.getElementById("email");
	const messageInput = document.getElementById("message");

	// Load data from sessionStorage on page load
	if (sessionStorage.getItem("formData")) {
		const formData = JSON.parse(sessionStorage.getItem("formData"));
		nameInput.value = formData.name || "";
		emailInput.value = formData.email || "";
		messageInput.value = formData.message || "";
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const formData = {
			name: nameInput.value,
			email: emailInput.value,
			message: messageInput.value,
		};
		sessionStorage.setItem("formData", JSON.stringify(formData));
		alert("Form submitted and data saved to sessionStorage!");
	});

	// Add a delete button event listener
	document.getElementById("clearButton").addEventListener("click", () => {
		sessionStorage.removeItem("formData");
		nameInput.value = "";
		emailInput.value = "";
		messageInput.value = "";
		alert("Data removed from sessionStorage and form cleared!");
	});
});
