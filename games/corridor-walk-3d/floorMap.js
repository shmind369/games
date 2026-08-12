// ---------- Pure math: mapping a "floor space" (u,v) coordinate onto the
// fixed background photo, and turning joystick drag input into character
// movement. No DOM/THREE dependency, so this is directly unit-testable
// under Node.
//
// The floor is calibrated as a quadrilateral in the background photo (4
// screen-fraction corners: near-left, near-right, far-right, far-left,
// where "near" = close to the camera/bottom of frame, "far" = deep into the
// room). computeQuadHomography turns that quad into the classic "unit
// square -> arbitrary quadrilateral" projective mapping (Heckbert 1989,
// the same technique used for texture-mapping a flat image onto a
// perspective quad), so a character walking at constant (u,v) speed
// automatically shows correct perspective foreshortening (looks like it
// slows down/shrinks as it walks deeper into the room) without needing to
// reconstruct the photo's real camera intrinsics.

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// quad = [nearLeft, nearRight, farRight, farLeft], each {x, y} in 0..1
// fractions of the background image. Maps unit square (0,0)->nearLeft,
// (1,0)->nearRight, (1,1)->farRight, (0,1)->farLeft.
export function computeQuadHomography(quad) {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;

  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / denom;
    h = (dx1 * dy3 - dx3 * dy1) / denom;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }
  return { a, b, c, d, e, f, g, h };
}

export function mapUnitToQuad(coeffs, u, v) {
  const { a, b, c, d, e, f, g, h } = coeffs;
  const denom = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / denom, y: (d * u + e * v + f) / denom };
}

// Local on-screen scale at (u,v) relative to the near edge (v=0), derived
// from how far apart two nearby mapped points are — i.e. genuine
// perspective foreshortening read directly off the same homography used
// for position, so it always stays consistent with it.
export function computeLocalScale(coeffs, u, v, eps = 0.01) {
  const uClamped = clamp(u, 0, 1 - eps);
  const p0 = mapUnitToQuad(coeffs, uClamped, v);
  const p1 = mapUnitToQuad(coeffs, uClamped + eps, v);
  const localWidth = Math.hypot(p1.x - p0.x, p1.y - p0.y);

  const q0 = mapUnitToQuad(coeffs, uClamped, 0);
  const q1 = mapUnitToQuad(coeffs, uClamped + eps, 0);
  const refWidth = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1e-6;

  return localWidth / refWidth;
}

// The angle (radians, screen space, atan2 convention) that "facing
// `heading` in floor-space" currently points to on screen, so the
// character model can be visually rotated to match the corridor's
// perspective instead of rotating in an abstract, unprojected space.
export function computeScreenForwardAngle(coeffs, u, v, heading, eps = 0.01) {
  const du = Math.sin(heading) * eps, dv = Math.cos(heading) * eps;
  const p0 = mapUnitToQuad(coeffs, clamp(u, 0, 1), clamp(v, 0, 1));
  const p1 = mapUnitToQuad(coeffs, clamp(u + du, 0, 1), clamp(v + dv, 0, 1));
  return Math.atan2(p1.y - p0.y, p1.x - p0.x);
}

// ---------- object-fit:cover mapping ----------
// The background <img> is displayed with object-fit:cover, so unless the
// viewport happens to share the source image's aspect ratio, part of the
// image gets cropped (top/bottom or left/right) to fill the screen. The
// floor quad is calibrated in the SOURCE IMAGE's own fractions, so it has
// to be converted into fractions of the actually-VISIBLE (post-crop)
// region for the character to line up with the photo on any phone.
export function imageFractionToViewportFraction(pt, imageAspect, viewportAspect) {
  if (viewportAspect >= imageAspect) {
    // image scaled to viewport width; top/bottom cropped.
    const visibleH = imageAspect / viewportAspect;
    const top = 0.5 - visibleH / 2;
    return { x: pt.x, y: (pt.y - top) / visibleH };
  }
  // image scaled to viewport height; left/right cropped.
  const visibleW = viewportAspect / imageAspect;
  const left = 0.5 - visibleW / 2;
  return { x: (pt.x - left) / visibleW, y: pt.y };
}

// ---------- Joystick (drag-from-touch-start) input ----------
export function computeJoystickAxes(startX, startY, curX, curY, maxRadius) {
  const dx = clamp(curX - startX, -maxRadius, maxRadius);
  const dy = clamp(curY - startY, -maxRadius, maxRadius);
  return {
    turnAxis: dx / maxRadius,
    // screen dy is positive downward; swiping UP (dy negative) should move forward.
    moveAxis: -dy / maxRadius,
  };
}

// ---------- Character step ----------
export function computeCharacterStep(state, turnAxis, moveAxis, dt, turnSpeed, moveSpeed) {
  const heading = state.heading + turnAxis * turnSpeed * dt;
  const du = Math.sin(heading) * moveAxis * moveSpeed * dt;
  const dv = Math.cos(heading) * moveAxis * moveSpeed * dt;
  return {
    u: clamp(state.u + du, 0, 1),
    v: clamp(state.v + dv, 0, 1),
    heading,
  };
}
