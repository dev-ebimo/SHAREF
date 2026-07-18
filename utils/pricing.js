// Tiered pricing:
//  - 1–5 pages:   flat ₦200 (protects against near-free charges on short past questions/assignments)
//  - 6–24 pages:  ₦20 per page
//  - 25+ pages:   ₦10 per page (flat across the whole document, not just the pages above 24)
function calculateResourceCost(pages) {
  if (pages <= 5) return 200;
  if (pages <= 24) return 200 + (pages - 5) * 20;
  return 580 + (pages - 24) * 10;
}

module.exports = calculateResourceCost;