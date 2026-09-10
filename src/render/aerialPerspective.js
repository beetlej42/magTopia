// Relative to the inspected point, not camera distance: dollying back must not
// turn the foreground white. Kept as a small pure function for navigation tests.
export function aerialDepthBehindFocus(position, focus, direction) {
  return Math.max(0, (position.x - focus.x) * direction.x
    + (position.y - focus.y) * direction.y + (position.z - focus.z) * direction.z);
}
export const AERIAL_DEPTH_GLSL = `
float voxelAerialDepthBehindFocus(vec3 position) {
  return max(0.0, dot(position - voxelAerialFocus, voxelAerialViewDirection));
}
`;
