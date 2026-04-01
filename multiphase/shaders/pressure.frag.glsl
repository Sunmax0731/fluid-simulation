#version 300 es
precision highp float;

uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_resolution;
uniform float u_alpha;   // -dx^2
uniform float u_rBeta;  // 1/4

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 inv = 1.0 / u_resolution;

  float pR = texture(u_pressure, uv + vec2(inv.x, 0.0)).r;
  float pL = texture(u_pressure, uv - vec2(inv.x, 0.0)).r;
  float pT = texture(u_pressure, uv + vec2(0.0, inv.y)).r;
  float pB = texture(u_pressure, uv - vec2(0.0, inv.y)).r;
  float bC = texture(u_divergence, uv).r;

  fragColor = vec4((pR + pL + pT + pB + u_alpha * bC) * u_rBeta, 0.0, 0.0, 1.0);
}
