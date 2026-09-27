---
permalink: /assets/js/news-scroll.js
---

function updateNewsFade(container) {
  const remainingScroll = container.scrollHeight - container.clientHeight - container.scrollTop;
  container.classList.toggle("has-more-news", remainingScroll > 1);
}

function resizeScrollableNews() {
  document.querySelectorAll(".news-scrollable[data-visible-items]").forEach((container) => {
    const visibleItems = Number.parseInt(container.dataset.visibleItems, 10);
    const rows = Array.from(container.querySelectorAll("tbody > tr"));

    if (!visibleItems || rows.length <= visibleItems) {
      container.style.removeProperty("max-height");
      updateNewsFade(container);
      return;
    }

    const visibleHeight = rows.slice(0, visibleItems).reduce((height, row) => height + row.getBoundingClientRect().height, 0);
    container.style.maxHeight = `${Math.ceil(visibleHeight)}px`;
    updateNewsFade(container);
  });
}

let newsResizeFrame;

function scheduleNewsResize() {
  window.cancelAnimationFrame(newsResizeFrame);
  newsResizeFrame = window.requestAnimationFrame(resizeScrollableNews);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".news-scrollable[data-visible-items]").forEach((container) => {
    container.addEventListener("scroll", () => updateNewsFade(container), { passive: true });
  });
  scheduleNewsResize();
});
window.addEventListener("load", scheduleNewsResize);
window.addEventListener("resize", scheduleNewsResize);
