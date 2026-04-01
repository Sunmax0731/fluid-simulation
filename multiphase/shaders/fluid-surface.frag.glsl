precision highp float;
precision highp int;

uniform sampler2D u_inkMap;
uniform vec3 u_cameraPos;
uniform float u_absorption;
uniform float u_refraction;
uniform float u_fresnel;
uniform float u_specular;
uniform float u_caustics;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_rimColor;
uniform vec3 u_shadowColor;
uniform float u_time;
uniform int u_viewMode;

in vec2 vUv;
in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec4 vInk;
in float vBody;
in float vEdge;
in float vThickness;

out vec4 fragColor;

vec3 skyColor(vec3 direction) {
  float horizon = saturate(direction.y * 0.5 + 0.5);
  vec3 low = vec3(0.05, 0.07, 0.11);
  vec3 mid = vec3(0.14, 0.18, 0.26);
  vec3 high = vec3(0.66, 0.74, 0.9);
  vec3 base = mix(low, mid, smoothstep(0.0, 0.6, horizon));
  return mix(base, high, pow(horizon, 1.25));
}

void main() {
  float alphaMask = max(vInk.a, vBody * 0.85);
  if (alphaMask < 0.015) {
    discard;
  }

  vec3 normal = normalize(vWorldNormal);
  vec3 viewDir = normalize(u_cameraPos - vWorldPos);
  vec3 lightDir = normalize(u_lightDir);
  vec3 reflectDir = reflect(-viewDir, normal);
  vec3 halfDir = normalize(lightDir + viewDir);

  vec2 refractOffset = normal.xz * u_refraction * (0.028 + vThickness * 0.04);
  vec3 refractedInk = texture(u_inkMap, clamp(vUv + refractOffset, 0.001, 0.999)).rgb;
  vec3 pigment = max(vInk.rgb, refractedInk * 0.78);
  vec3 deepPigment = mix(u_shadowColor, pigment * 0.62 + u_shadowColor * 0.38, saturate(vThickness * 1.2 + 0.08));
  vec3 thinPigment = mix(pigment * 1.06, u_rimColor, saturate(vEdge * 0.55 + (1.0 - vThickness) * 0.4));

  float absorption = exp(-u_absorption * (0.42 + vThickness * 1.75));
  vec3 bodyColor = mix(deepPigment, thinPigment, absorption);

  float diffuse = 0.34 + 0.66 * saturate(dot(normal, lightDir));
  float specularPower = mix(28.0, 120.0, saturate(u_specular * 0.5));
  float specular = pow(saturate(dot(normal, halfDir)), specularPower) * (0.35 + u_specular * 0.9);
  float fresnel = pow(1.0 - saturate(dot(viewDir, normal)), 4.4) * u_fresnel;
  float internalPulse = 0.5 + 0.5 * sin((vUv.x * 17.0 + vUv.y * 13.0) + u_time * 0.32);

  vec3 reflection = skyColor(reflectDir);
  vec3 color = bodyColor * diffuse;
  color += reflection * (0.16 + fresnel * 0.52);
  color += u_lightColor * specular * (0.48 + vEdge * 0.3);
  color += u_rimColor * u_caustics * pow(1.0 - vThickness, 1.5) * (0.15 + vEdge * 0.38 + internalPulse * 0.05);
  color = mix(color, u_rimColor, vEdge * 0.14);

  if (u_viewMode == 1) {
    vec3 flowColor = mix(pigment, reflection, fresnel * 0.28);
    flowColor += u_lightColor * specular * 0.35;
    color = mix(flowColor, color, 0.35);
  }

  float alpha = saturate(alphaMask * 0.72 + vThickness * 0.24 + fresnel * 0.12);
  fragColor = vec4(color, alpha);
}
