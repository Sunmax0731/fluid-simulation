precision highp float;
precision highp int;

uniform sampler2D u_inkMap;
uniform vec2 u_texel;
uniform float u_domainSize;
uniform float u_surfaceHeight;
uniform float u_surfaceRelief;
uniform float u_meniscus;
uniform float u_time;
uniform int u_viewMode;

out vec2 vUv;
out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec4 vInk;
out float vBody;
out float vEdge;
out float vThickness;

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float sampleField(vec2 sampleUv) {
  vec4 texel = texture(u_inkMap, clamp(sampleUv, 0.0, 1.0));
  float alpha = texel.a;
  float pigment = luminance(texel.rgb);
  float body = u_viewMode == 1 ? max(alpha, pigment * 0.8) : alpha;
  return clamp(body, 0.0, 1.0);
}

float filteredField(vec2 sampleUv) {
  float center = sampleField(sampleUv) * 0.36;
  center += sampleField(sampleUv + vec2(u_texel.x, 0.0)) * 0.16;
  center += sampleField(sampleUv - vec2(u_texel.x, 0.0)) * 0.16;
  center += sampleField(sampleUv + vec2(0.0, u_texel.y)) * 0.16;
  center += sampleField(sampleUv - vec2(0.0, u_texel.y)) * 0.16;
  return center;
}

float detailWave(vec2 sampleUv, float body) {
  float waveA = sin(sampleUv.x * 21.0 + u_time * 0.58);
  float waveB = cos(sampleUv.y * 18.0 - u_time * 0.43);
  float waveC = sin((sampleUv.x + sampleUv.y) * 14.0 + u_time * 0.3);
  return (waveA * waveB + waveC * 0.55) * u_surfaceRelief * body;
}

float heightAt(vec2 sampleUv) {
  float body = smoothstep(0.01, 0.98, filteredField(sampleUv));
  float meniscusBand = smoothstep(0.03, 0.26, body) * (1.0 - smoothstep(0.42, 0.98, body));
  return body * u_surfaceHeight + meniscusBand * u_meniscus + detailWave(sampleUv, body);
}

void main() {
  vUv = uv;
  vInk = texture(u_inkMap, uv);

  float bodyCenter = smoothstep(0.01, 0.98, filteredField(uv));
  float heightCenter = heightAt(uv);
  float heightRight = heightAt(uv + vec2(u_texel.x, 0.0));
  float heightLeft = heightAt(uv - vec2(u_texel.x, 0.0));
  float heightTop = heightAt(uv + vec2(0.0, u_texel.y));
  float heightBottom = heightAt(uv - vec2(0.0, u_texel.y));

  vec3 displaced = position;
  displaced.y += heightCenter;

  vec3 tangentX = normalize(vec3(2.0 * u_texel.x * u_domainSize, heightRight - heightLeft, 0.0));
  vec3 tangentZ = normalize(vec3(0.0, heightTop - heightBottom, -2.0 * u_texel.y * u_domainSize));
  vec3 localNormal = normalize(cross(tangentZ, tangentX));

  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vBody = bodyCenter;
  vEdge = clamp(length(vec2(heightRight - heightLeft, heightTop - heightBottom)) * 10.0, 0.0, 1.0);
  vThickness = clamp(heightCenter / max(u_surfaceHeight + u_meniscus + max(u_surfaceRelief, 0.001), 0.001), 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
