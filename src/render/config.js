export const RENDER_CONFIG = {
  renderer: {
    exposure: 1.0,
    pixelRatioCapDesktop: 1.65,
    pixelRatioCapMobile: 1.25,
  },
  bloom: {
    threshold: 1.25,
    strength: 0.34,
    radius: 0.22,
    mobileResolutionScale: 0.62,
  },
  quality: {
    mobileMaxWidth: 720,
    cloudCountDesktop: 18,
    cloudCountMobile: 10,
  },
  world: {
    fogColor: 0xd08a70,
    fogDensity: 0.00072,
  },
};

export function isMobileQuality() {
  return window.innerWidth <= RENDER_CONFIG.quality.mobileMaxWidth;
}
