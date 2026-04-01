precision highp float;

in vec3 v_dir;

uniform vec3 u_sunDir;
uniform vec3 u_sunColor;

out vec4 fragColor;

void main() {
  vec3 dir = normalize(v_dir);
  float t = max(dir.y, 0.0);

  vec3 zenith = vec3(0.05, 0.15, 0.42);
  vec3 horizon = vec3(0.55, 0.72, 0.92);
  vec3 sky = mix(horizon, zenith, pow(t, 0.5));

  float sunset = pow(1.0 - t, 4.0) * 0.4;
  sky += vec3(1.0, 0.4, 0.1) * sunset * (1.0 - u_sunDir.y);

  float sunDot = max(dot(dir, normalize(u_sunDir)), 0.0);
  sky += u_sunColor * pow(sunDot, 128.0) * 3.0;
  sky += u_sunColor * pow(sunDot, 8.0) * 0.2;

  fragColor = vec4(sky, 1.0);
}
