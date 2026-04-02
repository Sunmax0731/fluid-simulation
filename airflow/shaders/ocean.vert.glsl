precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform float u_time;
uniform float u_waveHeight;
uniform float u_windDir;
uniform float u_windSpeed;
uniform float u_viscosity;
uniform float u_wallReflectivity;
uniform vec2 u_basinHalfSize;
uniform sampler2D u_dynamicHeight;
uniform vec2 u_dynamicTexel;
uniform vec2 u_dynamicCellSize;
uniform float u_dynamicGain;
uniform float u_localWaveSeconds;
uniform vec4 u_impacts[32];

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out float v_foam;

void applyRipple(
  vec2 xz,
  vec2 source,
  float strength,
  float age,
  float spatialFreq,
  float rippleSpeed,
  float radialDecay,
  float temporalDecay,
  float rampTime,
  inout float height,
  inout float gradX,
  inout float gradZ
) {
  float distX = xz.x - source.x;
  float distZ = xz.y - source.y;
  vec2 delta = vec2(distX, distZ);
  float dist = max(length(delta), 0.0001);
  float phase = dist * spatialFreq - age * rippleSpeed;
  float envelope = exp(-dist * radialDecay) * exp(-age * temporalDecay) * smoothstep(0.0, rampTime, age);
  float amplitude = strength * envelope;
  float wave = sin(phase);

  height += amplitude * wave;

  float dHdr = amplitude * (spatialFreq * cos(phase) - radialDecay * wave);
  vec2 dir = delta / dist;
  gradX += dHdr * dir.x;
  gradZ += dHdr * dir.y;
}

float sampleDynamicHeight(vec2 sampleUv) {
  return texture(u_dynamicHeight, clamp(sampleUv, vec2(0.0), vec2(1.0))).r;
}

void main() {
  v_uv = uv;

  vec3 pos = position;
  vec2 xz = (modelMatrix * vec4(position, 1.0)).xz;
  float time = u_time;

  vec2 d0 = normalize(vec2(cos(u_windDir), sin(u_windDir)));
  vec2 d1 = normalize(vec2(cos(u_windDir + 0.55), sin(u_windDir + 0.55)));
  vec2 d2 = normalize(vec2(cos(u_windDir - 0.75), sin(u_windDir - 0.75)));
  vec2 d3 = normalize(vec2(cos(u_windDir + 1.25), sin(u_windDir + 1.25)));

  float f0 = 0.22 / max(u_windSpeed, 0.5);
  float f1 = 0.46 / max(u_windSpeed, 0.5);
  float f2 = 0.78 / max(u_windSpeed, 0.5);
  float f3 = 1.12 / max(u_windSpeed, 0.5);

  float p0 = dot(xz, d0) * f0 * 14.0 - time * 1.1;
  float p1 = dot(xz, d1) * f1 * 11.0 - time * 1.5;
  float p2 = dot(xz, d2) * f2 * 8.0 - time * 1.8;
  float p3 = dot(xz, d3) * f3 * 6.0 - time * 2.4;

  float a0 = u_waveHeight * 0.85;
  float a1 = u_waveHeight * 0.35;
  float a2 = u_waveHeight * 0.18;
  float a3 = u_waveHeight * 0.1;

  pos.y += sin(p0) * a0;
  pos.y += sin(p1) * a1;
  pos.y += sin(p2) * a2;
  pos.y += sin(p3) * a3;
  float surfaceHeight = pos.y;

  float dhdx = cos(p0) * a0 * d0.x * f0 * 14.0
             + cos(p1) * a1 * d1.x * f1 * 11.0
             + cos(p2) * a2 * d2.x * f2 * 8.0
             + cos(p3) * a3 * d3.x * f3 * 6.0;

  float dhdz = cos(p0) * a0 * d0.y * f0 * 14.0
             + cos(p1) * a1 * d1.y * f1 * 11.0
             + cos(p2) * a2 * d2.y * f2 * 8.0
             + cos(p3) * a3 * d3.y * f3 * 6.0;

  for (int i = 0; i < 32; i++) {
    vec4 impact = u_impacts[i];
    float age = time - impact.z;
    if (age <= 0.0 || impact.w <= 0.001) continue;

    float viscMix = clamp((u_viscosity - 0.05) / 1.75, 0.0, 1.0);
    float rippleSpeed = mix(10.4, 6.2, viscMix);
    float spatialFreq = mix(7.4, 5.8, viscMix * 0.9);
    float radialDecay = mix(0.34, 0.68, viscMix);
    float temporalDecay = mix(0.1, 0.26, viscMix);
    float rampTime = mix(0.06, 0.14, viscMix);
    float singleReflectionGain = u_wallReflectivity * 0.78;
    float cornerReflectionGain = u_wallReflectivity * u_wallReflectivity * 0.62;
    float maxAge = max(u_localWaveSeconds, 0.2);
    if (age >= maxAge) continue;

    float leftX = -2.0 * u_basinHalfSize.x - impact.x;
    float rightX = 2.0 * u_basinHalfSize.x - impact.x;
    float nearZ = -2.0 * u_basinHalfSize.y - impact.y;
    float farZ = 2.0 * u_basinHalfSize.y - impact.y;

    applyRipple(xz, impact.xy, impact.w, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(leftX, impact.y), impact.w * singleReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(rightX, impact.y), impact.w * singleReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(impact.x, nearZ), impact.w * singleReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(impact.x, farZ), impact.w * singleReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(leftX, nearZ), impact.w * cornerReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(leftX, farZ), impact.w * cornerReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(rightX, nearZ), impact.w * cornerReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
    applyRipple(xz, vec2(rightX, farZ), impact.w * cornerReflectionGain, age, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, surfaceHeight, dhdx, dhdz);
  }

  float dynamicCenter = sampleDynamicHeight(uv);
  float dynamicRight = sampleDynamicHeight(uv + vec2(u_dynamicTexel.x, 0.0));
  float dynamicLeft = sampleDynamicHeight(uv - vec2(u_dynamicTexel.x, 0.0));
  float dynamicTop = sampleDynamicHeight(uv + vec2(0.0, u_dynamicTexel.y));
  float dynamicBottom = sampleDynamicHeight(uv - vec2(0.0, u_dynamicTexel.y));

  surfaceHeight += dynamicCenter * u_dynamicGain;
  dhdx += ((dynamicRight - dynamicLeft) / max(2.0 * u_dynamicCellSize.x, 0.0001)) * u_dynamicGain;
  dhdz += ((dynamicBottom - dynamicTop) / max(2.0 * u_dynamicCellSize.y, 0.0001)) * u_dynamicGain;

  pos.y = surfaceHeight;
  v_normal = normalize(vec3(-dhdx, 1.0, -dhdz));
  v_worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  v_foam = smoothstep(0.05, 0.45, length(vec2(dhdx, dhdz))) * 0.55;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
