export const RENDER_CONFIG = {
  renderer: {
    exposure: 1.08,
    pixelRatioCapDesktop: 1.65,
    pixelRatioCapMobile: 1.25,
  },
  bloom: {
    threshold: 0.82,
    strength: 0.72,
    radius: 0.42,
    mobileResolutionScale: 0.62,
  },
  quality: {
    mobileMaxWidth: 720,
    cloudCountDesktop: 18,
    cloudCountMobile: 10,
  },
  world: {
    fogColor: 0x8db6ad,
    fogDensity: 0.00165,
  },
};

export function isMobileQuality() {
  return window.innerWidth <= RENDER_CONFIG.quality.mobileMaxWidth;
}
