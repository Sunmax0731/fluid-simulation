#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform sampler2D u_velocity;
uniform vec2 u_resolution;
uniform float u_dt;
uniform float u_dissipation;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 vel = texture(u_velocity, v_uv).rg;
  vec2 prevUV = v_uv - vel * u_dt / u_resolution;
  prevUV = clamp(prevUV, vec2(0.0), vec2(1.0));
  fragColor = texture(u_field, prevUV) * u_dissipation;
}
