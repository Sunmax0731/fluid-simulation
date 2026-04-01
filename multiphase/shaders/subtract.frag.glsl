#version 300 es
precision highp float;

uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform sampler2D u_vof;
uniform vec2 u_resolution;
uniform float u_halfRdx;
uniform float u_dt;
uniform float u_gravityY;
uniform float u_rho_liquid;
uniform float u_rho_gas;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 inv = 1.0 / u_resolution;

  if (uv.x < inv.x || uv.x > 1.0-inv.x || uv.y < inv.y || uv.y > 1.0-inv.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float pR = texture(u_pressure, uv + vec2(inv.x, 0.0)).r;
  float pL = texture(u_pressure, uv - vec2(inv.x, 0.0)).r;
  float pT = texture(u_pressure, uv + vec2(0.0, inv.y)).r;
  float pB = texture(u_pressure, uv - vec2(0.0, inv.y)).r;

  vec2 vel = texture(u_velocity, uv).rg;
  float C   = texture(u_vof, uv).r;

  float rho = mix(u_rho_gas, u_rho_liquid, C);

  float gradPx = u_halfRdx * (pR - pL);
  float gradPy = u_halfRdx * (pT - pB);

  vel.x -= u_dt / rho * gradPx;
  vel.y -= u_dt / rho * gradPy;

  vel.y += u_dt * u_gravityY * C;

  if (uv.x <= 2.0*inv.x)         vel.x = max(vel.x, 0.0);
  if (uv.x >= 1.0 - 2.0*inv.x)  vel.x = min(vel.x, 0.0);
  if (uv.y <= 2.0*inv.y)         vel.y = max(vel.y, 0.0);
  if (uv.y >= 1.0 - 2.0*inv.y)  vel.y = min(vel.y, 0.0);

  fragColor = vec4(vel, 0.0, 1.0);
}
