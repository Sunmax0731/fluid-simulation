#version 300 es
precision highp float;

in vec3 v_color;
in float v_rho;

out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;

  // メタボール風の輝き
  float rim = 1.0 - sqrt(d);
  float glow = smoothstep(0.0, 1.0, rim);
  vec3 color = v_color + vec3(0.3) * glow;
  float alpha = smoothstep(1.0, 0.6, d);

  fragColor = vec4(color, alpha * 0.85);
}
