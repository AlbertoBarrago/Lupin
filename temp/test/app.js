document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('myForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const messageInput = document.getElementById('message');

    // Load data from localStorage on page load
    if (localStorage.getItem('name')) {
        nameInput.value = localStorage.getItem('name');
    }
    if (localStorage.getItem('email')) {
        emailInput.value = localStorage.getItem('email');
    }
    if (localStorage.getItem('message')) {
        messageInput.value = localStorage.getItem('message');
    }

    // Save data to localStorage on form submit
    form.addEventListener('submit', function(event) {
        event.preventDefault();
        localStorage.setItem('name', nameInput.value);
        localStorage.setItem('email', emailInput.value);
        localStorage.setItem('message', messageInput.value);
        alert('Form submitted and data saved to localStorage!');
    });
});