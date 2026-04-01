#version 300 es
precision highp float;

uniform sampler2D u_position; // (x, y, _, _)
uniform sampler2D u_density;  // (rho, pressure, _, _)
uniform vec2 u_texSize;       // テクスチャサイズ
uniform vec2 u_domainSize;    // シミュレーション領域
uniform float u_particleRadius;
uniform float u_maxDensity;

out vec3 v_color;
out float v_rho;

void main() {
  // パーティクルインデックス → テクスチャUV
  float idx = float(gl_VertexID);
  float tx = mod(idx, u_texSize.x);
  float ty = floor(idx / u_texSize.x);
  vec2 uv = (vec2(tx, ty) + 0.5) / u_texSize;

  vec4 pos  = texture(u_position, uv);
  vec4 dens = texture(u_density, uv);

  float rho = dens.r;
  v_rho = rho;

  // 密度に応じた色 (低密度: 青, 高密度: 白)
  float t = clamp(rho / u_maxDensity, 0.0, 1.0);
  v_color = mix(vec3(0.05, 0.2, 0.8), vec3(0.7, 0.9, 1.0), t);

  // NDC変換
  vec2 ndc = (pos.xy / u_domainSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = u_particleRadius * 2.0;
}
