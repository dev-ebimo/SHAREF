// Tiered pricing:
//  - 1–5 pages:   flat ₦200 (protects against near-free charges on short past questions/assignments)
//  - 6–24 pages:  ₦200 base + ₦20 for each page past the first 5
//  - 25+ pages:   ₦580 base (the price at exactly 24 pages) + ₦10 for each page past 24 —
//                 i.e. the ₦20/page rate simply drops to ₦10/page beyond the 24-page mark,
//                 it is not a flat ₦10 × total-pages calculation.
function calculateResourceCost(pages) {
  if (pages <= 5) return 200;
  if (pages <= 24) return 200 + (pages - 5) * 20;
  return 580 + (pages - 24) * 10;
}

module.exports = calculateResourceCost;