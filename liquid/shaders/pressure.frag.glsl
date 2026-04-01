#version 300 es
precision highp float;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 inv = 1.0 / u_resolution;
  float pR = texture(u_pressure, v_uv + vec2(inv.x, 0.0)).r;
  float pL = texture(u_pressure, v_uv - vec2(inv.x, 0.0)).r;
  float pT = texture(u_pressure, v_uv + vec2(0.0, inv.y)).r;
  float pB = texture(u_pressure, v_uv - vec2(0.0, inv.y)).r;
  float div = texture(u_divergence, v_uv).r;
  fragColor = vec4((pR + pL + pT + pB - div) * 0.25, 0.0, 0.0, 1.0);
}
