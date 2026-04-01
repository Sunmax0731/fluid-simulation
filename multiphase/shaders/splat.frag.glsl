#version 300 es
precision highp float;

uniform sampler2D u_target;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform vec2 u_velocity;
uniform float u_radius;
uniform float u_amount;
uniform int u_mode; // 0: velocity, 1: add fluid, 2: remove fluid

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 position = uv * u_resolution;
  vec2 delta = position - u_center;
  float strength = exp(-dot(delta, delta) / (u_radius * u_radius));
  vec4 current = texture(u_target, uv);

  if (u_mode == 0) {
    fragColor = vec4(current.rg + u_velocity * strength * u_amount, 0.0, 1.0);
    return;
  }

  float value = current.r + (u_mode == 1 ? 1.0 : -1.0) * strength * u_amount;
  fragColor = vec4(clamp(value, 0.0, 1.0), 0.0, 0.0, 1.0);
}
