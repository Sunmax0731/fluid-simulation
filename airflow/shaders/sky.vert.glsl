precision highp float;

in vec3 position;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec3 v_dir;

void main() {
  v_dir = position;
  vec4 pos = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = pos.xyww;
}
