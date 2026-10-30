---
permalink: /assets/js/cv-viewer.js
---
import * as pdfjsLib from "{{ site.third_party_libraries.pdfjs.url.js }}";

pdfjsLib.GlobalWorkerOptions.workerSrc = "{{ site.third_party_libraries.pdfjs.url.worker }}";

// Zoom levels, relative to fitting the page to the viewer's width.
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

class CvViewer {
  constructor(root) {
    this.root = root;
    this.stage = root.querySelector(".cv-viewer-stage");
    this.currentPageLabel = root.querySelector("[data-current-page]");
    this.totalPagesLabel = root.querySelector("[data-total-pages]");
    this.zoomButtons = root.querySelectorAll("[data-zoom]");
    this.zoomLabel = root.querySelector(".cv-viewer-zoom-level");
    this.zoomIndex = ZOOM_STEPS.indexOf(1);
    this.pages = [];
    this.renderToken = 0;
    this.stageWidth = 0;
  }

  async load() {
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument(this.root.dataset.pdfUrl).promise;
    } catch (error) {
      console.error(error);
      this.showError();
      return;
    }

    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const annotations = await page.getAnnotations({ intent: "display" });
      const element = document.createElement("div");
      element.className = "cv-viewer-page";
      const canvas = document.createElement("canvas");
      const linkLayer = document.createElement("div");
      linkLayer.className = "cv-viewer-links";
      element.append(canvas, linkLayer);
      this.pages.push({
        page,
        links: annotations.filter((annotation) => annotation.subtype === "Link" && annotation.url),
        element,
        canvas,
        linkLayer,
      });
    }

    this.stage.replaceChildren(...this.pages.map((item) => item.element));
    this.totalPagesLabel.textContent = pdf.numPages;
    this.root.classList.add("is-ready");
    // Render first: it records the stage width that the resize observer compares against.
    this.render();
    this.bindControls();
  }

  bindControls() {
    this.zoomButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const { zoom } = button.dataset;
        if (zoom === "in") this.zoomIndex = Math.min(this.zoomIndex + 1, ZOOM_STEPS.length - 1);
        if (zoom === "out") this.zoomIndex = Math.max(this.zoomIndex - 1, 0);
        if (zoom === "reset") this.zoomIndex = ZOOM_STEPS.indexOf(1);
        this.render();
      });
    });

    let scrollFrame;
    window.addEventListener(
      "scroll",
      () => {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(() => this.updateCurrentPage());
      },
      { passive: true }
    );

    // Re-fit the pages when the viewer's width changes (window resize, rotation).
    let resizeTimer;
    new ResizeObserver(() => {
      if (Math.abs(this.stage.clientWidth - this.stageWidth) < 1) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.render(), 150);
    }).observe(this.stage);
  }

  fitWidthScale(page) {
    const style = window.getComputedStyle(this.stage);
    const available = this.stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return available / page.getViewport({ scale: 1 }).width;
  }

  async render() {
    const token = ++this.renderToken;
    const zoom = ZOOM_STEPS[this.zoomIndex];
    const pixelRatio = window.devicePixelRatio || 1;
    this.stageWidth = this.stage.clientWidth;
    this.updateZoomControls();

    for (const item of this.pages) {
      item.task?.cancel();
      const viewport = item.page.getViewport({ scale: this.fitWidthScale(item.page) * zoom });
      item.element.style.width = `${viewport.width}px`;
      item.element.style.height = `${viewport.height}px`;

      // Draw into a fresh canvas and swap it in, so the old page stays visible meanwhile.
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      item.task = item.page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });

      try {
        await item.task.promise;
      } catch (error) {
        if (error instanceof pdfjsLib.RenderingCancelledException) return;
        throw error;
      }
      if (token !== this.renderToken) return;

      item.canvas.replaceWith(canvas);
      item.canvas = canvas;
      this.placeLinks(item, viewport);
    }
    this.updateCurrentPage();
  }

  // Overlay the PDF's hyperlinks so they stay clickable on the canvas.
  placeLinks(item, viewport) {
    item.linkLayer.replaceChildren(
      ...item.links.map((link) => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(link.rect);
        const anchor = document.createElement("a");
        anchor.href = link.url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.title = link.url;
        anchor.setAttribute("aria-label", link.url);
        Object.assign(anchor.style, {
          left: `${Math.min(x1, x2)}px`,
          top: `${Math.min(y1, y2)}px`,
          width: `${Math.abs(x2 - x1)}px`,
          height: `${Math.abs(y2 - y1)}px`,
        });
        return anchor;
      })
    );
  }

  updateZoomControls() {
    this.zoomLabel.textContent = `${Math.round(ZOOM_STEPS[this.zoomIndex] * 100)}%`;
    this.zoomButtons.forEach((button) => {
      const { zoom } = button.dataset;
      button.disabled = (zoom === "out" && this.zoomIndex === 0) || (zoom === "in" && this.zoomIndex === ZOOM_STEPS.length - 1);
    });
  }

  updateCurrentPage() {
    const middle = window.innerHeight / 2;
    let current = 1;
    this.pages.forEach((item, index) => {
      if (item.element.getBoundingClientRect().top < middle) current = index + 1;
    });
    this.currentPageLabel.textContent = current;
  }

  showError() {
    const message = document.createElement("p");
    message.className = "cv-viewer-status";
    const link = document.createElement("a");
    link.href = this.root.dataset.pdfUrl;
    link.textContent = "open the PDF";
    message.append("The CV couldn't be displayed here — ", link, " instead.");
    this.stage.replaceChildren(message);
  }
}

document.querySelectorAll(".cv-viewer").forEach((root) => new CvViewer(root).load());
