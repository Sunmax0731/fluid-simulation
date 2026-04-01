precision highp float;
precision highp sampler3D;

uniform sampler3D u_volumeTex;
uniform vec3 u_boundsMin;
uniform vec3 u_boundsMax;
uniform vec3 u_cameraPosLocal;
uniform vec3 u_lightDirLocal;
uniform float u_time;
uniform float u_densityGain;
uniform float u_shadowStrength;
uniform float u_warpAmount;
uniform float u_emissionGain;
uniform int u_mode;
uniform vec3 u_fireBaseColor;
uniform vec3 u_fireLowColor;
uniform vec3 u_fireMidColor;
uniform vec3 u_fireHighColor;
uniform vec3 u_sootColor;
uniform vec3 u_smokeLightColor;
uniform vec3 u_smokeDarkColor;
uniform vec3 u_smokeWarmColor;

in vec3 vLocalPos;
out vec4 fragColor;

const int STEPS = 56;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

bool intersectBox(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax, out float tNear, out float tFar) {
  vec3 invDir = 1.0 / rayDir;
  vec3 t0 = (boxMin - rayOrigin) * invDir;
  vec3 t1 = (boxMax - rayOrigin) * invDir;
  vec3 tSmaller = min(t0, t1);
  vec3 tLarger = max(t0, t1);
  tNear = max(max(tSmaller.x, tSmaller.y), tSmaller.z);
  tFar = min(min(tLarger.x, tLarger.y), tLarger.z);
  return tFar > max(tNear, 0.0);
}

vec3 volumeUv(vec3 p) {
  vec3 uv = (p - u_boundsMin) / (u_boundsMax - u_boundsMin);
  float yFade = 1.0 - uv.y;
  vec3 warp = vec3(
    sin(uv.y * 12.0 + uv.z * 7.0 + u_time * 1.3),
    sin(uv.x * 9.0 - uv.z * 5.0 - u_time * 0.9) * 0.35,
    cos(uv.y * 10.0 - uv.x * 6.0 - u_time * 1.1)
  ) * u_warpAmount * (0.14 + yFade * 0.22);
  return clamp(uv + warp, vec3(0.001), vec3(0.999));
}

vec4 sampleVolume(vec3 p) {
  vec4 voxel = texture(u_volumeTex, volumeUv(p));
  float density = voxel.r * u_densityGain;
  float temperature = voxel.g;
  float speed = voxel.b;
  float opacity = voxel.a;
  return vec4(density, temperature, speed, opacity);
}

float densityAt(vec3 p) {
  return sampleVolume(p).x;
}

float lightAttenuation(vec3 p, float stepLength) {
  vec3 lightDir = normalize(u_lightDirLocal);
  float nearOcc = densityAt(p + lightDir * stepLength * 5.0);
  float midOcc = densityAt(p + lightDir * stepLength * 11.0);
  float farOcc = densityAt(p + lightDir * stepLength * 19.0);
  return exp(-(nearOcc * 1.7 + midOcc * 1.1 + farOcc * 0.8) * u_shadowStrength);
}

vec3 flamePalette(float heat) {
  vec3 color = mix(u_fireLowColor, u_fireMidColor, smoothstep(0.02, 0.3, heat));
  color = mix(color, u_fireHighColor, smoothstep(0.36, 0.92, heat));
  return color;
}

void main() {
  vec3 rayOrigin = u_cameraPosLocal;
  vec3 rayDir = normalize(vLocalPos - rayOrigin);

  float tNear;
  float tFar;
  if (!intersectBox(rayOrigin, rayDir, u_boundsMin, u_boundsMax, tNear, tFar)) {
    discard;
  }

  tNear = max(tNear, 0.0);
  float rayLength = tFar - tNear;
  if (rayLength <= 0.0001) {
    discard;
  }

  float stepLength = rayLength / float(STEPS);
  float jitter = hash12(gl_FragCoord.xy + vec2(u_time * 27.0, u_time * 13.0));
  vec3 lightDir = normalize(u_lightDirLocal);
  vec4 accum = vec4(0.0);

  for (int i = 0; i < STEPS; i++) {
    float t = tNear + (float(i) + jitter) * stepLength;
    vec3 p = rayOrigin + rayDir * t;
    vec4 voxel = sampleVolume(p);
    vec3 uvw = volumeUv(p);

    float density = voxel.x * voxel.w;
    if (density < 0.0025) {
      continue;
    }

    float temperature = voxel.y;
    float speed = voxel.z;
    float shadow = lightAttenuation(p, stepLength);
    float forward = pow(max(dot(rayDir, lightDir), 0.0), u_mode == 1 ? 4.0 : 2.4);
    float radial = length((uvw.xz - vec2(0.5)) * vec2(1.45, 1.15));
    float coreMask = 1.0 - smoothstep(0.14, 0.72, radial);
    float heightCool = smoothstep(0.02, 1.0, uvw.y);
    float extinction = density * stepLength * (u_mode == 1 ? 3.1 : 3.0);
    float alpha = 1.0 - exp(-extinction);

    vec3 color;
    if (u_mode == 1) {
      float heat = clamp(temperature * (1.14 - heightCool * 0.42) + density * 0.18 + coreMask * 0.08, 0.0, 1.0);
      float soot = smoothstep(0.22, 0.92, density) * smoothstep(0.18, 0.92, uvw.y) * (1.0 - smoothstep(0.34, 0.88, heat));
      float blueBase = smoothstep(0.0, 0.18, 1.0 - uvw.y) * smoothstep(0.46, 1.0, temperature);
      float ember = smoothstep(0.24, 0.8, density) * smoothstep(0.0, 0.25, 1.0 - uvw.y);

      color = flamePalette(heat);
      color += u_fireBaseColor * blueBase * (0.12 + coreMask * 0.32);
      color = mix(color, u_sootColor, soot * 0.58);
      color += mix(u_fireMidColor, u_fireHighColor, 0.42) * ember * 0.08;
      color *= (0.84 + coreMask * 0.18) * mix(0.42, 1.42, shadow) * u_emissionGain;
      color += mix(u_fireMidColor, u_fireHighColor, 0.72) * forward * (0.08 + speed * 0.18);
      alpha *= mix(0.9, 1.08, coreMask);
    } else {
      float mistBody = clamp(density * 0.88 + heightCool * 0.14, 0.0, 1.0);
      float rim = pow(1.0 - clamp(radial, 0.0, 1.0), 1.8);
      float scatter = pow(max(dot(-rayDir, lightDir), 0.0), 5.0);

      color = mix(u_smokeLightColor, u_smokeDarkColor, mistBody);
      color = mix(color, u_smokeLightColor, (1.0 - mistBody) * 0.38 + rim * 0.12);
      color += u_smokeWarmColor * (temperature * 0.16 + speed * 0.05);
      color *= mix(0.62, 1.14, shadow);
      color += mix(u_smokeWarmColor, u_smokeLightColor, 0.7) * scatter * (0.06 + speed * 0.08);
      alpha *= 0.76 + rim * 0.12;
    }

    accum.rgb += (1.0 - accum.a) * color * alpha;
    accum.a += (1.0 - accum.a) * alpha;

    if (accum.a > 0.985) {
      break;
    }
  }

  if (accum.a < 0.01) {
    discard;
  }

  accum.rgb = pow(accum.rgb, vec3(0.92));
  fragColor = vec4(accum.rgb, accum.a);
}
