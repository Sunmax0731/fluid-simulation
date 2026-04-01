#version 300 es
precision mediump float;
uniform vec2 u_resolution;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // 微細なグリッドパターン
  vec2 grid = fract(uv * 40.0);
  float line = step(0.97, max(grid.x, grid.y));
  vec3 bg = mix(vec3(0.02, 0.02, 0.05), vec3(0.05, 0.05, 0.12), line);
  fragColor = vec4(bg, 1.0);
}
