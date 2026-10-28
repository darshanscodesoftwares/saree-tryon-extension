2. Critical Requirement: Support Different Kiosk Sizes

The interface must adapt to different portrait touchscreen kiosk sizes, including 34-inch, 40-inch, 43-inch, and 50-inch displays, as well as other portrait screen sizes that may be used in the future.

The 43-inch kiosk is approximately 61 cm wide × 180 cm high × 11 cm deep. These are the physical enclosure dimensions, not the browser viewport dimensions.

Do not design the interface for one fixed resolution or hardcode dimensions based on a single screenshot.

Implement a genuinely adaptive portrait layout that:

Uses the available screen width and height efficiently.

Preserves the intended visual hierarchy and overall proportions across different display sizes.

Scales typography, product images, spacing, panels, and touch controls appropriately.

Keeps essential actions visible and accessible without unwanted scrolling or clipped content.

Handles different aspect ratios gracefully, rather than stretching or distorting the interface.

Maintains a comfortable, touch-friendly experience on large public-facing displays.

Use responsive CSS, flexible layouts, appropriate breakpoints, and viewport-aware sizing. Use clamp(), min(), max(), CSS Grid, or Flexbox where appropriate. Avoid relying entirely on fixed pixel values.