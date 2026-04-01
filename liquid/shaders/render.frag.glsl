#version 300 es
precision highp float;

uniform sampler2D u_density;
uniform sampler2D u_temperature;
uniform vec2 u_resolution;
uniform int u_mode;
uniform float u_time;

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
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(3.1, 1.7);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  float density = texture(u_density, v_uv).r;
  float temperature = texture(u_temperature, v_uv).r;
  float turbulence = fbm(v_uv * 6.4 + vec2(u_time * 0.05, -u_time * 0.03));

  if (u_mode == 1) {
    if (density < 0.006) {
      fragColor = vec4(0.0);
      return;
    }

    float heat = clamp(temperature * 1.08 + density * 0.14, 0.0, 1.0);
    float soot = smoothstep(0.06, 0.4, density) * (1.0 - smoothstep(0.34, 0.9, heat));

    vec3 flame = mix(vec3(0.15, 0.03, 0.01), vec3(0.92, 0.22, 0.02), smoothstep(0.02, 0.34, heat));
    flame = mix(flame, vec3(1.0, 0.62, 0.08), smoothstep(0.22, 0.72, heat));
    flame = mix(flame, vec3(1.0, 0.96, 0.86), smoothstep(0.72, 1.0, heat));
    flame = mix(flame, vec3(0.1, 0.08, 0.08), soot * 0.48);
    flame *= 0.86 + turbulence * 0.32;

    float alpha = clamp(density * (0.95 + heat * 0.85), 0.0, 1.0);
    fragColor = vec4(flame, alpha);
    return;
  }

  float diffuse = density * (0.78 + turbulence * 0.26);
  float warmth = smoothstep(0.0, 0.7, temperature) * diffuse * (1.0 - smoothstep(0.2, 1.0, v_uv.y));

  vec3 smoke = mix(
    vec3(0.82, 0.84, 0.88),
    vec3(0.12, 0.13, 0.16),
    clamp(diffuse * 0.96, 0.0, 1.0)
  );
  smoke += vec3(0.78, 0.36, 0.12) * warmth * 0.72;
  smoke *= 0.88 + turbulence * 0.22;

  float alpha = clamp(diffuse * 0.82, 0.0, 0.92);
  fragColor = vec4(smoke, alpha);
}
