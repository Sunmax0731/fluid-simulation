#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform vec2 u_resolution;
uniform float u_halfRdx; // 0.5 / dx

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 inv = 1.0 / u_resolution;

  float velR = texture(u_velocity, uv + vec2(inv.x, 0.0)).r;
  float velL = texture(u_velocity, uv - vec2(inv.x, 0.0)).r;
  float velT = texture(u_velocity, uv + vec2(0.0, inv.y)).g;
  float velB = texture(u_velocity, uv - vec2(0.0, inv.y)).g;

  float div = u_halfRdx * (velR - velL + velT - velB);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
