#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform sampler2D u_density;
uniform sampler2D u_temperature;
uniform vec2 u_resolution;
uniform float u_dt;
uniform float u_buoyancy;
uniform float u_weight;
uniform float u_vortConfinement;

in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 inv = 1.0 / u_resolution;

  if (v_uv.x < inv.x || v_uv.x > 1.0 - inv.x || v_uv.y < inv.y || v_uv.y > 1.0 - inv.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float pR = texture(u_pressure, v_uv + vec2(inv.x, 0.0)).r;
  float pL = texture(u_pressure, v_uv - vec2(inv.x, 0.0)).r;
  float pT = texture(u_pressure, v_uv + vec2(0.0, inv.y)).r;
  float pB = texture(u_pressure, v_uv - vec2(0.0, inv.y)).r;

  vec2 vel = texture(u_velocity, v_uv).rg;
  vel.x -= 0.5 * (pR - pL);
  vel.y -= 0.5 * (pT - pB);

  float temp = texture(u_temperature, v_uv).r;
  float dens = texture(u_density, v_uv).r;
  vel.y += u_dt * (u_buoyancy * temp - u_weight * dens);

  float vR = texture(u_velocity, v_uv + vec2(inv.x, 0.0)).g
           - texture(u_velocity, v_uv - vec2(inv.x, 0.0)).g;
  float vT = texture(u_velocity, v_uv + vec2(0.0, inv.y)).r
           - texture(u_velocity, v_uv - vec2(0.0, inv.y)).r;
  float omega = 0.5 * (vR - vT);

  float omegaR = abs(texture(u_velocity, v_uv + vec2(inv.x, 0.0)).g
               - texture(u_velocity, v_uv - vec2(inv.x, 0.0)).g) * 0.5;
  float omegaT = abs(texture(u_velocity, v_uv + vec2(0.0, inv.y)).r
               - texture(u_velocity, v_uv - vec2(0.0, inv.y)).r) * 0.5;
  vec2 etaN = vec2(omegaT, -omegaR);
  float etaLen = length(etaN);

  if (etaLen > 1e-5) {
    etaN /= etaLen;
    vel += u_vortConfinement * u_dt * vec2(etaN.y * omega, -etaN.x * omega);
  }

  fragColor = vec4(vel, 0.0, 1.0);
}
