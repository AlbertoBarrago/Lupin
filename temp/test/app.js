document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('myForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const messageInput = document.getElementById('message');

    // Load data from localStorage on page load
    if (localStorage.getItem('formData')) {
        const formData = JSON.parse(localStorage.getItem('formData'));
        nameInput.value = formData.name || '';
        emailInput.value = formData.email || '';
        messageInput.value = formData.message || '';
    }

    form.addEventListener('submit', function(event) {
        event.preventDefault();
        const formData = {
            name: nameInput.value,
            email: emailInput.value,
            message: messageInput.value
        };
        localStorage.setItem('formData', JSON.stringify(formData));
        alert('Form submitted and data saved to localStorage!');
    });
});