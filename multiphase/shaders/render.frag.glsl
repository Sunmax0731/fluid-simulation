#version 300 es
precision highp float;

uniform sampler2D u_vof;
uniform sampler2D u_velocity;
uniform vec2 u_resolution;
uniform int u_mode; // 0: ink, 1: velocity
uniform float u_time;
uniform vec3 u_inkColor;
uniform vec3 u_edgeColor;
uniform vec3 u_bgA;
uniform vec3 u_bgB;

in vec2 v_uv;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.08 + vec2(4.2, 1.3);
    amplitude *= 0.5;
  }
  return value;
}

vec3 heatRamp(float t) {
  vec3 cold = vec3(0.15, 0.28, 0.74);
  vec3 mid = vec3(0.35, 0.92, 0.98);
  vec3 hot = vec3(1.0, 0.78, 0.16);
  vec3 peak = vec3(1.0, 0.98, 0.92);
  vec3 base = mix(cold, mid, smoothstep(0.0, 0.45, t));
  base = mix(base, hot, smoothstep(0.35, 0.85, t));
  return mix(base, peak, smoothstep(0.82, 1.0, t));
}

void main() {
  vec2 inv = 1.0 / u_resolution;
  float c = texture(u_vof, v_uv).r;
  vec2 velocity = texture(u_velocity, v_uv).rg;
  float speed = length(velocity) * 5.2;

  float cR = texture(u_vof, v_uv + vec2(inv.x, 0.0)).r;
  float cL = texture(u_vof, v_uv - vec2(inv.x, 0.0)).r;
  float cT = texture(u_vof, v_uv + vec2(0.0, inv.y)).r;
  float cB = texture(u_vof, v_uv - vec2(0.0, inv.y)).r;
  vec2 grad = vec2(cR - cL, cT - cB) * 0.5;
  float edge = length(grad);

  float body = smoothstep(0.02, 0.22, c);
  float rim = smoothstep(0.02, 0.22, edge);

  if (u_mode == 1) {
    vec3 flow = heatRamp(clamp(speed, 0.0, 1.0));
    vec3 color = mix(u_bgA * 0.4 + u_bgB * 0.6, flow, clamp(speed * 1.08 + rim * 0.45, 0.0, 1.0));
    color += flow * rim * 0.12;
    fragColor = vec4(color, body * 0.82);
    return;
  }

  float cellular = fbm(v_uv * 12.0 + vec2(u_time * 0.05, -u_time * 0.035));
  float veining = fbm(v_uv * 28.0 - velocity * 3.0 + vec2(u_time * 0.04, u_time * 0.025));
  float shadowNoise = fbm(v_uv * 9.0 + velocity * 0.8 - vec2(u_time * 0.02, -u_time * 0.015));

  vec3 deepColor = mix(u_bgA * 0.45, u_inkColor * 0.64, clamp(body * 0.82 + shadowNoise * 0.18, 0.0, 1.0));
  vec3 thinColor = mix(u_inkColor * 0.9, u_edgeColor, clamp(rim * 0.8 + cellular * 0.25, 0.0, 1.0));
  vec3 liquid = mix(deepColor, thinColor, clamp(0.26 + body * 0.58 + cellular * 0.16 - veining * 0.08, 0.0, 1.0));
  liquid += u_edgeColor * rim * (0.08 + speed * 0.06);
  liquid += vec3(0.98, 0.99, 1.0) * pow(clamp(edge * 8.5 + speed * 0.25, 0.0, 1.0), 3.2) * 0.08;

  float alpha = clamp(max(body, rim * 0.36), 0.0, 1.0);
  fragColor = vec4(liquid, alpha);
}
