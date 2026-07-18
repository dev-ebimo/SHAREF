document.addEventListener("DOMContentLoaded", () => {
  // ==========================================================================
  // FAQ ACCORDION
  // ==========================================================================
  const faqItems = document.querySelectorAll(".faq-item");

  faqItems.forEach((item) => {
    const questionBtn = item.querySelector(".faq-question");

    questionBtn.addEventListener("click", () => {
      // Close other open FAQs
      faqItems.forEach((otherItem) => {
        if (otherItem !== item && otherItem.classList.contains("active")) {
          otherItem.classList.remove("active");
        }
      });

      // Toggle current FAQ
      item.classList.toggle("active");
    });
  });

  // ==========================================================================
  // HELP ARTICLE SEARCH FILTER (page content, not the top-nav omnibar)
  // ==========================================================================
  const searchInput = document.getElementById("helpSearch");
  const helpContentArea = document.getElementById("helpContentArea");
  const helpEmptyState = document.getElementById("helpEmptyState");

  if (searchInput && helpContentArea && helpEmptyState) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();

      if (query.length > 2) {
        const pageText = helpContentArea.innerText.toLowerCase();
        if (!pageText.includes(query)) {
          helpContentArea.classList.add("hidden");
          helpEmptyState.classList.remove("hidden");
        } else {
          helpContentArea.classList.remove("hidden");
          helpEmptyState.classList.add("hidden");
        }
      } else {
        helpContentArea.classList.remove("hidden");
        helpEmptyState.classList.add("hidden");
      }
    });
  }
});
