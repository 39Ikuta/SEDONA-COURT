/**
 * Reliable 80mm thermal receipt browser printing.
 *
 * Instead of using window.print() directly (which prints the entire page with
 * modals, sidebars, etc. spanning multiple pages), this utility:
 *
 * 1. Clones the target printable element
 * 2. Appends it as a direct child of <body> in a dedicated container
 * 3. Injects a <style> that hides everything EXCEPT that container during print
 * 4. Calls window.print() (which blocks until the dialog closes)
 * 5. Cleans up the injected DOM elements
 *
 * This guarantees exactly 1 page of output sized at 80mm width.
 */
export const printBrowserReceipt = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (!el) {
    console.warn(`printBrowserReceipt: element #${elementId} not found`);
    return;
  }

  // 1. Clone the receipt element (deep clone preserves all children)
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id'); // prevent duplicate-ID side effects

  // 2. Create a container as a direct child of <body>
  const container = document.createElement('div');
  container.id = 'thermal-print-container';
  container.appendChild(clone);

  // 3. Inject styles that completely isolate print output
  const style = document.createElement('style');
  style.id = 'thermal-print-style';
  style.textContent = `
    /* Hide container on screen so it doesn't flash */
    @media screen {
      #thermal-print-container {
        position: fixed !important;
        top: -99999px !important;
        left: -99999px !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    }

    @media print {
      /* Page setup for 80mm thermal roll */
      @page {
        size: 80mm auto;
        margin: 0;
      }

      /* Reset html/body */
      html, body {
        width: 80mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        color: #000000 !important;
        overflow: visible !important;
      }

      /* Hide ALL direct children of body except our container.
         Using display:none fully collapses layout — no phantom pages. */
      body > *:not(#thermal-print-container) {
        display: none !important;
      }

      /* Make our container and all its descendants fully visible */
      #thermal-print-container,
      #thermal-print-container * {
        visibility: visible !important;
        position: static !important;
        opacity: 1 !important;
        display: revert !important;
        float: none !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        color: #000000 !important;
        border-color: #000000 !important;
        pointer-events: auto !important;
      }

      /* Container itself: positioned at top-left, 80mm wide */
      #thermal-print-container {
        display: block !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 80mm !important;
        max-width: 80mm !important;
        min-width: 80mm !important;
        padding: 3mm 4mm 5mm 4mm !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        background: #ffffff !important;
        background-image: none !important;
        font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace !important;
      }

      /* The cloned ticket element itself */
      #thermal-print-container > * {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        background: #ffffff !important;
        background-image: none !important;
      }

      /* Clean up decorative elements */
      #thermal-print-container .print\\:hidden {
        display: none !important;
      }

      /* Barcode SVG: ultra-sharp rendering */
      #thermal-print-container svg {
        filter: contrast(300%) grayscale(100%) !important;
        image-rendering: crisp-edges !important;
      }

      /* Strip text-shadow / box-shadow globally */
      *, *::before, *::after {
        text-shadow: none !important;
        box-shadow: none !important;
      }
    }
  `;

  // 4. Inject into DOM
  document.head.appendChild(style);
  document.body.appendChild(container);

  // 5. Print — window.print() blocks in Chrome until dialog closes
  window.print();

  // 6. Clean up
  if (document.head.contains(style)) {
    document.head.removeChild(style);
  }
  if (document.body.contains(container)) {
    document.body.removeChild(container);
  }
};
