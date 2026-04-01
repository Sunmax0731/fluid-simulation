#version 300 es
precision highp float;

uniform sampler2D u_target;
uniform vec2 u_resolution;
uniform vec2 u_splatPos;
uniform vec2 u_splatVel;
uniform float u_radius;
uniform float u_amount;
uniform vec3 u_color;
uniform int u_mode; // 0: velocity, 1: scalar field

in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 pos = v_uv * u_resolution;
  vec2 delta = pos - u_splatPos;
  float strength = exp(-dot(delta, delta) / (u_radius * u_radius)) * u_amount;

  vec4 current = texture(u_target, v_uv);

  if (u_mode == 0) {
    fragColor = vec4(current.rg + u_splatVel * strength, 0.0, 1.0);
  } else {
    fragColor = vec4(
      min(current.r + u_color.r * strength, 1.5),
      min(current.g + u_color.g * strength, 1.5),
      0.0,
      1.0
    );
  }
}
