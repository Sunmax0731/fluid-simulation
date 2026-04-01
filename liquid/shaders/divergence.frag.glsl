#version 300 es
precision highp float;
uniform sampler2D u_velocity;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 inv = 1.0 / u_resolution;
  float R = texture(u_velocity, v_uv + vec2(inv.x, 0.0)).r;
  float L = texture(u_velocity, v_uv - vec2(inv.x, 0.0)).r;
  float T = texture(u_velocity, v_uv + vec2(0.0, inv.y)).g;
  float B = texture(u_velocity, v_uv - vec2(0.0, inv.y)).g;
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
