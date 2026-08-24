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

  // Spend more of the recovered mobile GPU budget on edge clarity while
  // retaining adaptive quality as the safety valve for sustained slow frames.
  const pixelBudget = iosSafari ? 1_550_000 : mobile ? 1_650_000 : 3_200_000;
  const budgetRatio = Math.sqrt(pixelBudget / Math.max(1, width * height));
  const minPixelRatio = mobile ? 1.2 : 1;
  const maxPixelRatio = Math.max(minPixelRatio, Math.min(devicePixelRatio, mobile ? 2 : 2, budgetRatio));

  return {
    mobile,
    iosSafari,
    targetFrameMs: 1000 / 60,
    pixelBudget,
    minPixelRatio,
    maxPixelRatio: Number(maxPixelRatio.toFixed(2)),
    initialPixelRatio: Number(Math.min(maxPixelRatio, mobile ? 2 : 1.75).toFixed(2))
  };
}

export function shouldEnableBokeh({ requestedValue = null } = {}) {
  if (requestedValue === "1") return true;
  if (requestedValue === "0") return false;
  return true;
}

export function chooseAdaptiveQuality({
  averageFrameMs,
  pixelRatio,
  minPixelRatio,
  maxPixelRatio,
  bokehQuality = 1,
  bokehEnabled = true
}) {
  let nextPixelRatio = pixelRatio;
  let nextBokehQuality = bokehQuality;
  if (averageFrameMs > 22) {
    if (bokehEnabled && nextBokehQuality > 0.75) nextBokehQuality = 0.5;
    else nextPixelRatio -= 0.1;
  } else if (averageFrameMs > 18.2) {
    if (bokehEnabled && nextBokehQuality > 0.75) nextBokehQuality = 0.5;
    else nextPixelRatio -= 0.05;
  } else if (averageFrameMs < 15.5) {
    if (bokehEnabled && nextBokehQuality < 0.75) nextBokehQuality = 1;
    else nextPixelRatio += 0.05;
  }
  nextPixelRatio = Math.max(minPixelRatio, Math.min(maxPixelRatio, Number(nextPixelRatio.toFixed(2))));

  return {
    pixelRatio: nextPixelRatio,
    depthOfFieldScale: bokehEnabled ? 1 : 0,
    bokehQuality: nextBokehQuality,
    lodQualityScale: averageFrameMs > 24 ? 1.2 : averageFrameMs > 20 ? 1.1 : 1
  };
}
