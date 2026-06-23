// Initialize medium zoom.
$(document).ready(function () {
  const getZoomBackground = () => getComputedStyle(document.documentElement).getPropertyValue("--global-bg-color") + "ee";
  const getZoomMargin = () => (window.matchMedia("(max-width: 576px)").matches ? 20 : 24);
  const getZoomContainer = () => {
    const mainContainer = document.querySelector(".container[role='main']");
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const navbar = document.getElementById("navbar");
    const footer = document.querySelector("footer.fixed-bottom");
    const navbarHeight = navbar ? navbar.getBoundingClientRect().height : 0;
    const footerHeight = footer ? footer.getBoundingClientRect().height : 0;

    if (!mainContainer) {
      return {
        width: viewportWidth,
        height: viewportHeight,
        top: navbarHeight,
        bottom: footerHeight,
        left: 0,
        right: 0,
      };
    }

    const mainRect = mainContainer.getBoundingClientRect();

    return {
      width: viewportWidth,
      height: viewportHeight,
      top: navbarHeight,
      bottom: footerHeight,
      left: Math.max(0, mainRect.left),
      right: Math.max(0, viewportWidth - mainRect.right),
    };
  };
  const getZoomOptions = () => ({
    background: getZoomBackground(), // + 'ee' for transparency.
    container: getZoomContainer(),
    margin: getZoomMargin(),
  });

  medium_zoom = mediumZoom("[data-zoomable]", getZoomOptions());

  window.addEventListener("resize", () => {
    medium_zoom.update(getZoomOptions());
  });
});
