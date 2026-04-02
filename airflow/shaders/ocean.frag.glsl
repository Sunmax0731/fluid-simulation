precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in float v_foam;

uniform vec3 u_cameraPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_time;
uniform vec3 u_shallowColor;
uniform vec3 u_deepColor;
uniform vec3 u_subsurfaceColor;
uniform vec3 u_foamTint;
uniform float u_foamAmount;
uniform float u_reflectionMix;
uniform float u_basinDepth;
uniform float u_waterSurfaceY;
uniform float u_waterClarity;
uniform float u_absorption;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.1 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

vec3 skyColor(vec3 dir) {
  float t = max(dir.y, 0.0);
  vec3 zenith = vec3(0.05, 0.15, 0.4);
  vec3 horizon = vec3(0.6, 0.75, 0.9);
  return mix(horizon, zenith, pow(t, 0.6));
}

void main() {
  vec3 normal = normalize(v_normal);

  float t = u_time * 0.3;
  vec2 uvAnim = v_worldPos.xz * 0.5;
  float nx = fbm(uvAnim + vec2(t, 0.0)) * 2.0 - 1.0;
  float nz = fbm(uvAnim + vec2(0.0, t * 0.8) + vec2(5.2, 1.3)) * 2.0 - 1.0;
  normal = normalize(normal + vec3(nx, 0.0, nz) * 0.12);

  vec3 viewDir = normalize(u_cameraPos - v_worldPos);
  vec3 lightDir = normalize(u_sunDir);
  vec3 halfDir = normalize(lightDir + viewDir);

  float f0 = 0.02;
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  fresnel = clamp(fresnel, 0.0, 1.0);

  vec3 reflected = reflect(-viewDir, normal);
  vec3 reflColor = skyColor(reflected);

  float spec = pow(max(dot(normal, halfDir), 0.0), 256.0);
  vec3 sunSpec = u_sunColor * spec * 8.0;

  float depth = clamp((u_waterSurfaceY - v_worldPos.y + u_basinDepth) / max(u_basinDepth, 0.001), 0.0, 1.0);
  float absorb = exp(-depth * mix(3.8, 1.35, u_waterClarity) * u_absorption);
  vec3 transmittedColor = mix(u_deepColor, u_shallowColor, absorb);
  vec3 waterColor = mix(transmittedColor, u_deepColor, clamp(depth * 0.22, 0.0, 1.0));

  float sss = pow(max(dot(lightDir, -viewDir), 0.0), 3.0) * 0.3;
  vec3 sssColor = u_subsurfaceColor * sss;

  float reflection = clamp(fresnel * u_reflectionMix, 0.0, 1.0);
  vec3 color = mix(waterColor + sssColor, reflColor, reflection) + sunSpec;

  float foamNoise = fbm(v_worldPos.xz * 3.0 + vec2(u_time * 0.1)) * 0.5;
  float foamMask = smoothstep(0.3, 0.8, v_foam + foamNoise);
  color = mix(color, u_foamTint, foamMask * 0.7 * u_foamAmount);

  float dist = length(u_cameraPos - v_worldPos);
  float fog = exp(-dist * 0.008);
  vec3 fogColor = skyColor(normalize(v_worldPos - u_cameraPos));
  color = mix(fogColor, color, fog);

  float alphaBase = mix(0.26, 0.64, depth);
  float alpha = mix(alphaBase, 0.94, reflection * 0.82);
  alpha += foamMask * 0.14;
  alpha = clamp(mix(alpha, alpha * 0.72, u_waterClarity), 0.14, 0.96);

  fragColor = vec4(color, alpha);
}
