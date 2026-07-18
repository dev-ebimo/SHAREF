document.addEventListener('DOMContentLoaded', () => {
    const cards = document.querySelectorAll('.suggestion-card');
    
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.style.transition = 'all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 300 + (index * 150));
    });
});
