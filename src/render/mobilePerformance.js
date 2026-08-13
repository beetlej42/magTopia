const IOS_WEBKIT_PATTERN = /iP(?:hone|ad|od)/;

export function detectMobileRenderProfile({
  userAgent = "",
  coarsePointer = false,
  width = 0,
  height = 0,
  devicePixelRatio = 1
} = {}) {
  const iosSafari = IOS_WEBKIT_PATTERN.test(userAgent) && /WebKit/i.test(userAgent) && !/(?:CriOS|FxiOS|EdgiOS)/i.test(userAgent);
  const mobile = coarsePointer || Math.min(width, height) <= 820;
  const pixelBudget = iosSafari ? 1_050_000 : mobile ? 1_150_000 : 3_200_000;
  const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, width * height));
  const maxPixelRatio = Math.max(1, Math.min(devicePixelRatio, mobile ? 1.8 : 2, budgetRatio));

  return {
    mobile,
    iosSafari,
    targetFrameMs: 1000 / 60,
    pixelBudget,
    minPixelRatio: mobile ? 1 : 1.25,
    maxPixelRatio: Number(maxPixelRatio.toFixed(2)),
    initialPixelRatio: Number(Math.min(maxPixelRatio, mobile ? 1.6 : 1.75).toFixed(2))
  };
}

export function chooseAdaptiveQuality({ averageFrameMs, pixelRatio, minPixelRatio, maxPixelRatio }) {
  let nextPixelRatio = pixelRatio;
  if (averageFrameMs > 18) nextPixelRatio -= averageFrameMs > 22 ? 0.2 : 0.1;
  else if (averageFrameMs < 15.2) nextPixelRatio += 0.1;
  nextPixelRatio = Math.max(minPixelRatio, Math.min(maxPixelRatio, Number(nextPixelRatio.toFixed(2))));

  return {
    pixelRatio: nextPixelRatio,
    // BokehPass is a full-screen depth pass. Preserve it at normal load, soften
    // it before sacrificing scene resolution, and bypass it only under stress.
    depthOfFieldScale: averageFrameMs > 21 ? 0 : averageFrameMs > 17.4 ? 0.62 : 1
  };
}
